"""Every `customers` collection query lives here as a named method."""

from typing import Any

from core.config import get_settings
from db.mdb import MongoDBConnector
from repositories.claims_repo import parse_sort

# The summary shape used wherever a claim is listed *underneath* something else
# (a customer, a policy, a pattern) rather than in the claims table itself.
CLAIM_SUMMARY_PROJECTION = {
    "_id": 0,
    "claimId": 1,
    "claimType": 1,
    "claimDate": 1,
    "processed": "$fraud.processed",
    "computedScore": "$fraud.computedScore",
    "fraudFlag": "$fraud.fraudFlag",
}


class CustomersRepository:
    """Data access for the customers collection."""

    def __init__(self, db: MongoDBConnector):
        self.db = db
        self.collection_name = get_settings().CUSTOMERS_COLLECTION
        self.collection = db.get_collection(self.collection_name)

    def list_with_counts(
        self,
        search: str | None = None,
        page: int = 1,
        limit: int = 25,
        sort: str = "-customerSince",
    ) -> dict[str, Any]:
        """A page of customers, each carrying its policy and claim counts.

        The two $lookups pull whole documents, so the $project immediately
        collapses them to `$size` — nothing but the count ever leaves the stage.
        """
        settings = get_settings()
        sort_field, sort_dir = parse_sort(sort)

        match: dict[str, Any] = {}
        if search:
            regex = {"$regex": search, "$options": "i"}
            match = {"$or": [
                {"firstName": regex},
                {"lastName": regex},
                {"customerId": regex},
            ]}

        pipeline = [
            {"$match": match},
            {"$facet": {
                "rows": [
                    {"$sort": {sort_field: sort_dir}},
                    {"$skip": (page - 1) * limit},
                    {"$limit": limit},
                    {"$lookup": {
                        "from": settings.POLICIES_COLLECTION,
                        "localField": "customerId",
                        "foreignField": "customerId",
                        "as": "policies",
                    }},
                    {"$lookup": {
                        "from": settings.CLAIMS_COLLECTION,
                        "localField": "customerId",
                        "foreignField": "customerId",
                        "as": "claims",
                    }},
                    {"$project": {
                        "_id": 0,
                        "customerId": 1,
                        "name": {"$concat": ["$firstName", " ", "$lastName"]},
                        "customerSince": 1,
                        "policyCount": {"$size": "$policies"},
                        "claimCount": {"$size": "$claims"},
                    }},
                ],
                "count": [{"$count": "n"}],
            }},
        ]

        facet = next(iter(self.collection.aggregate(pipeline)), {})
        return {
            "rows": facet.get("rows", []),
            "count": (facet.get("count") or [{}])[0].get("n", 0),
        }

    def get_by_id(self, customer_id: str) -> dict[str, Any] | None:
        """A customer with their full policies and their claim summaries."""
        settings = get_settings()
        pipeline = [
            {"$match": {"customerId": customer_id}},
            {"$lookup": {
                "from": settings.POLICIES_COLLECTION,
                "localField": "customerId",
                "foreignField": "customerId",
                "as": "policies",
            }},
            {"$lookup": {
                "from": settings.CLAIMS_COLLECTION,
                "let": {"cid": "$customerId"},
                "pipeline": [
                    {"$match": {"$expr": {"$eq": ["$customerId", "$$cid"]}}},
                    {"$sort": {"claimDate": -1}},
                    {"$project": CLAIM_SUMMARY_PROJECTION},
                ],
                "as": "claims",
            }},
            {"$addFields": {"name": {"$concat": ["$firstName", " ", "$lastName"]}}},
        ]
        return next(iter(self.collection.aggregate(pipeline)), None)
