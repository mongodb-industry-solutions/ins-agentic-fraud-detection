"""Reads over the fraud-pattern catalogue and its drill-down."""

from typing import Any

from core.exceptions import NotFoundError
from core.serialization import to_jsonable
from repositories.claims_repo import ClaimsRepository
from repositories.patterns_repo import PatternsRepository


class PatternsService:
    """Orchestrates the pattern leaderboard and per-pattern detail."""

    def __init__(self, patterns_repo: PatternsRepository, claims_repo: ClaimsRepository):
        self.patterns = patterns_repo
        self.claims = claims_repo

    def list_patterns(self, pattern_type: str, active: bool | None, sort: str) -> dict[str, Any]:
        patterns = to_jsonable(
            self.patterns.list_all(pattern_type=pattern_type, active=active, sort=sort)
        )
        return {"patterns": patterns, "total": len(patterns)}

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
            "pattern": to_jsonable(pattern),
            "matchedClaims": matched,
            "matchedCount": len(matched),
        }
