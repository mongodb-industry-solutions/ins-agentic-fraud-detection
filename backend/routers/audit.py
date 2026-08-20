"""Audit-trail routes, backed by claim_fraud_reviews (one document per agent run)."""

from fastapi import APIRouter, Path

from core.dependencies import ClaimsServiceDep
from schemas.claims import AuditTrailResponse

router = APIRouter(prefix="/claims", tags=["audit"])


@router.get(
    "/{claim_id}/audit",
    response_model=AuditTrailResponse,
    summary="Full fraud-review history for a claim, newest first",
)
def list_audit_trail(
    service: ClaimsServiceDep,
    claim_id: str = Path(..., description="Business claim id, e.g. CLM-2001"),
) -> AuditTrailResponse:
    return service.list_audit_trail(claim_id)
