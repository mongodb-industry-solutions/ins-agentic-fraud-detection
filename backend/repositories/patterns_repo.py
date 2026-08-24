"""Data access for the fraud_patterns collection."""

import re
from datetime import datetime, timezone
from typing import Any

from pymongo import DESCENDING

from core.config import get_settings
from db.mdb import MongoDBConnector
from repositories.claims_repo import parse_sort

DEFAULT_PATTERN_SORT = "-stats.timesTriggered"


class PatternsRepository:
    """Reads and reliability-stat writes for fraud patterns."""

    def __init__(self, db: MongoDBConnector):
        self.db = db
        self.collection_name = get_settings().PATTERNS_COLLECTION
        self.collection = db.get_collection(self.collection_name)

    def list_all(
        self,
        pattern_type: str = "ALL",
        active: bool | None = None,
        sort: str = DEFAULT_PATTERN_SORT,
    ) -> list[dict[str, Any]]:
        """The whole pattern catalogue, filtered and sorted.

        No joins and no pagination: `stats.confirmedFraudRate` is already
        maintained by the decision endpoint, and the catalogue is a fixed,
        small set of hand-authored patterns.
        """
        query: dict[str, Any] = {}
        if pattern_type != "ALL":
            query["patternType"] = pattern_type
        if active is not None:
            query["active"] = active

        sort_field, sort_dir = parse_sort(sort)
        return list(self.collection.find(query).sort(sort_field, sort_dir))

    def get_by_id(self, pattern_id: str) -> dict[str, Any] | None:
        return self.collection.find_one({"patternId": pattern_id})

    def get_many(self, pattern_ids: list[str]) -> list[dict[str, Any]]:
        return list(self.collection.find({"patternId": {"$in": pattern_ids}}))

    def next_pattern_id(self) -> str:
        """The next free FP-nnn.

        Ids are zero-padded to three digits, so the highest is also the last
        lexicographically and one indexed read finds it. This assumes the
        catalogue stays under FP-999; past that the padding, and this sort,
        would need widening.
        """
        latest = self.collection.find_one(
            {"patternId": {"$regex": r"^FP-\d{3}$"}},
            sort=[("patternId", DESCENDING)],
            projection={"patternId": 1},
        )
        highest = int(re.sub(r"\D", "", latest["patternId"])) if latest else 0
        return f"FP-{highest + 1:03d}"

    def insert_pattern(self, document: dict[str, Any]) -> dict[str, Any]:
        """Insert and return the stored document, `_id` stripped."""
        self.collection.insert_one(document)
        return {key: value for key, value in document.items() if key != "_id"}

    def update_fields(self, pattern_id: str, fields: dict[str, Any]) -> dict[str, Any] | None:
        """$set the given fields plus updatedAt, returning the updated document.

        Returns the document rather than a matched count: the caller sends the
        new state straight back to the client, so a second read would only
        create a window in which the two could disagree.
        """
        return self.collection.find_one_and_update(
            {"patternId": pattern_id},
            {"$set": {**fields, "updatedAt": datetime.now(timezone.utc)}},
            return_document=True,
        )

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

    def set_why_effective(self, pattern_id: str, text: str, generated_at: datetime) -> int:
        """Store a generated reliability blurb and when it was generated.

        `updatedAt` is deliberately NOT touched: regenerating this text is not an
        edit to the pattern, and bumping the timestamp would make a periodic
        regeneration job look like someone changed every rule in the catalogue.
        """
        result = self.collection.update_one(
            {"patternId": pattern_id},
            {"$set": {"whyEffective": text, "whyEffectiveGeneratedAt": generated_at}},
        )
        return result.matched_count

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
