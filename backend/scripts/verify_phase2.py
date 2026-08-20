"""Phase 2 acceptance checks, run in-process against the seeded database.

Uses FastAPI's TestClient so no server needs to be running, and cross-checks
the API's answers against direct pymongo counts — an endpoint that agrees with
itself proves nothing.

The write checks (PATCH / close / decision) mutate real documents; run
`make seed-yes` afterwards to restore the fixtures.

Usage:
    uv run python scripts/verify_phase2.py
"""

import os
import sys

from dotenv import load_dotenv
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()

from core.db import create_connector  # noqa: E402
from main import app  # noqa: E402
from repositories.claims_repo import STATUS_MATCHES  # noqa: E402

PASSED: list[str] = []
FAILED: list[str] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        PASSED.append(name)
        print(f"  PASS  {name}")
    else:
        FAILED.append(name)
        print(f"  FAIL  {name}" + (f"\n          {detail}" if detail else ""))


def check_1_list_stats(client: TestClient, claims) -> None:
    """list_claims stat counts must match direct countDocuments on both segments."""
    print("\n[1] list_claims stats vs. countDocuments")
    for segment in ("ALL", "SIMPLE", "COMPLEX"):
        response = client.get("/api/claims", params={"complexity": segment, "limit": 200})
        check(f"GET /api/claims?complexity={segment} -> 200", response.status_code == 200,
              response.text[:200])
        if response.status_code != 200:
            continue

        stats = response.json()["stats"]
        base = {} if segment == "ALL" else {"complexity": segment}

        for key, status in [
            ("total", "ALL"),
            ("unprocessed", "UNPROCESSED"),
            ("pendingReview", "PENDING_REVIEW"),
            ("flagged", "FLAGGED"),
            ("cleared", "CLEARED"),
        ]:
            expected = claims.count_documents({**base, **STATUS_MATCHES[status]})
            check(f"{segment}.{key} == {expected}", stats[key] == expected,
                  f"api={stats[key]} mongo={expected}")

        # The status filter must actually narrow the rows.
        flagged = client.get(
            "/api/claims", params={"complexity": segment, "status": "FLAGGED", "limit": 200}
        ).json()
        check(f"{segment} FLAGGED rows == total == stats.flagged",
              len(flagged["claims"]) == flagged["total"] == stats["flagged"],
              f"rows={len(flagged['claims'])} total={flagged['total']} stat={stats['flagged']}")


def check_2_update_rejects_fraud(client: TestClient, claims) -> None:
    """update_claim must return 400 when the body carries a fraud key."""
    print("\n[2] PATCH /api/claims/{id} rejects fraud keys")
    claim_id = claims.find_one({}, {"claimId": 1})["claimId"]

    for body in ({"fraud": {"computedScore": 99}}, {"fraud.computedScore": 99}):
        response = client.patch(f"/api/claims/{claim_id}", json=body)
        check(f"body {list(body)[0]!r} -> 4xx", 400 <= response.status_code < 500,
              f"got {response.status_code}: {response.text[:200]}")

    ok = client.patch(f"/api/claims/{claim_id}", json={"adjusterId": "ADJ-VERIFY"})
    check("legitimate field -> 200", ok.status_code == 200, ok.text[:200])
    check("legitimate field persisted",
          claims.find_one({"claimId": claim_id}).get("adjusterId") == "ADJ-VERIFY")

    missing = client.patch("/api/claims/CLM-DOES-NOT-EXIST", json={"adjusterId": "X"})
    check("unknown claim -> 404", missing.status_code == 404, missing.text[:200])


def check_3_close_guard(client: TestClient, claims) -> None:
    """close_claim: 409 while a recommendation is undecided, 200 otherwise."""
    print("\n[3] POST /api/claims/{id}/close conflict guard")

    undecided = claims.find_one(STATUS_MATCHES["PENDING_REVIEW"], {"claimId": 1})
    if undecided:
        response = client.post(f"/api/claims/{undecided['claimId']}/close")
        check(f"{undecided['claimId']} (pending review) -> 409", response.status_code == 409,
              f"got {response.status_code}: {response.text[:200]}")
    else:
        check("a PENDING_REVIEW claim exists to test the 409 path", False,
              "no claim has fraud.processed=True and fraud.fraudFlag=None")

    closable = claims.find_one({"fraud.fraudFlag": {"$ne": None}}, {"claimId": 1})
    if closable:
        response = client.post(f"/api/claims/{closable['claimId']}/close")
        check(f"{closable['claimId']} (decided) -> 200", response.status_code == 200,
              f"got {response.status_code}: {response.text[:200]}")
        check("claimStatus is CLOSED",
              claims.find_one({"claimId": closable["claimId"]})["claimStatus"] == "CLOSED")


