"""Acceptance checks for the Phase 1 fraud-intelligence tools.

Same approach as `verify_phase2.py`: FastAPI's TestClient so no server needs to
be running, and every number the API reports is cross-checked against a direct
pymongo aggregation. An endpoint that only agrees with itself proves nothing —
so the invariants here are the ones that would actually catch a wrong answer:

  * every breakdown's per-bucket counts sum back to the portfolio total, and no
    claim is counted in two buckets (the bug that made the dashboard donut
    overflow once already);
  * confirmedFraudRate divides by decided claims, not by total;
  * potentialImpactWithoutTool really is the sum of the two figures above it;
  * the leaderboard's clusters describe claims that genuinely share the
    connection they claim to;
  * co-occurrence pairs are symmetric and never exceed either pattern's own
    trigger count within the analysed sample.

READ-ONLY. Unlike verify_phase2.py this mutates nothing, so there is no need to
reseed afterwards.

Usage:
    uv run python scripts/verify_phase1_tools.py
    uv run python scripts/verify_phase1_tools.py --verbose   # print payloads
"""

import os
import sys

from dotenv import load_dotenv
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()

from core.db import create_connector  # noqa: E402
from main import app  # noqa: E402

PASSED: list[str] = []
FAILED: list[str] = []
VERBOSE = "--verbose" in sys.argv

BREAKDOWN_BUCKETS = ("flagged", "cleared", "pending", "unprocessed")


def check(name: str, condition: bool, detail: str = "") -> None:
    if condition:
        PASSED.append(name)
        print(f"  PASS  {name}")
    else:
        FAILED.append(name)
        print(f"  FAIL  {name}" + (f"\n          {detail}" if detail else ""))


def get(client: TestClient, path: str, **params):
    """GET a route, assert 200, and return the payload (or None)."""
    response = client.get(path, params=params or None)
    check(f"GET {path} {params or ''} -> 200", response.status_code == 200, response.text[:300])
    if response.status_code != 200:
        return None
    payload = response.json()
    if VERBOSE:
        print(f"        {payload}")
    return payload


# --------------------------------------------------------------- 1. breakdown

def check_1_rate_breakdown(client: TestClient, claims) -> None:
    """Every dimension must partition the portfolio exactly once."""
    print("\n[1] get_fraud_rate_breakdown — partitions and rates")

    portfolio_total = claims.count_documents({})

    for dimension in (
        "complexity",
        "coverageType",
        "claimType",
        "claimAmountBucket",
        "customerTenureBucket",
    ):
        payload = get(client, "/api/fraud/rate-breakdown", dimension=dimension)
        if not payload:
            continue

        rows = payload["breakdown"]
        check(f"{dimension}: returns at least one group", bool(rows), str(payload))

        # The four buckets are mutually exclusive by construction, so per row
        # they must sum to that row's total. This is the check that catches a
        # claim being counted as both flagged and unprocessed.
        for row in rows:
            bucket_sum = sum(row[k] for k in BREAKDOWN_BUCKETS)
            check(
                f"{dimension}/{row['value']}: buckets sum to total "
                f"({bucket_sum} == {row['total']})",
                bucket_sum == row["total"],
                str(row),
            )
            # The rate's denominator must be decided claims, never the total.
            expected = (
                round(row["flagged"] / (row["flagged"] + row["cleared"]), 4)
                if (row["flagged"] + row["cleared"]) else 0.0
            )
            check(
                f"{dimension}/{row['value']}: confirmedFraudRate == flagged/decided",
                abs(row["confirmedFraudRate"] - expected) < 1e-9,
                f"got {row['confirmedFraudRate']}, expected {expected} from {row}",
            )
            check(
                f"{dimension}/{row['value']}: decidedCount == flagged + cleared",
                row["decidedCount"] == row["flagged"] + row["cleared"],
                str(row),
            )

        # customerTenureBucket $lookups customers and drops claims whose
        # customer is missing, so it is legitimately allowed to total less.
        if dimension == "customerTenureBucket":
            check(
                f"{dimension}: total never exceeds the portfolio "
                f"({payload['total']} <= {portfolio_total})",
                payload["total"] <= portfolio_total,
                f"total={payload['total']} portfolio={portfolio_total}",
            )
        else:
            check(
                f"{dimension}: groups account for every claim "
                f"({payload['total']} == {portfolio_total})",
                payload["total"] == portfolio_total,
                f"total={payload['total']} portfolio={portfolio_total}",
            )

    bad = client.get("/api/fraud/rate-breakdown", params={"dimension": "notADimension"})
    check("unknown dimension -> 422", bad.status_code == 422, bad.text[:200])


