"""Pydantic request/response models for the policies router."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from schemas.customers import ClaimSummary


class PolicyListItem(BaseModel):
    policyId: str
    customerId: str | None = None
    customerName: str | None = None
    policyType: str | None = None
    productCode: str | None = None
    status: str | None = None
    effectivePeriod: dict[str, Any] | None = None
    annualPremium: float | None = None
    coverageTypes: list[str] = Field(default_factory=list)


class PolicyListResponse(BaseModel):
    policies: list[PolicyListItem]
    total: int
    page: int
    limit: int


class PolicyDetailResponse(BaseModel):
    """The policy merged with its customer and the claims filed against it."""

    model_config = ConfigDict(extra="allow")

    policyId: str
    customerId: str | None = None
    policyType: str | None = None
    status: str | None = None
    effectivePeriod: dict[str, Any] | None = None
    coverages: list[dict[str, Any]] = Field(default_factory=list)
    customer: dict[str, Any] | None = None
    claims: list[ClaimSummary] = Field(default_factory=list)
