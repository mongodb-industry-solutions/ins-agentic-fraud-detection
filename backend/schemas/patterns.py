"""Pydantic request/response models for the fraud-patterns router."""

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PatternTypeFilter(str, Enum):
    RULE = "RULE"
    HISTORICAL_SIMILARITY = "HISTORICAL_SIMILARITY"
    ALL = "ALL"


class PatternStats(BaseModel):
    timesTriggered: int = 0
    confirmedCount: int = 0
    confirmedFraudRate: float = 0.0


class FraudPattern(BaseModel):
    """A pattern as stored, minus `_id`.

    Extra keys are allowed because RULE patterns carry `ruleLogic` while
    HISTORICAL_SIMILARITY patterns carry their own similarity metadata.
    """

    model_config = ConfigDict(extra="allow")

    patternId: str
    patternType: str | None = None
    name: str | None = None
    description: str | None = None
    severity: str | None = None
    weight: float | None = None
    active: bool | None = None
    stats: PatternStats = Field(default_factory=PatternStats)


class FraudPatternListResponse(BaseModel):
    patterns: list[FraudPattern]
    total: int


class MatchedClaim(BaseModel):
    claimId: str
    claimDate: datetime | None = None
    customerName: str | None = None
    computedScore: float | None = None
    fraudFlag: bool | None = None


class FraudPatternDetailResponse(BaseModel):
    """The pattern plus the actual claims it fired on.

    `stats.timesTriggered` already holds the count; this endpoint is the
    leaderboard drill-down, so it returns the list itself.
    """

    pattern: dict[str, Any]
    matchedClaims: list[MatchedClaim]
    matchedCount: int