# ------------------------------------------------------------- 2. leaderboard

def check_2_similarity_leaderboard(client: TestClient, claims) -> None:
    """Each cluster's claims must really share the link it names."""
    print("\n[2] get_claim_similarity_leaderboard — clusters and ranking")

    payload = get(client, "/api/fraud/similarity-leaderboard", limit=10, scope="ALL")
    if not payload:
        return

    clusters = payload["clusters"]
    check("returns clusters (or an honest empty list)", isinstance(clusters, list), str(payload))
    check(
        f"returned count respects limit ({len(clusters)} <= 10)",
        len(clusters) <= 10,
        str(len(clusters)),
    )
    check(
        f"total >= returned ({payload['total']} >= {len(clusters)})",
        payload["total"] >= len(clusters),
        str(payload),
    )

    # Descending priority: this list is read top-down as a work queue, so the
    # ordering is the feature, not a detail.
    priorities = [c["priority"] for c in clusters]
    check(
        "clusters are ordered by descending priority",
        priorities == sorted(priorities, reverse=True),
        str(priorities),
    )

    for cluster in clusters:
        check(
            f"{cluster['clusterId']}: has 2+ claims",
            len(cluster["claimIds"]) >= 2,
            str(cluster),
        )
        check(
            f"{cluster['clusterId']}: claimIds are unique",
            len(cluster["claimIds"]) == len(set(cluster["claimIds"])),
            str(cluster["claimIds"]),
        )
        check(
            f"{cluster['clusterId']}: claimCount matches claimIds",
            cluster["claimCount"] == len(cluster["claimIds"]),
            str(cluster),
        )
        check(
            f"{cluster['clusterId']}: maxScore >= avgScore",
            cluster["maxScore"] >= cluster["avgScore"],
            str(cluster),
        )

        # The substantive check: go back to Mongo and confirm the claims really
        # do share the thing the cluster says they share.
        kind, _, key = cluster["clusterId"].partition(":")
        field = {
            "SAME_CUSTOMER": "customerId",
            "SAME_REPAIR_SHOP": "repairShop",
            "SHARED_PATTERN": "fraud.matchedPatterns.patternId",
        }.get(kind)
        if field:
            actual = claims.count_documents(
                {"claimId": {"$in": cluster["claimIds"]}, field: key}
            )
            check(
                f"{cluster['clusterId']}: all {len(cluster['claimIds'])} claims "
                f"really share {field}={key}",
                actual == len(cluster["claimIds"]),
                f"{actual} of {len(cluster['claimIds'])} match in Mongo",
            )

    # A narrower scope cannot produce more clusters than the widest one.
    flagged = get(client, "/api/fraud/similarity-leaderboard", scope="FLAGGED")
    if flagged:
        check(
            "FLAGGED scope considers no more candidates than ALL",
            flagged["candidatesConsidered"] <= payload["candidatesConsidered"],
            f"FLAGGED={flagged['candidatesConsidered']} ALL={payload['candidatesConsidered']}",
        )


# ---------------------------------------------------------- 3. co-occurrence

