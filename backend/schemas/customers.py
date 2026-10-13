"""Pydantic request/response models for the customers router."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ClaimSummary(BaseModel):
    """The compact claim shape used under a customer, policy or pattern."""

    claimId: str
    claimType: str | None = None
    claimDate: datetime | None = None
    processed: bool | None = None
    computedScore: float | None = None
    fraudFlag: bool | None = None


class CustomerListItem(BaseModel):
    customerId: str
    name: str | None = None
    customerSince: str | None = None
    policyCount: int = 0
    claimCount: int = 0


class CustomerListResponse(BaseModel):
    customers: list[CustomerListItem]
    total: int
    page: int
    limit: int


class CustomerDetailResponse(BaseModel):
    """The customer with their policies and claim summaries.

    Extra keys are allowed for the same reason as ClaimDetailResponse: the
    frontend slices one payload and customer documents carry optional blocks.
    """

    model_config = ConfigDict(extra="allow")

    customerId: str
    name: str | None = None
    firstName: str | None = None
    lastName: str | None = None
    customerSince: str | None = None
    policies: list[dict[str, Any]] = Field(default_factory=list)
    claims: list[ClaimSummary] = Field(default_factory=list)
