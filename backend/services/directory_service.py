"""Customer and policy browsing.

These are read-only directory views with no business rules of their own, so
one service covers both rather than two near-identical files.
"""

from typing import Any

from core.exceptions import NotFoundError
from core.serialization import to_jsonable
from repositories.customers_repo import CustomersRepository
from repositories.policies_repo import PoliciesRepository


class DirectoryService:
    """Orchestrates the customer and policy read endpoints."""

    def __init__(self, customers_repo: CustomersRepository, policies_repo: PoliciesRepository):
        self.customers = customers_repo
        self.policies = policies_repo

    # ------------------------------------------------------------- customers

    def list_customers(self, search: str | None, page: int, limit: int, sort: str) -> dict[str, Any]:
        result = self.customers.list_with_counts(search=search, page=page, limit=limit, sort=sort)
        return {
            "customers": to_jsonable(result["rows"]),
            "total": result["count"],
            "page": page,
            "limit": limit,
        }

    def get_customer_detail(self, customer_id: str) -> dict[str, Any]:
        customer = self.customers.get_by_id(customer_id)
        if not customer:
            raise NotFoundError("customer", customer_id)
        return to_jsonable(customer)

    # -------------------------------------------------------------- policies

    def list_policies(
        self,
        search: str | None,
        status: str,
        coverage_type: str,
        page: int,
        limit: int,
        sort: str,
    ) -> dict[str, Any]:
        result = self.policies.list_with_customer(
            search=search,
            status=status,
            coverage_type=coverage_type,
            page=page,
            limit=limit,
            sort=sort,
        )
        return {
            "policies": to_jsonable(result["rows"]),
            "total": result["count"],
            "page": page,
            "limit": limit,
        }

    def get_policy_detail(self, policy_id: str) -> dict[str, Any]:
        policy = self.policies.get_by_id(policy_id)
        if not policy:
            raise NotFoundError("policy", policy_id)
        return to_jsonable(policy)
