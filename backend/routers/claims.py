"""Claims HTTP routes.

Handlers are sync `def` on purpose: pymongo blocks, and FastAPI runs sync
handlers in a threadpool. Each one parses input, calls exactly one service
method, and returns it.
"""

from fastapi import APIRouter, Path, Query

from core.dependencies import ClaimsServiceDep
from schemas.claims import (
    BatchSelectRequest,
    BatchSelectResponse,
    ClaimDetailResponse,
    ClaimListResponse,
    ClaimStatusFilter,
    ClaimUpdateRequest,
    ClaimWriteResponse,
    Complexity,
    LinkedClaimsResponse,
)

router = APIRouter(prefix="/claims", tags=["claims"])

ClaimIdPath = Path(..., description="Business claim id, e.g. CLM-2001")


@router.get("", response_model=ClaimListResponse, summary="List claims with segment stats")
def list_claims(
    service: ClaimsServiceDep,
    complexity: Complexity = Query(Complexity.ALL),
    status: ClaimStatusFilter = Query(ClaimStatusFilter.ALL),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    sort: str = Query("-claimDate", description="Field name, prefix with '-' for descending"),
) -> ClaimListResponse:
    return service.list_claims(
        complexity=complexity.value,
        status=status.value,
        page=page,
        limit=limit,
        sort=sort,
    )


@router.post(
    "/batch/select",
    response_model=BatchSelectResponse,
    summary="Validate a batch selection (Phase 2: validation only, no agent run)",
)
def select_batch_for_processing(
    payload: BatchSelectRequest,
    service: ClaimsServiceDep,
) -> BatchSelectResponse:
    return service.select_batch(payload.claimIds)


@router.get("/{claim_id}", response_model=ClaimDetailResponse, summary="Claim with policy and customer")
def get_claim_detail(service: ClaimsServiceDep, claim_id: str = ClaimIdPath) -> ClaimDetailResponse:
    return service.get_claim_detail(claim_id)


@router.patch("/{claim_id}", response_model=ClaimWriteResponse, summary="Partial claim-detail update")
def update_claim(
    payload: ClaimUpdateRequest,
    service: ClaimsServiceDep,
    claim_id: str = ClaimIdPath,
) -> ClaimWriteResponse:
    return service.update_claim(claim_id, payload.changed_fields())


@router.post("/{claim_id}/close", response_model=ClaimWriteResponse, summary="Close a claim")
def close_claim(service: ClaimsServiceDep, claim_id: str = ClaimIdPath) -> ClaimWriteResponse:
    return service.close_claim(claim_id)


@router.get("/{claim_id}/linked", response_model=LinkedClaimsResponse, summary="Cross-referenced claims")
def list_linked_claims(
    service: ClaimsServiceDep,
    claim_id: str = ClaimIdPath,
    limit: int = Query(10, ge=1, le=50),
) -> LinkedClaimsResponse:
    return service.list_linked_claims(claim_id, limit=limit)
