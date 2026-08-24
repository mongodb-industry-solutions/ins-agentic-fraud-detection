"""Data access for the fraud-review audit trail — one document per agent run.

The collection is named by settings.REVIEWS_COLLECTION (`decision_traces`), which
is what the agent side writes.

Phase 4's `write_audit_record` tool writes through this same repository.
"""

from datetime import datetime
from typing import Any

from pymongo import DESCENDING

from core.config import get_settings
from db.mdb import MongoDBConnector


# The agent's own actions. A human confirm/dismiss and a claim opening are real
# events but not agentic ones, so they are excluded from an agent-scoped feed.
AGENT_EVENT_TYPES = ["SCORE_PRODUCED"]


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

    def recent_activity(
        self,
        limit: int = 20,
        since: datetime | None = None,
        agent_only: bool = False,
    ) -> list[dict[str, Any]]:
        """A merged activity feed, with no activity-log collection behind it.

        `since` drops anything older than that instant. `agent_only` narrows the
        feed to the agent's own actions: score production. Human decisions and
        claim openings are real events but not agentic ones, so a caller asking
        for agent activity must not be handed them.

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

        pipeline: list[dict[str, Any]] = [
            {"$project": {"events": review_events}},
            {"$unwind": "$events"},
            {"$replaceRoot": {"newRoot": "$events"}},
        ]

        # Claim openings come from the claims collection, so an agent-only feed
        # skips the union entirely rather than filtering them back out.
        if not agent_only:
            pipeline.append({"$unionWith": {
                "coll": get_settings().CLAIMS_COLLECTION,
                "pipeline": [
                    {"$project": {
                        "_id": 0,
                        "type": "CLAIM_OPENED",
                        "timestamp": "$claimDate",
                        "claimId": 1,
                    }},
                ],
            }})
        else:
            pipeline.append({"$match": {"type": {"$in": AGENT_EVENT_TYPES}}})

        # Applied after the union so it covers every source, and before the sort
        # and limit so the limit counts events actually inside the window.
        if since is not None:
            pipeline.append({"$match": {"timestamp": {"$gte": since}}})

        pipeline += [{"$sort": {"timestamp": DESCENDING}}, {"$limit": limit}]
        return list(self.collection.aggregate(pipeline))