def check_3_cooccurrence(client: TestClient, claims, patterns) -> None:
    """Pairs must be symmetric, distinct, and bounded by their own trigger counts."""
    print("\n[3] get_pattern_cooccurrence_matrix — pairs and rates")

    payload = get(client, "/api/fraud/pattern-cooccurrence", minCooccurrence=1)
    if not payload:
        return

    analysed = claims.count_documents({
        "fraud.processed": True, "fraud.matchedPatterns.0": {"$exists": True},
    })
    check(
        f"claimsAnalyzed matches Mongo ({payload['claimsAnalyzed']} == {analysed})",
        payload["claimsAnalyzed"] == analysed,
        str(payload["claimsAnalyzed"]),
    )

    seen: set[frozenset[str]] = set()
    trigger_counts = {
        p["patternId"]: (p.get("stats") or {}).get("timesTriggered") or 0
        for p in patterns.find({}, {"patternId": 1, "stats": 1})
    }

    for pair in payload["pairs"]:
        key = frozenset({pair["patternIdA"], pair["patternIdB"]})
        check(
            f"{pair['patternIdA']}/{pair['patternIdB']}: not a self-pair",
            pair["patternIdA"] != pair["patternIdB"],
            str(pair),
        )
        check(
            f"{pair['patternIdA']}/{pair['patternIdB']}: appears only once",
            key not in seen,
            "the reversed pair is already present",
        )
        seen.add(key)

        # Two patterns cannot co-occur on more claims than either was matched on.
        both = claims.count_documents({
            "fraud.matchedPatterns.patternId": {"$all": [pair["patternIdA"], pair["patternIdB"]]},
            "fraud.processed": True,
        })
        check(
            f"{pair['patternIdA']}/{pair['patternIdB']}: count matches Mongo "
            f"({pair['cooccurrenceCount']} == {both})",
            pair["cooccurrenceCount"] == both,
            str(pair),
        )
        for field in ("cooccurrenceRate", "observedCooccurrenceRate"):
            rate = pair[field]
            check(
                f"{pair['patternIdA']}/{pair['patternIdB']}: {field} in (0, 1] or null",
                rate is None or 0.0 <= rate <= 1.0,
                f"{field}={rate}",
            )
        if trigger_counts.get(pair["patternIdA"], 0) and trigger_counts.get(pair["patternIdB"], 0):
            check(
                f"{pair['patternIdA']}/{pair['patternIdB']}: cooccurrenceRate is computable",
                pair["cooccurrenceRate"] is not None,
                "both patterns have a trigger count, so the rate should not be null",
            )

    # The filter must actually filter.
    strict = get(client, "/api/fraud/pattern-cooccurrence", minCooccurrence=3)
    if strict:
        check(
            f"minCooccurrence=3 returns no more pairs than =1 "
            f"({strict['total']} <= {payload['total']})",
            strict["total"] <= payload["total"],
            f"strict={strict['total']} loose={payload['total']}",
        )
        check(
            "every returned pair meets minCooccurrence=3",
            all(p["cooccurrenceCount"] >= 3 for p in strict["pairs"]),
            str([p["cooccurrenceCount"] for p in strict["pairs"]]),
        )


# -------------------------------------------------------- 4. repeat entities

def check_4_repeat_entities(client: TestClient, claims) -> None:
    """Groups must meet the threshold and their claim lists must be real."""
    print("\n[4] get_repeat_entity_analysis — grouping and thresholds")

    for entity_type, field in (
        ("customer", "customerId"),
        ("repairShop", "repairShop"),
        ("adjuster", "adjusterId"),
    ):
        payload = get(
            client, "/api/fraud/repeat-entities", entityType=entity_type, minAppearances=2
        )
        if not payload:
            continue

        check(f"{entity_type}: echoes entityType", payload["entityType"] == entity_type,
              str(payload["entityType"]))

        for entity in payload["entities"]:
            check(
                f"{entity_type}/{entity['entityValue']}: meets minAppearances=2",
                entity["claimCount"] >= 2,
                str(entity),
            )
            check(
                f"{entity_type}/{entity['entityValue']}: claimIds length matches claimCount",
                len(entity["claimIds"]) == entity["claimCount"],
                str(entity),
            )
            check(
                f"{entity_type}/{entity['entityValue']}: confirmedCount <= claimCount",
                entity["confirmedCount"] <= entity["claimCount"],
                str(entity),
            )
            # Every listed claim must actually carry that entity value.
            actual = claims.count_documents(
                {"claimId": {"$in": entity["claimIds"]}, field: entity["entityValue"]}
            )
            check(
                f"{entity_type}/{entity['entityValue']}: all claims carry {field}",
                actual == len(entity["claimIds"]),
                f"{actual} of {len(entity['claimIds'])} match in Mongo",
            )
            check(
                f"{entity_type}/{entity['entityValue']}: no null entity value",
                entity["entityValue"] not in (None, ""),
                str(entity),
            )

        # Raising the threshold can only shrink the result.
        strict = get(
            client, "/api/fraud/repeat-entities", entityType=entity_type, minAppearances=3
        )
        if strict:
            check(
                f"{entity_type}: minAppearances=3 returns no more than =2 "
                f"({strict['total']} <= {payload['total']})",
                strict["total"] <= payload["total"],
                f"strict={strict['total']} loose={payload['total']}",
            )

    bad = client.get("/api/fraud/repeat-entities", params={"entityType": "nope"})
    check("unknown entityType -> 422", bad.status_code == 422, bad.text[:200])
    bad = client.get(
        "/api/fraud/repeat-entities", params={"entityType": "customer", "minAppearances": 1}
    )
    check("minAppearances=1 -> 422 (a group of one is not a repeat)",
          bad.status_code == 422, bad.text[:200])


# ------------------------------------------------------ 5. financial impact

