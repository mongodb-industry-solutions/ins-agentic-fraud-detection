"""Business rules for claims: whitelist enforcement, close guard, batch validation."""

import logging
from datetime import datetime, timezone
from typing import Any

from core.exceptions import ConflictError, NotFoundError, ValidationError
from core.serialization import to_jsonable
from repositories.claims_repo import ClaimsRepository
from repositories.reviews_repo import ReviewsRepository

logger = logging.getLogger(__name__)

# Keys a claim-detail edit may never touch. Scoring is the agent's job.
FORBIDDEN_UPDATE_KEYS = {"fraud", "claimId", "_id", "customerId", "policyId"}


class ClaimsService:
    """Orchestrates claim reads and the rule-bearing claim writes."""

    def __init__(self, claims_repo: ClaimsRepository, reviews_repo: ReviewsRepository):
        self.claims = claims_repo
        self.reviews = reviews_repo

    # ------------------------------------------------------------ endpoint 1

    def list_claims(self, complexity: str, status: str, page: int, limit: int, sort: str) -> dict[str, Any]:
        result = self.claims.list_with_stats(
            complexity=complexity, status=status, page=page, limit=limit, sort=sort
        )
        return {
            "stats": result["stats"],
            "claims": to_jsonable(result["rows"]),
            "total": result["count"],
            "page": page,
            "limit": limit,
        }

    # ------------------------------------------------------------ endpoint 2

    def get_claim_detail(self, claim_id: str) -> dict[str, Any]:
        claim = self.claims.get_by_id(claim_id)
        if not claim:
            raise NotFoundError("claim", claim_id)
        return to_jsonable(claim)

    # ------------------------------------------------------------ endpoint 3

    def update_claim(self, claim_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        """Apply a whitelisted partial update.

        The pydantic model already forbids unknown keys; this check also covers
        service-level callers (Phase 4 tools) that construct the dict directly.
        """
        if not fields:
            raise ValidationError("No updatable fields were provided.")

        rejected = sorted(
            key for key in fields
            if key in FORBIDDEN_UPDATE_KEYS or key.startswith("fraud.")
        )
        if rejected:
            raise ValidationError(
                "These fields cannot be edited through this endpoint; "
                "fraud scoring is written by the fraud-assessment flow only.",
                details={"rejectedFields": rejected},
            )

        matched = self.claims.update_fields(claim_id, fields)
        if matched == 0:
            raise NotFoundError("claim", claim_id)

        return {
            "claimId": claim_id,
            "updated": True,
            "updatedFields": sorted(fields),
            "message": f"Updated {len(fields)} field(s) on {claim_id}.",
        }

    # ------------------------------------------------------------ endpoint 4

    def close_claim(self, claim_id: str) -> dict[str, Any]:
        """Close a claim unless a fraud recommendation is still undecided."""
        claim = self.claims.get_raw(claim_id)
        if not claim:
            raise NotFoundError("claim", claim_id)

        fraud = claim.get("fraud") or {}
        if fraud.get("processed") is True and fraud.get("fraudFlag") is None:
            raise ConflictError(
                f"Claim {claim_id} has a fraud recommendation awaiting a human decision "
                f"and cannot be closed until it is confirmed or dismissed.",
                details={"computedScore": fraud.get("computedScore")},
            )

        self.claims.update_fields(claim_id, {
            "claimStatus": "CLOSED",
            "closedAt": datetime.now(timezone.utc),
        })
        return {
            "claimId": claim_id,
            "updated": True,
            "updatedFields": ["claimStatus", "closedAt"],
            "message": f"Claim {claim_id} closed.",
        }

    # ------------------------------------------------------------ endpoint 5

    def list_audit_trail(self, claim_id: str) -> dict[str, Any]:
        if not self.claims.get_raw(claim_id):
            raise NotFoundError("claim", claim_id)
        records = to_jsonable(self.reviews.list_for_claim(claim_id))
        return {"claimId": claim_id, "total": len(records), "records": records}

    # ------------------------------------------------------------ endpoint 6

    def list_linked_claims(self, claim_id: str, limit: int = 10) -> dict[str, Any]:
        """Linked claims, each annotated with why it is linked."""
        claim = self.claims.get_raw(claim_id)
        if not claim:
            raise NotFoundError("claim", claim_id)

        source_patterns = {
            p["patternId"]
            for p in (claim.get("fraud") or {}).get("matchedPatterns", [])
            if p.get("patternId")
        }

        linked = []
        for other in self.claims.find_linked(claim, limit=limit):
            reasons: list[str] = []
            if other.get("customerId") == claim.get("customerId"):
                reasons.append("Same customer")
            if claim.get("repairShop") and other.get("repairShop") == claim.get("repairShop"):
                reasons.append(f"Same repair shop ({claim['repairShop']})")

            shared = sorted(
                {p["patternId"] for p in (other.get("matchedPatterns") or []) if p.get("patternId")}
                & source_patterns
            )
            if shared:
                reasons.append(f"Shared fraud pattern(s): {', '.join(shared)}")

            linked.append({
                "claimId": other["claimId"],
                "customerName": other.get("customerName"),
                "claimDate": other.get("claimDate"),
                "computedScore": other.get("computedScore"),
                "fraudFlag": other.get("fraudFlag"),
                "linkReasons": reasons,
                "sharedPatternIds": shared,
            })

        return {"claimId": claim_id, "total": len(linked), "linked": to_jsonable(linked)}

    # ------------------------------------------------------------ endpoint 7

    def select_batch(self, claim_ids: list[str]) -> dict[str, Any]:
        """Validate a batch selection. Phase 2 scope: no agent is invoked."""
        found = self.claims.find_for_batch(claim_ids)

        accepted: list[str] = []
        rejected: list[dict[str, str]] = []
        seen: set[str] = set()

        for claim_id in claim_ids:
            if claim_id in seen:
                rejected.append({"claimId": claim_id, "reason": "duplicate id in request"})
                continue
            seen.add(claim_id)

            claim = found.get(claim_id)
            if claim is None:
                rejected.append({"claimId": claim_id, "reason": "not found"})
            elif claim.get("complexity") != "SIMPLE":
                rejected.append({"claimId": claim_id, "reason": "not a simple claim"})
            elif (claim.get("fraud") or {}).get("processed") is not False:
                rejected.append({"claimId": claim_id, "reason": "already processed"})
            else:
                accepted.append(claim_id)

        return {
            "accepted": accepted,
            "rejected": rejected,
            "acceptedCount": len(accepted),
            "rejectedCount": len(rejected),
        }
