"""Pydantic request/response models for the claims and audit routers."""

from datetime import datetime
from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Complexity(str, Enum):
    SIMPLE = "SIMPLE"
    COMPLEX = "COMPLEX"
    ALL = "ALL"


class ClaimStatusFilter(str, Enum):
    UNPROCESSED = "UNPROCESSED"
    PENDING_REVIEW = "PENDING_REVIEW"
    FLAGGED = "FLAGGED"
    CLEARED = "CLEARED"
    ALL = "ALL"


# ------------------------------------------------------------------ endpoint 1

class ClaimListItem(BaseModel):
    claimId: str
    customerName: str | None = None
    claimType: str | None = None
    coverageType: str | None = None
    claimDate: datetime | None = None
    claimAmount: float | None = None
    claimStatus: str | None = None
    complexity: str | None = None
    processed: bool | None = None
    computedScore: float | None = None
    fraudFlag: bool | None = None


class ClaimListStats(BaseModel):
    total: int = 0
    unprocessed: int = 0
    pendingReview: int = 0
    flagged: int = 0
    cleared: int = 0


class ClaimListResponse(BaseModel):
    stats: ClaimListStats
    claims: list[ClaimListItem]
    total: int
    page: int
    limit: int


# ------------------------------------------------------------------ endpoint 2

class ClaimDetailResponse(BaseModel):
    """The claim merged with its policy and customer.

    Extra keys are allowed on purpose: the frontend's tabs slice this single
    payload, and the claim schema carries optional blocks (thirdParty,
    escalated, ...) that not every document has.
    """

    model_config = ConfigDict(extra="allow")

    claimId: str
    policyId: str | None = None
    customerId: str | None = None
    claimDate: datetime | None = None
    claimType: str | None = None
    coverageType: str | None = None
    claimAmount: float | None = None
    claimStatus: str | None = None
    complexity: str | None = None
    fraud: dict[str, Any] | None = None
    policy: dict[str, Any] | None = None
    customer: dict[str, Any] | None = None


# ------------------------------------------------------------------ endpoint 3

class ClaimUpdateRequest(BaseModel):
    """Whitelist-only partial update.

    `fraud` is not a field on this model and extra keys are forbidden, so a
    body containing scoring fields is rejected by the schema itself; the
    service repeats the check for callers that bypass the router.
    """

    model_config = ConfigDict(extra="forbid")

    claimStatus: str | None = None
    repairShop: str | None = None
    adjusterId: str | None = None
    paymentMethod: str | None = None
    channel: str | None = None
    paidAmount: float | None = None
    policeReport: bool | None = None
    witnessCount: int | None = None
    description: str | None = None
    escalated: bool | None = None

    def changed_fields(self) -> dict[str, Any]:
        """Only the keys the caller actually sent."""
        return self.model_dump(exclude_unset=True)


class ClaimWriteResponse(BaseModel):
    claimId: str
    updated: bool
    updatedFields: list[str] = Field(default_factory=list)
    message: str | None = None


# ------------------------------------------------------------------ endpoint 5

class AuditRecord(BaseModel):
    model_config = ConfigDict(extra="allow")

    claimId: str | None = None
    createdAt: datetime | None = None


class AuditTrailResponse(BaseModel):
    claimId: str
    total: int
    records: list[AuditRecord]


# ------------------------------------------------------------------ endpoint 6

class LinkedClaim(BaseModel):
    claimId: str
    customerName: str | None = None
    claimDate: datetime | None = None
    computedScore: float | None = None
    fraudFlag: bool | None = None
    linkReasons: list[str]
    sharedPatternIds: list[str] = Field(default_factory=list)


class LinkedClaimsResponse(BaseModel):
    claimId: str
    total: int
    linked: list[LinkedClaim]


# ------------------------------------------------------------------ endpoint 7

class BatchSelectRequest(BaseModel):
    claimIds: list[str] = Field(min_length=1)


class RejectedClaim(BaseModel):
    claimId: str
    reason: str


class BatchSelectResponse(BaseModel):
    accepted: list[str]
    rejected: list[RejectedClaim]
    acceptedCount: int
    rejectedCount: int


# ------------------------------------------------------------------ endpoint 8

class FraudDecisionRequest(BaseModel):
    decision: Literal["CONFIRMED_FRAUD", "DISMISSED"]
    reviewedBy: str = Field(min_length=1)
    dismissReason: str | None = None

    @model_validator(mode="after")
    def require_dismiss_reason(self) -> "FraudDecisionRequest":
        if self.decision == "DISMISSED" and not (self.dismissReason or "").strip():
            raise ValueError("dismissReason is required when decision is DISMISSED")
        return self


class PatternStatUpdate(BaseModel):
    patternId: str
    timesTriggered: int
    confirmedCount: int
    confirmedFraudRate: float


class FraudDecisionResponse(BaseModel):
    claimId: str
    decision: str
    fraudFlag: bool
    reviewedBy: str
    reviewedAt: datetime
    patternsUpdated: list[PatternStatUpdate]
