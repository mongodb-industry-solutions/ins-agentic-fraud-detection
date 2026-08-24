"""The fraud-pattern catalogue: its leaderboard, its drill-down, and adding to
or editing the patterns themselves."""

from datetime import datetime, timezone
from typing import Any

from core.exceptions import NotFoundError, ValidationError
from core.serialization import to_jsonable
from repositories.claims_repo import ClaimsRepository
from repositories.patterns_repo import PatternsRepository

# The router's schema owns the enum; the service takes plain dicts like every
# other service here, so it only needs the one value it branches on.
RULE_PATTERN_TYPE = "RULE"


# Written by the decision flow and the embedding procedure, never by a caller.
# The request schema already forbids them; this repeats the check for service
# level callers (the Phase 4 agent tools) that build the dict directly.
FORBIDDEN_UPDATE_KEYS = frozenset(
    {"patternId", "patternType", "stats", "embedding", "embeddingText", "createdAt"}
)


class PatternsService:
    """Orchestrates the pattern leaderboard, per-pattern detail, and writes."""

    def __init__(self, patterns_repo: PatternsRepository, claims_repo: ClaimsRepository):
        self.patterns = patterns_repo
        self.claims = claims_repo

    @staticmethod
    def _public(pattern: dict[str, Any]) -> dict[str, Any]:
        """A pattern as callers see it: the 1024-float vector replaced by the one
        fact anyone needs about it.

        The vector is machine input, useless to a client and larger than the rest
        of the document put together. But whether a pattern *has* one decides
        whether it takes part in similarity matching at all, so dropping the
        field silently would leave a caller unable to tell a freshly created
        pattern from an embedded one — hence a boolean rather than an omission.
        """
        public = {key: value for key, value in to_jsonable(pattern).items() if key != "embedding"}
        public["hasEmbedding"] = bool(pattern.get("embedding"))
        return public

    def list_patterns(self, pattern_type: str, active: bool | None, sort: str) -> dict[str, Any]:
        patterns = [
            self._public(pattern)
            for pattern in self.patterns.list_all(
                pattern_type=pattern_type, active=active, sort=sort
            )
        ]
        return {"patterns": patterns, "total": len(patterns)}

    def create_pattern(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Add a pattern to the catalogue.

        Two things are deliberately not done here. Stats start at zero rather
        than being inherited or estimated, because a brand-new pattern has no
        track record to report. And no embedding is generated: that is the
        embedding procedure's job, so a similarity pattern is created inert and
        the response says so — it takes no part in matching until embedded.
        """
        pattern_type = payload["patternType"]
        conditions = payload.get("conditions") or []

        document: dict[str, Any] = {
            "patternId": self.patterns.next_pattern_id(),
            "patternType": pattern_type,
            "name": payload["name"].strip(),
            "description": (payload.get("description") or "").strip(),
            "appliesTo": payload["appliesTo"],
            "severity": payload["severity"],
            "weight": payload["weight"],
            "active": payload["active"],
            "stats": {"timesTriggered": 0, "confirmedCount": 0, "confirmedFraudRate": 0.0},
            "exampleClaimIds": [],
            "createdAt": datetime.now(timezone.utc),
            "updatedAt": datetime.now(timezone.utc),
        }

        if pattern_type == RULE_PATTERN_TYPE:
            document["ruleLogic"] = self._to_rule_logic(conditions)
        else:
            document["embeddingText"] = payload["embeddingText"].strip()

        stored = self.patterns.insert_pattern(document)
        is_embedding_pending = pattern_type != RULE_PATTERN_TYPE

        return {
            "patternId": stored["patternId"],
            "created": True,
            "embeddingPending": is_embedding_pending,
            "message": (
                f"Created {stored['patternId']}."
                + (
                    " It will not be used in similarity matching until its embedding "
                    "has been generated."
                    if is_embedding_pending
                    else ""
                )
            ),
            "pattern": self._public(stored),
        }

    @staticmethod
    def _to_rule_logic(conditions: list[dict[str, Any]]) -> dict[str, Any]:
        """Store one condition flat, several under `conditions`.

        Every hand-authored rule in the catalogue is a single flat comparison
        ({field, operator, value}), so a single-condition rule created here is
        shaped identically to those and needs no special handling downstream.
        The flat shape simply cannot express an AND of several comparisons,
        which is the only case that gets the nested form.
        """
        cleaned = [
            {key: value for key, value in condition.items() if value is not None}
            for condition in conditions
        ]
        return cleaned[0] if len(cleaned) == 1 else {"conditions": cleaned}

    def update_pattern(self, pattern_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        """Apply a whitelisted partial update to one pattern.

        Retiring a pattern is a `PATCH {"active": false}`, not a delete: the
        claims it already scored still cite it, so the document has to stay
        readable for their fraud reports to keep making sense.
        """
        if not fields:
            raise ValidationError("No updatable fields were provided.")

        rejected = sorted(key for key in fields if key in FORBIDDEN_UPDATE_KEYS)
        if rejected:
            raise ValidationError(
                "These fields cannot be edited through this endpoint; reliability "
                "stats are derived from recorded decisions and embeddings are "
                "written by the embedding procedure.",
                details={"rejectedFields": rejected},
            )

        updated = self.patterns.update_fields(pattern_id, fields)
        if not updated:
            raise NotFoundError("fraud pattern", pattern_id)

        return {
            "patternId": pattern_id,
            "updated": True,
            "updatedFields": sorted(fields),
            "message": f"Updated {len(fields)} field(s) on {pattern_id}.",
            "pattern": self._public(updated),
        }

    def get_pattern_detail(self, pattern_id: str) -> dict[str, Any]:
        """The pattern plus the claims it actually fired on.

        The matched claims are a separate query rather than a $lookup: the
        pattern id sits inside each claim's `fraud.matchedPatterns` array, so
        the natural direction of the join is claims -> pattern, not the reverse.
        """
        pattern = self.patterns.get_by_id(pattern_id)
        if not pattern:
            raise NotFoundError("fraud pattern", pattern_id)

        matched = to_jsonable(self.claims.find_by_pattern(pattern_id))
        return {
            "pattern": self._public(pattern),
            "matchedClaims": matched,
            "matchedCount": len(matched),
        }