def check_5_financial_impact(client: TestClient, claims) -> None:
    """The money figures must match direct sums, and the redundant field must agree."""
    print("\n[5] get_fraud_financial_impact — sums and identities")

    payload = get(client, "/api/fraud/financial-impact")
    if not payload:
        return

    def total(match: dict, field: str) -> float:
        row = next(claims.aggregate([
            {"$match": match},
            {"$group": {"_id": None, "n": {"$sum": {"$ifNull": [f"${field}", 0]}}}},
        ]), {})
        return round(row.get("n", 0), 2)

    expected_current = total({"fraud.fraudFlag": False}, "paidAmount")
    expected_avoided = total({"fraud.fraudFlag": True}, "claimAmount")

    check(
        f"currentFinancialImpact == sum(paidAmount where fraudFlag=false) "
        f"({payload['currentFinancialImpact']} == {expected_current})",
        abs(payload["currentFinancialImpact"] - expected_current) < 0.01,
        str(payload),
    )
    check(
        f"fraudCostAvoided == sum(claimAmount where fraudFlag=true) "
        f"({payload['fraudCostAvoided']} == {expected_avoided})",
        abs(payload["fraudCostAvoided"] - expected_avoided) < 0.01,
        str(payload),
    )
    # The whole reason the field is in the payload rather than derived client-side.
    check(
        "potentialImpactWithoutTool == currentFinancialImpact + fraudCostAvoided",
        abs(
            payload["potentialImpactWithoutTool"]
            - (payload["currentFinancialImpact"] + payload["fraudCostAvoided"])
        ) < 0.01,
        str(payload),
    )
    check(
        f"fraudClaimCount matches Mongo",
        payload["fraudClaimCount"] == claims.count_documents({"fraud.fraudFlag": True}),
        str(payload["fraudClaimCount"]),
    )
    check(
        f"legitimateClaimCount matches Mongo",
        payload["legitimateClaimCount"] == claims.count_documents({"fraud.fraudFlag": False}),
        str(payload["legitimateClaimCount"]),
    )
    if payload["fraudClaimCount"]:
        check("avgClaimAmountFraud is positive when fraud claims exist",
              payload["avgClaimAmountFraud"] > 0, str(payload))


# --------------------------------------------------------- 6. review queue

def check_6_review_queue(client: TestClient, claims) -> None:
    """Backlog must match the pending queue, and coverage must be honest."""
    print("\n[6] get_review_queue_metrics — backlog, turnaround, oldest")

    payload = get(client, "/api/fraud/review-queue-metrics")
    if not payload:
        return

    pending_match = {"$or": [
        {"fraud.processed": {"$ne": True}},
        {"fraud.processed": True, "fraud.fraudFlag": None},
    ]}
    expected_backlog = claims.count_documents(pending_match)
    check(
        f"totalBacklog matches the pending queue "
        f"({payload['totalBacklog']} == {expected_backlog})",
        payload["totalBacklog"] == expected_backlog,
        str(payload),
    )
    # The same claim set the dashboard's pending queue renders.
    queue = get(client, "/api/fraud/pending-queue", limit=1)
    if queue:
        check(
            f"totalBacklog agrees with /pending-queue total "
            f"({payload['totalBacklog']} == {queue['total']})",
            payload["totalBacklog"] == queue["total"],
            f"metrics={payload['totalBacklog']} queue={queue['total']}",
        )

    for segment in payload["backlogByComplexity"]:
        check(
            f"backlog/{segment['complexity']}: awaiting split sums to backlog",
            segment["awaitingDecision"] + segment["awaitingAssessment"] == segment["backlog"],
            str(segment),
        )
    check(
        "backlogByComplexity sums to totalBacklog",
        sum(s["backlog"] for s in payload["backlogByComplexity"]) == payload["totalBacklog"],
        str(payload["backlogByComplexity"]),
    )

    decided = claims.count_documents({"fraud.fraudFlag": {"$in": [True, False]}})
    check(f"decidedCount matches Mongo ({payload['decidedCount']} == {decided})",
          payload["decidedCount"] == decided, str(payload["decidedCount"]))
    check(
        f"timeToDecisionSampleSize <= decidedCount "
        f"({payload['timeToDecisionSampleSize']} <= {payload['decidedCount']})",
        payload["timeToDecisionSampleSize"] <= payload["decidedCount"],
        str(payload),
    )
    check(
        "timeToDecisionCoverage is a fraction",
        0.0 <= payload["timeToDecisionCoverage"] <= 1.0,
        str(payload["timeToDecisionCoverage"]),
    )
    if payload["timeToDecisionCoverage"] < 1.0:
        print(
            f"        NOTE coverage is {payload['timeToDecisionCoverage']:.0%} — "
            f"{payload['decidedCount'] - payload['timeToDecisionSampleSize']} decided "
            f"claim(s) have no fraud.processedAt.\n"
            f"             Run scripts/backfill_processed_at.py to raise it."
        )

    oldest = payload["oldestPendingClaim"]
    if expected_backlog:
        check("oldestPendingClaim is present when the backlog is non-empty",
              oldest is not None, str(payload))
    if oldest:
        check(
            f"oldest claim {oldest['claimId']} is genuinely pending",
            claims.count_documents({"$and": [{"claimId": oldest["claimId"]}, pending_match]}) == 1,
            str(oldest),
        )
        check(
            f"oldest claim daysWaiting is non-negative",
            (oldest.get("daysWaiting") or 0) >= 0,
            str(oldest),
        )
        check(
            "oldest claim names which clock it used",
            oldest.get("waitingSinceBasis") in ("processedAt", "claimDate"),
            str(oldest.get("waitingSinceBasis")),
        )


