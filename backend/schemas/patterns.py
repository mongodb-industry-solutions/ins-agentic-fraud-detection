"""Pydantic request/response models for the fraud-patterns router."""

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PatternType(str, Enum):
    RULE = "RULE"
    HISTORICAL_SIMILARITY = "HISTORICAL_SIMILARITY"


class PatternTypeFilter(str, Enum):
    RULE = "RULE"
    HISTORICAL_SIMILARITY = "HISTORICAL_SIMILARITY"
    ALL = "ALL"


class ClaimTypeApplied(str, Enum):
    """The claim-type vocabulary the catalogue is written against.

    Closed rather than free text: a typo'd claim type would create a pattern
    that silently never fires. Extending the demo's claim types means adding to
    this enum, which is the point — the addition should be deliberate.
    """

    AUTO_COLLISION = "AUTO_COLLISION"
    AUTO_THEFT = "AUTO_THEFT"
    AUTO_GLASS = "AUTO_GLASS"


class CoverageTypeApplied(str, Enum):
    COLLISION = "COLLISION"
    COMPREHENSIVE = "COMPREHENSIVE"
    LIABILITY_BODILY_INJURY = "LIABILITY_BODILY_INJURY"


class ConditionOperator(str, Enum):
    EQUALS = "EQUALS"
    NOT_EQUALS = "NOT_EQUALS"
    GREATER_THAN = "GREATER_THAN"
    LESS_THAN = "LESS_THAN"
    IN = "IN"
    DAYS_BETWEEN_LESS_THAN = "DAYS_BETWEEN_LESS_THAN"


class Severity(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


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


class AppliesTo(BaseModel):
    """Both lists are required and non-empty: a pattern that applies to nothing
    can never fire, so it is a mistake rather than a valid state."""

    model_config = ConfigDict(extra="forbid")

    claimTypes: list[ClaimTypeApplied] = Field(min_length=1)
    coverageTypes: list[CoverageTypeApplied] = Field(min_length=1)


class RuleCondition(BaseModel):
    """One field comparison. `comparisonField` compares against another field on
    the claim (as FP-001 and friends do) instead of against a literal."""

    model_config = ConfigDict(extra="forbid")

    field: str = Field(min_length=1, max_length=80)
    operator: ConditionOperator
    value: Any = None
    comparisonField: str | None = Field(None, max_length=80)

    @model_validator(mode="after")
    def _normalize_value(self) -> "RuleCondition":
        """Coerce the string a form field always sends into the type the stored
        rules actually use: booleans as booleans, numbers as numbers.

        Without this, a condition on `policeReport` would be saved as the string
        "false" and could never match the boolean `false` on a claim.
        """
        if isinstance(self.value, str):
            text = self.value.strip()
            lowered = text.lower()
            if lowered in {"true", "false"}:
                self.value = lowered == "true"
            elif lowered in {"null", "none", ""}:
                self.value = None
            else:
                try:
                    number = float(text)
                except ValueError:
                    self.value = text
                else:
                    self.value = int(number) if number.is_integer() else number

        if self.value is None and not self.comparisonField:
            raise ValueError("A condition needs a value or a comparisonField.")
        return self


class FraudPatternCreateRequest(BaseModel):
    """A new pattern, minus everything the system owns.

    `patternId`, `stats`, `createdAt` and `embedding` are absent on purpose: the
    id is assigned by the service, the stats start at zero by definition, and
    the embedding is written by the embedding procedure — a caller supplying any
    of them would be asserting history the pattern does not have.
    """

    model_config = ConfigDict(extra="forbid")

    patternType: PatternType
    name: str = Field(min_length=1, max_length=200)
    description: str = Field("", max_length=2000)
    severity: Severity = Severity.MEDIUM
    weight: float = Field(ge=0, le=12)
    active: bool = True
    appliesTo: AppliesTo

    # Exactly one of these applies, enforced below by pattern type.
    conditions: list[RuleCondition] | None = None
    embeddingText: str | None = Field(None, min_length=1, max_length=4000)

    @model_validator(mode="after")
    def _check_type_specific_fields(self) -> "FraudPatternCreateRequest":
        if self.patternType is PatternType.RULE:
            if not self.conditions:
                raise ValueError("A RULE pattern needs at least one condition.")
            if self.embeddingText is not None:
                raise ValueError(
                    "embeddingText belongs to HISTORICAL_SIMILARITY patterns; a RULE is "
                    "matched by its conditions, not by narrative similarity."
                )
        else:
            if not self.embeddingText:
                raise ValueError(
                    "A HISTORICAL_SIMILARITY pattern needs embeddingText — that text is "
                    "what gets embedded and compared against claim narratives."
                )
            if self.conditions is not None:
                raise ValueError(
                    "conditions belong to RULE patterns; a similarity pattern is matched "
                    "by narrative, not by field comparison."
                )
        return self


class FraudPatternCreateResponse(BaseModel):
    patternId: str
    created: bool
    # Similarity patterns are inert until the embedding procedure runs, so the
    # response says so rather than leaving the caller to infer it.
    embeddingPending: bool
    message: str | None = None
    pattern: dict[str, Any]


class FraudPatternUpdateRequest(BaseModel):
    """Whitelist-only partial update of a pattern's editable configuration.

    `stats` is absent and extra keys are forbidden, so a body trying to rewrite
    reliability figures is rejected by the schema itself — those are derived
    from real decisions by the decision endpoint, never set by hand.

    `ruleLogic`, `appliesTo` and `embeddingText` are also absent: changing what
    a pattern *matches* invalidates the stats it has already accumulated (and,
    for a similarity pattern, its embedding), so it needs its own endpoint with
    its own re-embedding and stat-reset semantics rather than riding along here.
    """

    model_config = ConfigDict(extra="forbid")

    active: bool | None = None
    name: str | None = Field(None, min_length=1, max_length=200)
    description: str | None = Field(None, max_length=2000)
    severity: Severity | None = None
    # computedScore is capped at 12, so a single pattern worth more than the
    # whole cap could never mean anything.
    weight: float | None = Field(None, ge=0, le=12)

    def changed_fields(self) -> dict[str, Any]:
        """Only the keys the caller actually sent, enums flattened to strings."""
        return self.model_dump(exclude_unset=True, mode="json")


class FraudPatternWriteResponse(BaseModel):
    patternId: str
    updated: bool
    updatedFields: list[str] = Field(default_factory=list)
    message: str | None = None
    # The pattern as it now stands, so the caller does not have to re-read to
    # find out what it agreed to.
    pattern: dict[str, Any]


class FraudPatternDetailResponse(BaseModel):
    """The pattern plus the actual claims it fired on.

    `stats.timesTriggered` already holds the count; this endpoint is the
    leaderboard drill-down, so it returns the list itself.
    """

    pattern: dict[str, Any]
    matchedClaims: list[MatchedClaim]
    matchedCount: int
