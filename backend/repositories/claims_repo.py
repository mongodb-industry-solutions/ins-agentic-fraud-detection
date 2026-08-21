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
# Mutually exclusive by construction, in the same precedence the stats facet and
# the frontend's toStatusKey use: a fraud flag wins over an unprocessed flag.
# Without the extra clauses these overlapped, so filtering by "not yet analyzed"
# returned claims the stat card counted as flagged.
STATUS_MATCHES: dict[str, dict] = {
    "UNPROCESSED": {"fraud.fraudFlag": {"$ne": True}, "fraud.processed": {"$ne": True}},
    "PENDING_REVIEW": {"fraud.processed": True, "fraud.fraudFlag": None},
    "FLAGGED": {"fraud.fraudFlag": True},
    "CLEARED": {"fraud.processed": True, "fraud.fraudFlag": False},
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


# The pending queue needs the two fields the list projection deliberately omits
# to stay lean: when it was scored, and which patterns matched.
PENDING_PROJECTION = {
    "_id": 0,
    "claimId": 1,
    "coverageType": 1,
    "customerName": {"$concat": ["$customer.firstName", " ", "$customer.lastName"]},
    "computedScore": "$fraud.computedScore",
    "scoredAt": "$fraud.scoredAt",
    "matchedPatterns": "$fraud.matchedPatterns",
}

# Scored, but with no human decision yet. Mirrors the `pendingReview` arm of the
# stats facet in `list_with_stats`, so the queue length and the stat card cannot
# disagree.
PENDING_MATCH = {"fraud.processed": True, "fraud.fraudFlag": None}


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
                # Each claim is classified into exactly one bucket, then
                # counted — rather than four independent $sum conditions, which
                # double-counted any claim whose flags disagreed (a claim with
                # processed=false and fraudFlag=true landed in both
                # `unprocessed` and `flagged`, so the buckets summed to more
                # than `total` and the dashboard donut overflowed its circle).
                # The branch order mirrors the frontend's per-row precedence in
                # claimsPresenter.toStatusKey, so a status card can never
                # disagree with the rows in the table beneath it.
                "stats": [
                    {"$project": {"bucket": {"$switch": {
                        "branches": [
                            {"case": {"$eq": ["$fraud.fraudFlag", True]}, "then": "flagged"},
                            {"case": {"$ne": ["$fraud.processed", True]}, "then": "unprocessed"},
                            {"case": {"$eq": ["$fraud.fraudFlag", False]}, "then": "cleared"},
                        ],
                        "default": "pendingReview",
                    }}}},
                    {"$group": {"_id": "$bucket", "n": {"$sum": 1}}},
                ],
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
        # One row per non-empty bucket; absent buckets are legitimately zero.
        counts = {row["_id"]: row["n"] for row in (facet.get("stats") or [])}
        return {
            "stats": {
                # Summed from the buckets rather than counted separately, so
                # `total` and the four parts cannot contradict each other.
                "total": sum(counts.values()),
                "unprocessed": counts.get("unprocessed", 0),
                "pendingReview": counts.get("pendingReview", 0),
                "flagged": counts.get("flagged", 0),
                "cleared": counts.get("cleared", 0),
            },
            "rows": facet.get("rows", []),
            "count": (facet.get("count") or [{}])[0].get("n", 0),
        }

    def find_pending_review(self, limit: int = 10) -> tuple[list[dict[str, Any]], int]:
        """Highest-scoring unreviewed claims first, plus the full queue count.

        Sorted by score rather than date: the queue exists to be worked through
        worst-first, and its length is shown separately from the page returned.
        """
        pipeline = [
            {"$match": PENDING_MATCH},
            {"$sort": {"fraud.computedScore": -1, "claimDate": -1}},
            {"$limit": limit},
            {"$lookup": {
                "from": get_settings().CUSTOMERS_COLLECTION,
                "localField": "customerId",
                "foreignField": "customerId",
                "as": "customer",
            }},
            # preserveNull so a claim with a missing customer still appears —
            # dropping it would understate the queue.
            {"$unwind": {"path": "$customer", "preserveNullAndEmptyArrays": True}},
            {"$project": PENDING_PROJECTION},
        ]
        rows = list(self.collection.aggregate(pipeline))
        total = self.collection.count_documents(PENDING_MATCH)
        return rows, total

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

    def find_by_pattern(self, pattern_id: str, limit: int = 200) -> list[dict[str, Any]]:
        """Claims whose fraud assessment matched a given pattern, worst first."""
        pipeline = [
            {"$match": {"fraud.matchedPatterns.patternId": pattern_id}},
            {"$sort": {"fraud.computedScore": DESCENDING}},
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
                "customerName": {"$concat": ["$customer.firstName", " ", "$customer.lastName"]},
                "computedScore": "$fraud.computedScore",
                "fraudFlag": "$fraud.fraudFlag",
            }},
        ]
        return list(self.collection.aggregate(pipeline))

    # ------------------------------------------------------------ portfolio

    def trend_by_bucket(
        self,
        date_from: datetime,
        date_to: datetime,
        unit: str = "week",
    ) -> list[dict[str, Any]]:
        """Claim outcomes per time bucket, oldest bucket first."""
        pipeline = [
            {"$match": {"claimDate": {"$gte": date_from, "$lte": date_to}}},
            {"$group": {
                "_id": {"$dateTrunc": {"date": "$claimDate", "unit": unit}},
                "flagged": {"$sum": {"$cond": [{"$eq": ["$fraud.fraudFlag", True]}, 1, 0]}},
                "cleared": {"$sum": {"$cond": [{"$eq": ["$fraud.fraudFlag", False]}, 1, 0]}},
                "pending": {"$sum": {"$cond": [
                    {"$and": [
                        {"$eq": ["$fraud.processed", True]},
                        {"$eq": ["$fraud.fraudFlag", None]},
                    ]}, 1, 0]}},
                "unprocessed": {"$sum": {"$cond": [{"$eq": ["$fraud.processed", False]}, 1, 0]}},
            }},
            {"$sort": {"_id": ASCENDING}},
            {"$project": {
                "_id": 0,
                "bucket": "$_id",
                "flagged": 1,
                "cleared": 1,
                "pending": 1,
                "unprocessed": 1,
            }},
        ]
        return list(self.collection.aggregate(pipeline))

    def score_distribution(self, boundaries: list[int]) -> list[dict[str, Any]]:
        """Histogram of computedScore over scored claims only.

        Boundaries span 0..12 because computedScore is capped at 12 by the
        scoring step, even though the raw pre-cap score can run higher.
        """
        pipeline = [
            {"$match": {"fraud.processed": True, "fraud.computedScore": {"$ne": None}}},
            {"$bucket": {
                "groupBy": "$fraud.computedScore",
                "boundaries": boundaries,
                "default": "other",
                "output": {"count": {"$sum": 1}},
            }},
        ]
        return list(self.collection.aggregate(pipeline))

    def overall_decision_counts(self) -> dict[str, int]:
        """Flagged/cleared totals across the *whole* portfolio, undated."""
        pipeline = [
            {"$group": {
                "_id": None,
                "flagged": {"$sum": {"$cond": [{"$eq": ["$fraud.fraudFlag", True]}, 1, 0]}},
                "cleared": {"$sum": {"$cond": [{"$eq": ["$fraud.fraudFlag", False]}, 1, 0]}},
            }},
        ]
        row = next(iter(self.collection.aggregate(pipeline)), {})
        return {"flagged": row.get("flagged", 0), "cleared": row.get("cleared", 0)}

    # ---------------------------------------------------------------- graph

    def find_graph_candidates(self, scope: str = "ALL", limit: int = 60) -> list[dict[str, Any]]:
        """The bounded candidate set the relationship graph is built from.

        Only the fields the pairing logic needs are returned; the pairing
        itself is done in the service, in Python.
        """
        scope_matches = {
            "ALL": {},
            "FLAGGED": {"fraud.fraudFlag": True},
            "PENDING": {"fraud.processed": True, "fraud.fraudFlag": None},
        }
        pipeline = [
            {"$match": scope_matches[scope]},
            {"$sort": {"fraud.processed": DESCENDING, "updatedAt": DESCENDING}},
            {"$limit": limit},
            {"$project": {
                "_id": 0,
                "claimId": 1,
                "customerId": 1,
                "repairShop": 1,
                "computedScore": "$fraud.computedScore",
                "fraudFlag": "$fraud.fraudFlag",
                "matchedPatterns": {"$ifNull": ["$fraud.matchedPatterns", []]},
            }},
        ]
        return list(self.collection.aggregate(pipeline))

    # --------------------------------------------------------------- writes

    def update_fields(self, claim_id: str, fields: dict[str, Any]) -> int:
        """$set the given fields plus updatedAt. Returns matched count."""
        result = self.collection.update_one(
            {"claimId": claim_id},
            {"$set": {**fields, "updatedAt": datetime.now(timezone.utc)}},
        )
        return result.matched_count