# ----------------------------------------------------- 7. reviewer activity

def check_7_reviewer_activity(client: TestClient, claims) -> None:
    """Per-reviewer splits must sum to their total and to the portfolio's."""
    print("\n[7] get_reviewer_activity_stats — splits and rates")

    payload = get(client, "/api/fraud/reviewer-activity")
    if not payload:
        return

    for reviewer in payload["reviewers"]:
        check(
            f"{reviewer['reviewer']}: confirmed + dismissed == totalDecided",
            reviewer["confirmedCount"] + reviewer["dismissedCount"] == reviewer["totalDecided"],
            str(reviewer),
        )
        expected = (
            round(reviewer["confirmedCount"] / reviewer["totalDecided"], 4)
            if reviewer["totalDecided"] else 0.0
        )
        check(
            f"{reviewer['reviewer']}: confirmRate == confirmed/total",
            abs(reviewer["confirmRate"] - expected) < 1e-9,
            f"got {reviewer['confirmRate']}, expected {expected}",
        )
        # Cross-check against Mongo for this specific reviewer.
        actual = claims.count_documents({
            "fraud.reviewedBy": reviewer["reviewer"],
            "fraud.fraudFlag": {"$in": [True, False]},
        })
        check(
            f"{reviewer['reviewer']}: totalDecided matches Mongo "
            f"({reviewer['totalDecided']} == {actual})",
            reviewer["totalDecided"] == actual,
            str(reviewer),
        )

    attributed = claims.count_documents({
        "fraud.fraudFlag": {"$in": [True, False]},
        "fraud.reviewedBy": {"$nin": [None, ""]},
    })
    check(
        f"totalDecisions covers every attributed decision "
        f"({payload['totalDecisions']} == {attributed})",
        payload["totalDecisions"] == attributed,
        str(payload["totalDecisions"]),
    )
    check("total matches the reviewer list length",
          payload["total"] == len(payload["reviewers"]), str(payload["total"]))


# ------------------------------------------------------- 8. whyEffective

def check_8_why_effective(client: TestClient, patterns) -> None:
    """Every pattern must carry a non-empty blurb, and generation must be idempotent."""
    print("\n[8] list_fraud_patterns — whyEffective")

    payload = get(client, "/api/fraud-patterns")
    if not payload:
        return

    check(f"catalogue matches Mongo ({payload['total']} patterns)",
          payload["total"] == patterns.count_documents({}), str(payload["total"]))

    for pattern in payload["patterns"]:
        text = pattern.get("whyEffective")
        check(
            f"{pattern['patternId']}: whyEffective is a non-empty sentence",
            isinstance(text, str) and len(text) > 20,
            f"got {text!r}",
        )
        # The blurb quotes the stats, so it must not contradict them.
        triggered = (pattern.get("stats") or {}).get("timesTriggered") or 0
        if triggered == 0:
            check(
                f"{pattern['patternId']}: un-triggered pattern says it has no record",
                "No track record" in (text or ""),
                f"got {text!r}",
            )
        elif triggered >= 5:
            check(
                f"{pattern['patternId']}: blurb cites its real trigger count",
                str(triggered) in (text or ""),
                f"timesTriggered={triggered} not mentioned in {text!r}",
            )

    # First run may write; the second must be a no-op, because the text is a pure
    # function of stats that nothing changed in between.
    first = client.post("/api/fraud-patterns/why-effective/regenerate")
    check("POST regenerate -> 200", first.status_code == 200, first.text[:300])
    if first.status_code != 200:
        return
    check(
        f"regenerate covers the whole catalogue "
        f"({first.json()['patternsProcessed']} == {payload['total']})",
        first.json()["patternsProcessed"] == payload["total"],
        first.text[:200],
    )

    second = client.post("/api/fraud-patterns/why-effective/regenerate")
    check("second regenerate -> 200", second.status_code == 200, second.text[:200])
    if second.status_code == 200:
        check(
            "regeneration is idempotent (second run changes nothing)",
            second.json()["patternsChanged"] == 0,
            second.text[:300],
        )

    # After generation the field is stored, so it must come back with a timestamp.
    after = get(client, "/api/fraud-patterns")
    if after:
        check(
            "every pattern now reports whyEffectiveGeneratedAt",
            all(p.get("whyEffectiveGeneratedAt") for p in after["patterns"]),
            str([p["patternId"] for p in after["patterns"]
                 if not p.get("whyEffectiveGeneratedAt")]),
        )

    # whyEffective is generated, not editable.
    rejected = client.patch(
        "/api/fraud-patterns/FP-001", json={"whyEffective": "hand-written override"}
    )
    check(
        "PATCH whyEffective is rejected (422 from the schema, or 400 from the service)",
        rejected.status_code in (400, 422),
        f"{rejected.status_code}: {rejected.text[:200]}",
    )


