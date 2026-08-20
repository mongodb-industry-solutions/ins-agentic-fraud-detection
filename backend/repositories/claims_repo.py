"""Every `claims` collection query lives here as a named method.

Phase 4's agent tools are expected to call these same methods (notably
`get_by_id`) rather than growing a second copy of the same $lookup.
"""

from datetime import datetime, timezone
from typing import Any

from pymongo import ASCENDING, DESCENDING

from core.config import get_settings
from db.mdb import MongoDBConnector

# Status filter -> the Mongo predicate that defines it. PENDING_REVIEW means
# the agent has scored the claim but no human has decided yet.
STATUS_MATCHES: dict[str, dict] = {
    "UNPROCESSED": {"fraud.processed": False},
    "PENDING_REVIEW": {"fraud.processed": True, "fraud.fraudFlag": None},
    "FLAGGED": {"fraud.fraudFlag": True},
    "CLEARED": {"fraud.fraudFlag": False},
    "ALL": {},
}

LIST_PROJECTION = {
    "_id": 0,
    "claimId": 1,
    "claimType": 1,
    "coverageType": 1,
    "claimDate": 1,
    "claimAmount": 1,
    "claimStatus": 1,
    "complexity": 1,
    "customerName": {"$concat": ["$customer.firstName", " ", "$customer.lastName"]},
    "processed": "$fraud.processed",
    "computedScore": "$fraud.computedScore",
    "fraudFlag": "$fraud.fraudFlag",
}


def parse_sort(sort: str) -> tuple[str, int]:
    """Turn a `-field` / `field` sort token into a (field, direction) pair."""
    if sort.startswith("-"):
        return sort[1:], DESCENDING
    return sort.lstrip("+"), ASCENDING


