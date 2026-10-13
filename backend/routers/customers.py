"""Customer HTTP routes."""

from fastapi import APIRouter, Path, Query

from core.dependencies import DirectoryServiceDep
from schemas.customers import CustomerDetailResponse, CustomerListResponse

router = APIRouter(prefix="/customers", tags=["customers"])

CustomerIdPath = Path(..., description="Business customer id, e.g. CUST-1001")


@router.get("", response_model=CustomerListResponse, summary="List customers with policy/claim counts")
def list_customers(
    service: DirectoryServiceDep,
    search: str | None = Query(None, description="Matches first/last name or customerId"),
    page: int = Query(1, ge=1),
    limit: int = Query(25, ge=1, le=200),
    sort: str = Query("-customerSince", description="Field name, prefix with '-' for descending"),
) -> CustomerListResponse:
    return service.list_customers(search=search, page=page, limit=limit, sort=sort)


@router.get(
    "/{customer_id}",
    response_model=CustomerDetailResponse,
    summary="Customer with policies and claim summaries",
)
def get_customer_detail(
    service: DirectoryServiceDep,
    customer_id: str = CustomerIdPath,
) -> CustomerDetailResponse:
    return service.get_customer_detail(customer_id)