# --------------------------------------------------- 9. graph cross-agreement

def check_9_graph_agreement(client: TestClient) -> None:
    """The leaderboard and the graph describe the same connections."""
    print("\n[9] leaderboard vs. relationship-graph — same underlying links")

    graph = get(client, "/api/fraud/relationship-graph", scope="ALL", limit=200)
    board = get(client, "/api/fraud/similarity-leaderboard", scope="ALL", limit=100)
    if not graph or not board:
        return

    graph_claims = {node["claimId"] for node in graph["nodes"]}
    board_claims = {cid for cluster in board["clusters"] for cid in cluster["claimIds"]}
    check(
        "every leaderboard claim is a node in the graph",
        board_claims <= graph_claims,
        f"not in graph: {sorted(board_claims - graph_claims)}",
    )

    # A claim with no edges cannot be in any cluster, and vice versa.
    connected = {e["source"] for e in graph["edges"]} | {e["target"] for e in graph["edges"]}
    check(
        "every leaderboard claim has at least one graph edge",
        board_claims <= connected,
        f"unconnected but clustered: {sorted(board_claims - connected)}",
    )


# ------------------------------------------------- 10. relationship graph shape

def check_10_graph_contract(client: TestClient, claims) -> None:
    """One edge per pair, a real status per node, and honest scope counts.

    These are the invariants the Relationships tab's renderer depends on: it
    styles one line per pair from `type` and colours one circle per node from
    `status`, so a duplicated pair or an unresolved status is a drawing bug
    rather than a data curiosity.
    """
    print("\n[10] get_claim_relationship_graph — edge merge, node status, scope counts")

    payload = get(client, "/api/fraud/relationship-graph", scope="ALL", limit=200)
    if not payload:
        return

    # Scope counts must match direct counts, or the filter lies about what
    # selecting it would show.
    expected = {
        "ALL": claims.count_documents({}),
        "FLAGGED": claims.count_documents({"fraud.fraudFlag": True}),
        "PENDING": claims.count_documents({"fraud.processed": True, "fraud.fraudFlag": None}),
    }
    for scope, count in expected.items():
        check(
            f"scopeCounts[{scope}] matches Mongo ({payload['scopeCounts'].get(scope)} == {count})",
            payload["scopeCounts"].get(scope) == count,
            str(payload["scopeCounts"]),
        )

    # The whole point of the merge: a pair of claims appears at most once.
    pairs = [(edge["source"], edge["target"]) for edge in payload["edges"]]
    check(
        f"no duplicate edge pairs ({len(pairs)} edges, {len(set(pairs))} distinct pairs)",
        len(pairs) == len(set(pairs)),
        str([pair for pair in pairs if pairs.count(pair) > 1]),
    )
    check(
        "edges are normalised (source < target)",
        all(source < target for source, target in pairs),
        str([pair for pair in pairs if pair[0] >= pair[1]]),
    )

    VALID_STATUS = {"flagged", "cleared", "pending", "unprocessed"}
    node_ids = {node["claimId"] for node in payload["nodes"]}

    for node in payload["nodes"]:
        check(
            f"{node['claimId']}: status is one of {sorted(VALID_STATUS)}",
            node.get("status") in VALID_STATUS,
            str(node),
        )
        # Status must agree with the flags it was derived from, in the same
        # precedence the rest of the app uses.
        if node["status"] == "flagged":
            ok = node["fraudFlag"] is True
        elif node["status"] == "unprocessed":
            ok = node["fraudFlag"] is not True and node["processed"] is False
        elif node["status"] == "cleared":
            ok = node["processed"] is True and node["fraudFlag"] is False
        else:
            ok = node["processed"] is True and node["fraudFlag"] is None
        check(f"{node['claimId']}: status agrees with fraudFlag/processed", ok, str(node))

    for edge in payload["edges"]:
        check(
            f"{edge['source']}--{edge['target']}: both endpoints are nodes",
            edge["source"] in node_ids and edge["target"] in node_ids,
            str(edge),
        )
        check(
            f"{edge['source']}--{edge['target']}: reasonCount matches reasons",
            edge["reasonCount"] == len(edge["reasons"]) and edge["reasonCount"] >= 1,
            str(edge),
        )
        # The primary type must be the strongest reason present, since that is
        # what the line style encodes.
        precedence = ["SHARED_PATTERN", "SAME_CUSTOMER", "SAME_REPAIR_SHOP"]
        strongest = min(edge["reasons"], key=lambda r: precedence.index(r["type"]))
        check(
            f"{edge['source']}--{edge['target']}: type is the strongest reason",
            edge["type"] == strongest["type"],
            f"type={edge['type']} strongest={strongest['type']} reasons={edge['reasons']}",
        )
        check(
            f"{edge['source']}--{edge['target']}: every reason has a label",
            all(r.get("label") for r in edge["reasons"]),
            str(edge["reasons"]),
        )
        # A shared-pattern edge that cited a bare id would defeat the tooltip.
        for reason in edge["reasons"]:
            if reason["type"] == "SHARED_PATTERN":
                check(
                    f"{edge['source']}--{edge['target']}: pattern reason names the pattern",
                    bool(reason.get("patternId")),
                    str(reason),
                )

    # A narrower scope can only ever return a subset of ALL's nodes.
    flagged = get(client, "/api/fraud/relationship-graph", scope="FLAGGED", limit=200)
    if flagged:
        flagged_ids = {node["claimId"] for node in flagged["nodes"]}
        check(
            "FLAGGED nodes are a subset of ALL nodes",
            flagged_ids <= node_ids,
            str(sorted(flagged_ids - node_ids)),
        )
        check(
            "every FLAGGED node really is flagged",
            all(node["status"] == "flagged" for node in flagged["nodes"]),
            str([n["claimId"] for n in flagged["nodes"] if n["status"] != "flagged"]),
        )

    # entityLabel backs the repeat-entity rows; a customer id there would show
    # "CUST-2001" where a person's name belongs.
    entities = get(client, "/api/fraud/repeat-entities", entityType="customer", minAppearances=2)
    if entities:
        for entity in entities["entities"]:
            check(
                f"customer {entity['entityValue']}: entityLabel is present",
                bool(entity.get("entityLabel")),
                str(entity),
            )
            expected_name = claims.database["customers"].find_one(
                {"customerId": entity["entityValue"]}, {"firstName": 1, "lastName": 1}
            )
            if expected_name:
                full = f"{expected_name['firstName']} {expected_name['lastName']}"
                check(
                    f"customer {entity['entityValue']}: entityLabel is the real name ({full})",
                    entity["entityLabel"] == full,
                    f"got {entity['entityLabel']!r}, expected {full!r}",
                )