def check_4_decision_feedback_loop(client: TestClient, claims, patterns) -> None:
    """record_fraud_decision must move confirmedFraudRate, not just fraudFlag."""
    print("\n[4] POST /api/claims/{id}/decision feedback loop")

    claim = claims.find_one({"fraud.matchedPatterns.0": {"$exists": True}})
    if not claim:
        check("a claim with matched patterns exists", False)
        return

    claim_id = claim["claimId"]
    pattern_id = claim["fraud"]["matchedPatterns"][0]["patternId"]
    before = patterns.find_one({"patternId": pattern_id})["stats"]

    response = client.post(
        f"/api/claims/{claim_id}/decision",
        json={"decision": "CONFIRMED_FRAUD", "reviewedBy": "verify_phase2"},
    )
    check(f"decision on {claim_id} -> 200", response.status_code == 200, response.text[:300])
    if response.status_code != 200:
        return

    after = patterns.find_one({"patternId": pattern_id})["stats"]
    check(f"{pattern_id}.confirmedCount +1",
          after["confirmedCount"] == before["confirmedCount"] + 1,
          f"{before['confirmedCount']} -> {after['confirmedCount']}")
    check(f"{pattern_id}.confirmedFraudRate changed",
          after["confirmedFraudRate"] != before["confirmedFraudRate"],
          f"still {after['confirmedFraudRate']}")
    check(f"{pattern_id}.confirmedFraudRate == count/timesTriggered",
          abs(after["confirmedFraudRate"]
              - after["confirmedCount"] / after["timesTriggered"]) < 1e-4,
          str(after))

    updated_claim = claims.find_one({"claimId": claim_id})
    check("claim fraudFlag is True", updated_claim["fraud"]["fraudFlag"] is True)
    check("claim flagSource is HUMAN", updated_claim["fraud"]["flagSource"] == "HUMAN")

    # A dismissal must not lower confirmedCount.
    dismissed = client.post(
        f"/api/claims/{claim_id}/decision",
        json={"decision": "DISMISSED", "reviewedBy": "verify_phase2",
              "dismissReason": "verification run"},
    )
    check("dismissal -> 200", dismissed.status_code == 200, dismissed.text[:200])
    after_dismiss = patterns.find_one({"patternId": pattern_id})["stats"]
    check("dismissal leaves confirmedCount unchanged",
          after_dismiss["confirmedCount"] == after["confirmedCount"],
          f"{after['confirmedCount']} -> {after_dismiss['confirmedCount']}")

    no_reason = client.post(
        f"/api/claims/{claim_id}/decision",
        json={"decision": "DISMISSED", "reviewedBy": "verify_phase2"},
    )
    check("dismissal without dismissReason -> 422", no_reason.status_code == 422,
          f"got {no_reason.status_code}")


def check_5_remaining_endpoints(client: TestClient, claims) -> None:
    """Smoke-check the endpoints without an explicit checklist item."""
    print("\n[5] detail / audit / linked / batch")
    claim_id = claims.find_one({}, {"claimId": 1})["claimId"]

    detail = client.get(f"/api/claims/{claim_id}")
    check("GET detail -> 200", detail.status_code == 200, detail.text[:200])
    if detail.status_code == 200:
        body = detail.json()
        check("detail includes joined policy and customer",
              bool(body.get("policy")) and bool(body.get("customer")))
    check("GET detail unknown -> 404",
          client.get("/api/claims/CLM-DOES-NOT-EXIST").status_code == 404)

    audit = client.get(f"/api/claims/{claim_id}/audit")
    check("GET audit -> 200", audit.status_code == 200, audit.text[:200])

    linked = client.get(f"/api/claims/{claim_id}/linked")
    check("GET linked -> 200", linked.status_code == 200, linked.text[:200])
    if linked.status_code == 200:
        rows = linked.json()["linked"]
        check("every linked claim carries a reason",
              all(row["linkReasons"] for row in rows),
              str([r["claimId"] for r in rows if not r["linkReasons"]]))

    complex_claim = claims.find_one({"complexity": "COMPLEX"}, {"claimId": 1})
    processed = claims.find_one({"complexity": "SIMPLE", "fraud.processed": True}, {"claimId": 1})
    batch_ids = [i for i in [
        complex_claim and complex_claim["claimId"],
        processed and processed["claimId"],
        "CLM-DOES-NOT-EXIST",
    ] if i]

    batch = client.post("/api/claims/batch/select", json={"claimIds": batch_ids})
    check("POST batch/select -> 200", batch.status_code == 200, batch.text[:200])
    if batch.status_code == 200:
        reasons = {r["claimId"]: r["reason"] for r in batch.json()["rejected"]}
        check("unknown id rejected as 'not found'",
              reasons.get("CLM-DOES-NOT-EXIST") == "not found", str(reasons))
        if complex_claim:
            check("complex claim rejected as 'not a simple claim'",
                  reasons.get(complex_claim["claimId"]) == "not a simple claim", str(reasons))
        if processed:
            check("processed claim rejected as 'already processed'",
                  reasons.get(processed["claimId"]) == "already processed", str(reasons))


def main() -> int:
    connector = create_connector()
    claims = connector.get_collection("claims")
    patterns = connector.get_collection("fraud_patterns")

    print(f"Verifying Phase 2 against database '{connector.database_name}'")
    print("NOTE: this mutates documents. Run `make seed-yes` afterwards to restore fixtures.")

    with TestClient(app) as client:
        check_1_list_stats(client, claims)
        check_2_update_rejects_fraud(client, claims)
        check_3_close_guard(client, claims)
        check_4_decision_feedback_loop(client, claims, patterns)
        check_5_remaining_endpoints(client, claims)

    print("\n" + "=" * 60)
    print(f"{len(PASSED)} passed, {len(FAILED)} failed")
    if FAILED:
        print("\nFailed checks:")
        for name in FAILED:
            print(f"  - {name}")
    print("=" * 60)
    return 1 if FAILED else 0


if __name__ == "__main__":
    sys.exit(main())
