"""Policy HTTP routes."""

from fastapi import APIRouter, Path, Query

from core.dependencies import DirectoryServiceDep
from repositories.policies_repo import DEFAULT_POLICY_SORT
from schemas.policies import PolicyDetailResponse, PolicyListResponse

router = APIRouter(prefix="/policies", tags=["policies"])

PolicyIdPath = Path(..., description="Business policy id, e.g. POL-1001")


@router.get("", response_model=PolicyListResponse, summary="List policies with customer name")
def list_policies(
    service: DirectoryServiceDep,
    search: str | None = Query(None, description="Matches policyId, type, product code or customer name"),
    status: str = Query("ALL", description="Policy status, or ALL"),
    coverageType: str = Query("ALL", description="Matches any entry in the policy's coverages[]"),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    sort: str = Query(
        DEFAULT_POLICY_SORT,
        description="Field name, prefix with '-' for descending. The term end is "
                    "effectivePeriod.endDate — there is no flat renewalDate field.",
    ),
) -> PolicyListResponse:
    return service.list_policies(
        search=search,
        status=status,
        coverage_type=coverageType,
        page=page,
        limit=limit,
        sort=sort,
    )


@router.get(
    "/{policy_id}",
    response_model=PolicyDetailResponse,
    summary="Policy with customer and its claims",
)
def get_policy_detail(
    service: DirectoryServiceDep,
    policy_id: str = PolicyIdPath,
) -> PolicyDetailResponse:
    return service.get_policy_detail(policy_id)
