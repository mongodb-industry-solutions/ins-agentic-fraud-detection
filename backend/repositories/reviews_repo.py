"""Data access for claim_fraud_reviews — one document per agent run.

Phase 4's `write_audit_record` tool writes through this same repository.
"""

from typing import Any

from pymongo import DESCENDING

from core.config import get_settings
from db.mdb import MongoDBConnector


class ReviewsRepository:
    """Audit-trail reads for a claim's fraud review history."""

    def __init__(self, db: MongoDBConnector):
        self.db = db
        self.collection_name = get_settings().REVIEWS_COLLECTION
        self.collection = db.get_collection(self.collection_name)

    def list_for_claim(self, claim_id: str) -> list[dict[str, Any]]:
        """Every review run for a claim, newest first."""
        return list(
            self.collection.find({"claimId": claim_id}).sort("createdAt", DESCENDING)
        )

    def recent_activity(self, limit: int = 20) -> list[dict[str, Any]]:
        """A merged activity feed, with no activity-log collection behind it.

        A review document is one full assessment cycle: the agent produced a
        score at `createdAt`, and a human may later have decided at
        `reviewedAt`. So a single document can emit *two* events — the
        $concatArrays below builds a per-document event array (one entry, or
        two once a decision exists) which is then unwound. Claim openings are
        appended from the claims collection via $unionWith.
        """
        review_events = {
            "$concatArrays": [
                [{
                    "type": "SCORE_PRODUCED",
                    "timestamp": "$createdAt",
                    "claimId": "$claimId",
                    "computedScore": "$computedScore",
                }],
                {"$cond": [
                    {"$ne": [{"$ifNull": ["$reviewedAt", None]}, None]},
                    [{
                        "type": {"$cond": [
                            {"$eq": ["$decision", "CONFIRMED_FRAUD"]},
                            "DECISION_CONFIRMED",
                            "DECISION_DISMISSED",
                        ]},
                        "timestamp": "$reviewedAt",
                        "claimId": "$claimId",
                        "reviewedBy": "$reviewedBy",
                    }],
                    [],
                ]},
            ]
        }

        pipeline = [
            {"$project": {"events": review_events}},
            {"$unwind": "$events"},
            {"$replaceRoot": {"newRoot": "$events"}},
            {"$unionWith": {
                "coll": get_settings().CLAIMS_COLLECTION,
                "pipeline": [
                    {"$project": {
                        "_id": 0,
                        "type": "CLAIM_OPENED",
                        "timestamp": "$claimDate",
                        "claimId": 1,
                    }},
                ],
            }},
            {"$sort": {"timestamp": DESCENDING}},
            {"$limit": limit},
        ]
        return list(self.collection.aggregate(pipeline))
