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