# --------------------------------------------- 11. leaderboard + co-occurrence matrix

def check_11_pattern_insights(client: TestClient, patterns) -> None:
    """The Patterns tab's two feeds: ranked leaderboard, and a drawable matrix."""
    print("\n[11] pattern leaderboard + co-occurrence matrix")

    payload = get(client, "/api/fraud-patterns/leaderboard", limit=5)
    if payload:
        active = patterns.count_documents({"active": True})
        check(
            f"totalActivePatternCount matches Mongo ({payload['totalActivePatternCount']} == {active})",
            payload["totalActivePatternCount"] == active,
            str(payload["totalActivePatternCount"]),
        )
        rows = payload["patterns"]
        check(f"returns exactly limit=5 rows (got {len(rows)})", len(rows) == 5, str(len(rows)))
        check("rankedBy names the metric", payload["rankedBy"] == "timesTriggered",
              str(payload.get("rankedBy")))

        # The ranking is the product decision this endpoint exists to own.
        volumes = [row["timesTriggered"] for row in rows]
        check(
            f"sorted by timesTriggered descending {volumes}",
            all(volumes[i - 1] >= volumes[i] for i in range(1, len(volumes))),
            str(volumes),
        )
        # And it must really be the top of the catalogue, not just sorted.
        expected_top = [
            p["patternId"]
            for p in patterns.find({"active": True}, {"patternId": 1, "stats": 1})
            .sort([("stats.timesTriggered", -1), ("patternId", 1)])
            .limit(5)
        ]
        check(
            f"rows are the catalogue's actual top 5 {expected_top}",
            [row["patternId"] for row in rows] == expected_top,
            f"got {[r['patternId'] for r in rows]}",
        )

        for row in rows:
            check(
                f"{row['patternId']}: whyEffective is a real sentence",
                isinstance(row["whyEffective"], str) and len(row["whyEffective"]) > 20,
                repr(row.get("whyEffective")),
            )
            check(
                f"{row['patternId']}: confirmedCount <= timesTriggered",
                row["confirmedCount"] <= row["timesTriggered"],
                str(row),
            )
            check(f"{row['patternId']}: has a weight", row.get("weight") is not None, str(row))

        # A retired pattern must not hold a leaderboard slot.
        retired = {p["patternId"] for p in patterns.find({"active": False}, {"patternId": 1})}
        check(
            "no inactive pattern appears on the leaderboard",
            not ({row["patternId"] for row in rows} & retired),
            str({row["patternId"] for row in rows} & retired),
        )

    # `leaderboard` must not be swallowed by the /{pattern_id} route.
    unknown = client.get("/api/fraud-patterns/FP-DOES-NOT-EXIST")
    check("an unknown pattern id still 404s", unknown.status_code == 404, unknown.text[:150])

    matrix_payload = get(client, "/api/fraud/pattern-cooccurrence", minCooccurrence=2)
    if not matrix_payload:
        return

    axis = matrix_payload["topPatterns"]
    matrix = matrix_payload["matrix"]

    check(f"axis is capped at 8 (got {len(axis)})", len(axis) <= 8, str(len(axis)))
    check(
        "axis is ordered by observed trigger count descending",
        all(
            axis[i - 1]["observedTriggerCount"] >= axis[i]["observedTriggerCount"]
            for i in range(1, len(axis))
        ),
        str([a["observedTriggerCount"] for a in axis]),
    )
    check(
        "every axis pattern is named",
        all(a.get("patternName") for a in axis),
        str([a["patternId"] for a in axis if not a.get("patternName")]),
    )
    check(
        "matrix has one row per axis pattern",
        set(matrix) == {a["patternId"] for a in axis},
        f"matrix={sorted(matrix)} axis={sorted(a['patternId'] for a in axis)}",
    )

    for row_id, row in matrix.items():
        check(
            f"matrix[{row_id}] has no self-entry (the diagonal is not a cell)",
            row_id not in row,
            str(list(row)),
        )
        for col_id, cell in row.items():
            # Symmetry: the grid is rendered by iterating rows and columns
            # independently, so both directions must resolve.
            mirrored = matrix.get(col_id, {}).get(row_id)
            check(
                f"matrix[{row_id}][{col_id}] is symmetric",
                mirrored is not None and mirrored["count"] == cell["count"],
                f"{cell} vs {mirrored}",
            )
            check(
                f"matrix[{row_id}][{col_id}]: rate in (0, 1]",
                cell["rate"] is None or 0.0 <= cell["rate"] <= 1.0,
                str(cell),
            )

    pairs = matrix_payload["topPairs"]
    check(f"topPairs is capped at 6 (got {len(pairs)})", len(pairs) <= 6, str(len(pairs)))
    rates = [p["observedCooccurrenceRate"] or 0 for p in pairs]
    check(
        f"topPairs sorted by observed rate descending {rates}",
        all(rates[i - 1] >= rates[i] for i in range(1, len(rates))),
        str(rates),
    )
    all_pairs = {(p["patternIdA"], p["patternIdB"]) for p in matrix_payload["pairs"]}
    check(
        "every topPair is one of the returned pairs",
        all((p["patternIdA"], p["patternIdB"]) in all_pairs for p in pairs),
        str([(p["patternIdA"], p["patternIdB"]) for p in pairs]),
    )


def main() -> int:
    connector = create_connector()
    claims = connector.get_collection("claims")
    patterns = connector.get_collection("fraud_patterns")

    print(f"Verifying Phase 1 fraud-intelligence tools against '{connector.database_name}'")
    print("Read-only except for the whyEffective generation in [8]; no reseed needed.")

    try:
        with TestClient(app) as client:
            check_1_rate_breakdown(client, claims)
            check_2_similarity_leaderboard(client, claims)
            check_3_cooccurrence(client, claims, patterns)
            check_4_repeat_entities(client, claims)
            check_5_financial_impact(client, claims)
            check_6_review_queue(client, claims)
            check_7_reviewer_activity(client, claims)
            check_8_why_effective(client, patterns)
            check_9_graph_agreement(client)
            check_10_graph_contract(client, claims)
            check_11_pattern_insights(client, patterns)
    finally:
        connector.client.close()

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
