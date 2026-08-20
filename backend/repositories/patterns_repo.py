"""Data access for the fraud_patterns collection."""

from datetime import datetime, timezone
from typing import Any

from core.config import get_settings
from db.mdb import MongoDBConnector


class PatternsRepository:
    """Reads and reliability-stat writes for fraud patterns."""

    def __init__(self, db: MongoDBConnector):
        self.db = db
        self.collection_name = get_settings().PATTERNS_COLLECTION
        self.collection = db.get_collection(self.collection_name)

    def get_by_id(self, pattern_id: str) -> dict[str, Any] | None:
        return self.collection.find_one({"patternId": pattern_id})

    def get_many(self, pattern_ids: list[str]) -> list[dict[str, Any]]:
        return list(self.collection.find({"patternId": {"$in": pattern_ids}}))

    def increment_confirmed_count(self, pattern_id: str) -> dict[str, Any] | None:
        """+1 to stats.confirmedCount, returning the updated document."""
        return self.collection.find_one_and_update(
            {"patternId": pattern_id},
            {
                "$inc": {"stats.confirmedCount": 1},
                "$set": {"updatedAt": datetime.now(timezone.utc)},
            },
            return_document=True,
        )

    def set_confirmed_rate(self, pattern_id: str, rate: float) -> int:
        """Write the recomputed confirmedFraudRate."""
        result = self.collection.update_one(
            {"patternId": pattern_id},
            {"$set": {
                "stats.confirmedFraudRate": rate,
                "updatedAt": datetime.now(timezone.utc),
            }},
        )
        return result.matched_count
