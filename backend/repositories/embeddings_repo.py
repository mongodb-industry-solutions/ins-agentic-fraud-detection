"""Data access for the `embedding` field on any embeddable collection.

Goes through the process-wide MongoDBConnector like every other repository here.
`VoyageEmbeddings.embed_mongodb_collection` does its own Mongo work, but it
opens its own MongoClient and reads MONGODB_DATABASE — a name this app does not
use (it uses DATABASE_NAME) — so its Mongo half is deliberately not in the
request path. Its *predicate* for "needs embedding" is reproduced below, which
is the part that matters.
"""

from datetime import datetime, timezone
from typing import Any

from pymongo import ASCENDING

from db.mdb import MongoDBConnector

EMBEDDING_FIELD = "embedding"


def pending_filter(source_field: str, scope: dict[str, Any] | None = None) -> dict[str, Any]:
    """Documents that have text to embed and no usable embedding yet.

    Three states all count as "not embedded", because the seed data uses all
    three: the field missing entirely, an empty array (how a placeholder is
    seeded), and an explicit null.

    The source-field test rejects null as well as empty string — the original
    used `$ne: ""`, which lets a `description: null` document through and then
    fails when Voyage is handed a None.
    """
    query: dict[str, Any] = {
        "$or": [
            {EMBEDDING_FIELD: {"$exists": False}},
            {EMBEDDING_FIELD: []},
            {EMBEDDING_FIELD: None},
        ],
        source_field: {"$exists": True, "$nin": ["", None]},
    }
    if scope:
        query.update(scope)
    return query


class EmbeddingsRepository:
    """Reads and embedding writes across the embeddable collections."""

    def __init__(self, db: MongoDBConnector):
        self.db = db

    def find_document(
        self, collection: str, id_field: str, document_id: str, source_field: str
    ) -> dict[str, Any] | None:
        """One document, projected to just what embedding needs."""
        return self.db.get_collection(collection).find_one(
            {id_field: document_id},
            {"_id": 1, id_field: 1, source_field: 1, EMBEDDING_FIELD: 1},
        )

    def set_embedding(self, collection: str, mongo_id: Any, vector: list[float]) -> int:
        """Write one vector. Keyed by `_id` so it cannot hit a second document."""
        result = self.db.get_collection(collection).update_one(
            {"_id": mongo_id},
            {"$set": {
                EMBEDDING_FIELD: vector,
                "embeddedAt": datetime.now(timezone.utc),
                "updatedAt": datetime.now(timezone.utc),
            }},
        )
        return result.modified_count

    def count_pending(
        self, collection: str, source_field: str, scope: dict[str, Any] | None
    ) -> int:
        return self.db.get_collection(collection).count_documents(
            pending_filter(source_field, scope)
        )

    def count_in_scope(self, collection: str, scope: dict[str, Any] | None) -> int:
        return self.db.get_collection(collection).count_documents(scope or {})

    def next_pending_batch(
        self,
        collection: str,
        source_field: str,
        scope: dict[str, Any] | None,
        batch_size: int,
        after_id: Any = None,
    ) -> list[dict[str, Any]]:
        """The next page of unembedded documents, paginated by `_id`.

        NOT `.skip(n).limit(n)`. The original backfill skipped over a query that
        it was simultaneously shrinking — each write removes a document from the
        result set, so the next skip steps past documents that still need work
        and the run reports success having quietly missed roughly a batch per
        page. Advancing by the last `_id` seen is stable no matter how many
        documents leave the set mid-run.
        """
        query = pending_filter(source_field, scope)
        if after_id is not None:
            query["_id"] = {"$gt": after_id}

        cursor = (
            self.db.get_collection(collection)
            .find(query, {"_id": 1, source_field: 1})
            .sort("_id", ASCENDING)
            .limit(batch_size)
        )
        return list(cursor)

    def clear_embeddings(self, collection: str, scope: dict[str, Any] | None) -> int:
        """Drop embeddings in scope so a --force style re-embed picks them up."""
        result = self.db.get_collection(collection).update_many(
            scope or {}, {"$unset": {EMBEDDING_FIELD: ""}}
        )
        return result.modified_count

    def sample_dimensions(self, collection: str, scope: dict[str, Any] | None) -> int | None:
        """Length of one stored vector, for the dimension check after a run."""
        query = dict(scope or {})
        query[f"{EMBEDDING_FIELD}.0"] = {"$exists": True}
        document = self.db.get_collection(collection).find_one(query, {EMBEDDING_FIELD: 1})
        if not document:
            return None
        return len(document.get(EMBEDDING_FIELD) or [])

    def has_search_index(self, collection: str, index_name: str) -> bool | None:
        """Whether the Atlas vector index exists.

        None means "could not tell" — listing search indexes is unsupported on
        some tiers and deployments. Reported rather than assumed, because a
        missing index makes vector search return an empty list instead of an
        error, which is the failure mode nobody notices.
        """
        try:
            indexes = self.db.get_collection(collection).list_search_indexes()
            return any(index.get("name") == index_name for index in indexes)
        except Exception:  # noqa: BLE001 - unsupported deployment, not a failure
            return None
