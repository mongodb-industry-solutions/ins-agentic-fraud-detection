"""The human fraud decision and the feedback loop it closes.

Recording a decision is two writes in one request: the verdict on the claim,
and the reliability stats on every pattern that fired for it. The second write
is deliberately synchronous — a pattern's confirmedFraudRate must never be
stale relative to the decisions that produced it.
"""

import logging
from datetime import datetime, timezone
from typing import Any

from core.exceptions import NotFoundError
from repositories.claims_repo import ClaimsRepository
from repositories.patterns_repo import PatternsRepository

logger = logging.getLogger(__name__)

RATE_PRECISION = 4


class FraudDecisionService:
    """Applies a human CONFIRMED_FRAUD / DISMISSED decision."""

    def __init__(self, claims_repo: ClaimsRepository, patterns_repo: PatternsRepository):
        self.claims = claims_repo
        self.patterns = patterns_repo

    def record_decision(
        self,
        claim_id: str,
        decision: str,
        reviewed_by: str,
        dismiss_reason: str | None = None,
    ) -> dict[str, Any]:
        claim = self.claims.get_raw(claim_id)
        if not claim:
            raise NotFoundError("claim", claim_id)

        is_fraud = decision == "CONFIRMED_FRAUD"
        reviewed_at = datetime.now(timezone.utc)

        # Write 1 — the verdict on the claim.
        claim_fields: dict[str, Any] = {
            "fraud.fraudFlag": is_fraud,
            "fraud.flagSource": "HUMAN",
            "fraud.reviewedBy": reviewed_by,
            "fraud.reviewedAt": reviewed_at,
            # A human verdict means this claim has been through fraud review,
            # which is what every consumer reads `processed` to mean.
            #
            # Without this the status branches — here, in the stats facet, and in
            # claimsPresenter.toStatusKey — all test `processed` before
            # `fraudFlag === false`, so a DISMISSED claim that was never scored
            # kept rendering as "Not yet analyzed" and the decision was written
            # but invisible everywhere. Confirmations were unaffected, because
            # `fraudFlag === true` is tested first — so only dismissals silently
            # disappeared.
            "fraud.processed": True,
        }
        if dismiss_reason is not None:
            claim_fields["fraud.dismissReason"] = dismiss_reason
        self.claims.update_fields(claim_id, claim_fields)

        # Write 2 — pattern reliability stats.
        pattern_ids = [
            p["patternId"]
            for p in (claim.get("fraud") or {}).get("matchedPatterns", [])
            if p.get("patternId")
        ]
        updated = [
            self._apply_pattern_feedback(pattern_id, is_fraud)
            for pattern_id in pattern_ids
        ]

        return {
            "claimId": claim_id,
            "decision": decision,
            "fraudFlag": is_fraud,
            "reviewedBy": reviewed_by,
            "reviewedAt": reviewed_at,
            "patternsUpdated": [u for u in updated if u],
        }

    def _apply_pattern_feedback(self, pattern_id: str, is_fraud: bool) -> dict[str, Any] | None:
        """Bump confirmedCount on a confirmation, then recompute the rate.

        A dismissal never lowers confirmedCount — it simply does not raise it.
        The rate is still recomputed either way so it always equals
        confirmedCount / timesTriggered.
        """
        if is_fraud:
            pattern = self.patterns.increment_confirmed_count(pattern_id)
        else:
            pattern = self.patterns.get_by_id(pattern_id)

        if not pattern:
            logger.warning("Claim references unknown pattern '%s'; skipping stat update.", pattern_id)
            return None

        stats = pattern.get("stats") or {}
        times_triggered = stats.get("timesTriggered") or 0
        confirmed_count = stats.get("confirmedCount") or 0
        rate = round(confirmed_count / times_triggered, RATE_PRECISION) if times_triggered else 0.0

        self.patterns.set_confirmed_rate(pattern_id, rate)

        return {
            "patternId": pattern_id,
            "timesTriggered": times_triggered,
            "confirmedCount": confirmed_count,
            "confirmedFraudRate": rate,
        }
