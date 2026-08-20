"""Every `policies` collection query lives here as a named method.

Two schema facts drive the shapes below: a policy has no flat `renewalDate`
(the term end is `effectivePeriod.endDate`, which is what the default sort
uses), and `coverageType` lives inside the `coverages` array, so filtering on
it is a match against `coverages.coverageType`.
"""

from typing import Any

from core.config import get_settings
from db.mdb import MongoDBConnector
from repositories.claims_repo import parse_sort
from repositories.customers_repo import CLAIM_SUMMARY_PROJECTION

DEFAULT_POLICY_SORT = "-effectivePeriod.endDate"

LIST_PROJECTION = {
    "_id": 0,
    "policyId": 1,
    "customerId": 1,
    "customerName": 1,
    "policyType": 1,
    "productCode": 1,
    "status": 1,
    "effectivePeriod": 1,
    "annualPremium": "$premium.annualPremium",
    "coverageTypes": "$coverages.coverageType",
}


class PoliciesRepository:
    """Data access for the policies collection."""

    def __init__(self, db: MongoDBConnector):
        self.db = db
        self.collection_name = get_settings().POLICIES_COLLECTION
        self.collection = db.get_collection(self.collection_name)

    def list_with_customer(
        self,
        search: str | None = None,
        status: str = "ALL",
        coverage_type: str = "ALL",
        page: int = 1,
        limit: int = 25,
        sort: str = DEFAULT_POLICY_SORT,
    ) -> dict[str, Any]:
        """A page of policies, each row carrying its customer's name.

        `search` is applied *after* the customer join so it can match a customer
        name as well as the policy's own identifiers; the $facet therefore sits
        after both, keeping `total` consistent with the rows returned.
        """
        sort_field, sort_dir = parse_sort(sort)

        filters: dict[str, Any] = {}
        if status != "ALL":
            filters["status"] = status
        if coverage_type != "ALL":
            filters["coverages.coverageType"] = coverage_type

        search_match: dict[str, Any] = {}
        if search:
            regex = {"$regex": search, "$options": "i"}
            search_match = {"$or": [
                {"policyId": regex},
                {"policyType": regex},
                {"productCode": regex},
                {"customerName": regex},
            ]}

        pipeline = [
            {"$match": filters},
            {"$lookup": {
                "from": get_settings().CUSTOMERS_COLLECTION,
                "localField": "customerId",
                "foreignField": "customerId",
                "as": "customer",
            }},
            {"$unwind": {"path": "$customer", "preserveNullAndEmptyArrays": True}},
            {"$addFields": {
                "customerName": {"$concat": ["$customer.firstName", " ", "$customer.lastName"]},
            }},
            {"$match": search_match},
            {"$facet": {
                "rows": [
                    {"$sort": {sort_field: sort_dir}},
                    {"$skip": (page - 1) * limit},
                    {"$limit": limit},
                    {"$project": LIST_PROJECTION},
                ],
                "count": [{"$count": "n"}],
            }},
        ]

        facet = next(iter(self.collection.aggregate(pipeline)), {})
        return {
            "rows": facet.get("rows", []),
            "count": (facet.get("count") or [{}])[0].get("n", 0),
        }

    def get_by_id(self, policy_id: str) -> dict[str, Any] | None:
        """A policy with its customer and every claim filed against it."""
        settings = get_settings()
        pipeline = [
            {"$match": {"policyId": policy_id}},
            {"$lookup": {
                "from": settings.CUSTOMERS_COLLECTION,
                "localField": "customerId",
                "foreignField": "customerId",
                "as": "customer",
            }},
            {"$unwind": {"path": "$customer", "preserveNullAndEmptyArrays": True}},
            {"$lookup": {
                "from": settings.CLAIMS_COLLECTION,
                "let": {"pid": "$policyId"},
                "pipeline": [
                    {"$match": {"$expr": {"$eq": ["$policyId", "$$pid"]}}},
                    {"$sort": {"claimDate": -1}},
                    {"$project": CLAIM_SUMMARY_PROJECTION},
                ],
                "as": "claims",
            }},
        ]
        return next(iter(self.collection.aggregate(pipeline)), None)