class ClaimsRepository:
    """Data access for the claims collection."""

    def __init__(self, db: MongoDBConnector):
        self.db = db
        self.collection_name = get_settings().CLAIMS_COLLECTION
        self.collection = db.get_collection(self.collection_name)

    # ---------------------------------------------------------------- reads

    def list_with_stats(
        self,
        complexity: str = "ALL",
        status: str = "ALL",
        page: int = 1,
        limit: int = 25,
        sort: str = "-claimDate",
    ) -> dict[str, Any]:
        """One $facet: segment-wide stats, the filtered page, and its count.

        `stats` is deliberately computed over the segment only (before the
        status filter) so the stat cards keep showing the whole segment while
        the table below is filtered.
        """
        segment_match = {} if complexity == "ALL" else {"complexity": complexity}
        status_match = STATUS_MATCHES[status]
        sort_field, sort_dir = parse_sort(sort)

        pipeline = [
            {"$match": segment_match},
            {"$facet": {
                "stats": [{"$group": {
                    "_id": None,
                    "total": {"$sum": 1},
                    "unprocessed": {"$sum": {"$cond": [{"$eq": ["$fraud.processed", False]}, 1, 0]}},
                    "pendingReview": {"$sum": {"$cond": [
                        {"$and": [
                            {"$eq": ["$fraud.processed", True]},
                            {"$eq": ["$fraud.fraudFlag", None]},
                        ]}, 1, 0]}},
                    "flagged": {"$sum": {"$cond": [{"$eq": ["$fraud.fraudFlag", True]}, 1, 0]}},
                    "cleared": {"$sum": {"$cond": [{"$eq": ["$fraud.fraudFlag", False]}, 1, 0]}},
                }}],
                "rows": [
                    {"$match": status_match},
                    {"$sort": {sort_field: sort_dir}},
                    {"$skip": (page - 1) * limit},
                    {"$limit": limit},
                    {"$lookup": {
                        "from": get_settings().CUSTOMERS_COLLECTION,
                        "localField": "customerId",
                        "foreignField": "customerId",
                        "as": "customer",
                    }},
                    {"$unwind": "$customer"},
                    {"$project": LIST_PROJECTION},
                ],
                "count": [{"$match": status_match}, {"$count": "n"}],
            }},
        ]

        facet = next(iter(self.collection.aggregate(pipeline)), {})
        stats = (facet.get("stats") or [{}])[0]
        stats.pop("_id", None)
        return {
            "stats": {
                "total": stats.get("total", 0),
                "unprocessed": stats.get("unprocessed", 0),
                "pendingReview": stats.get("pendingReview", 0),
                "flagged": stats.get("flagged", 0),
                "cleared": stats.get("cleared", 0),
            },
            "rows": facet.get("rows", []),
            "count": (facet.get("count") or [{}])[0].get("n", 0),
        }

    def get_by_id(self, claim_id: str) -> dict[str, Any] | None:
        """A claim merged with its policy and customer, or None."""
        settings = get_settings()
        pipeline = [
            {"$match": {"claimId": claim_id}},
            {"$lookup": {
                "from": settings.POLICIES_COLLECTION,
                "localField": "policyId",
                "foreignField": "policyId",
                "as": "policy",
            }},
            {"$unwind": {"path": "$policy", "preserveNullAndEmptyArrays": True}},
            {"$lookup": {
                "from": settings.CUSTOMERS_COLLECTION,
                "localField": "customerId",
                "foreignField": "customerId",
                "as": "customer",
            }},
            {"$unwind": {"path": "$customer", "preserveNullAndEmptyArrays": True}},
        ]
        return next(iter(self.collection.aggregate(pipeline)), None)

    def get_raw(self, claim_id: str) -> dict[str, Any] | None:
        """The claim document alone, no joins — for business-rule checks."""
        return self.collection.find_one({"claimId": claim_id})

    def find_linked(self, claim: dict[str, Any], limit: int = 10) -> list[dict[str, Any]]:
        """Other claims sharing a customer, a repair shop, or a fraud pattern."""
        matched_ids = [
            p["patternId"]
            for p in (claim.get("fraud") or {}).get("matchedPatterns", [])
            if p.get("patternId")
        ]

        or_clauses: list[dict] = [{"customerId": claim["customerId"]}]
        if claim.get("repairShop"):
            or_clauses.append({"repairShop": claim["repairShop"]})
        if matched_ids:
            or_clauses.append({"fraud.matchedPatterns.patternId": {"$in": matched_ids}})

        pipeline = [
            {"$match": {"$and": [
                {"claimId": {"$ne": claim["claimId"]}},
                {"$or": or_clauses},
            ]}},
            {"$limit": limit},
            {"$lookup": {
                "from": get_settings().CUSTOMERS_COLLECTION,
                "localField": "customerId",
                "foreignField": "customerId",
                "as": "customer",
            }},
            {"$unwind": {"path": "$customer", "preserveNullAndEmptyArrays": True}},
            {"$project": {
                "_id": 0,
                "claimId": 1,
                "claimDate": 1,
                "customerId": 1,
                "repairShop": 1,
                "customerName": {"$concat": ["$customer.firstName", " ", "$customer.lastName"]},
                "computedScore": "$fraud.computedScore",
                "fraudFlag": "$fraud.fraudFlag",
                "matchedPatterns": "$fraud.matchedPatterns",
            }},
        ]
        return list(self.collection.aggregate(pipeline))

    def find_for_batch(self, claim_ids: list[str]) -> dict[str, dict[str, Any]]:
        """Fetch only the fields batch validation needs, keyed by claimId."""
        cursor = self.collection.find(
            {"claimId": {"$in": claim_ids}},
            {"_id": 0, "claimId": 1, "complexity": 1, "fraud.processed": 1},
        )
        return {doc["claimId"]: doc for doc in cursor}

    # --------------------------------------------------------------- writes

    def update_fields(self, claim_id: str, fields: dict[str, Any]) -> int:
        """$set the given fields plus updatedAt. Returns matched count."""
        result = self.collection.update_one(
            {"claimId": claim_id},
            {"$set": {**fields, "updatedAt": datetime.now(timezone.utc)}},
        )
        return result.matched_count
