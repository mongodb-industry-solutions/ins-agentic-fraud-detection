"""voyage_embeddings.py — full-featured embedder class (see VOYAGE_EMBEDDINGS_GUIDE.md §3.3).

Embeds text with Voyage AI and can bulk-embed an entire MongoDB collection — used to
backfill ``fraud_patterns`` embeddings (Step 2). Kept faithful to the guide; adapted to
this repo's env var names (``MONGODB_URI`` / ``MONGODB_DATABASE``).
"""

import logging
import os
from typing import Optional

from dotenv import load_dotenv
from pymongo import MongoClient
import voyageai

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class VoyageEmbeddings:
    """Generate text embeddings with Voyage AI, with MongoDB integration."""

    log = logging.getLogger("VoyageEmbeddings")

    def __init__(self,
                 api_key: Optional[str] = None,
                 model_id: Optional[str] = None,
                 mongodb_uri: Optional[str] = None,
                 database_name: Optional[str] = None) -> None:
        # Voyage client
        self.api_key = api_key or os.getenv("VOYAGE_API_KEY")
        self.model_id = model_id or os.getenv("VOYAGE_MODEL", "voyage-3.5")
        self.voyage_client = voyageai.Client(api_key=self.api_key)

        # MongoDB. The originating repo used MONGODB_DATABASE; this one names the
        # same value DATABASE_NAME (see core/config.Settings), so both are
        # accepted rather than failing to connect for a naming reason.
        self.mongodb_uri = mongodb_uri or os.getenv("MONGODB_URI")
        self.database_name = (
            database_name or os.getenv("MONGODB_DATABASE") or os.getenv("DATABASE_NAME")
        )
        self.client = None
        self.db = None
        if self.mongodb_uri and self.database_name:
            try:
                self.client = MongoClient(self.mongodb_uri)
                self.db = self.client[self.database_name]
                logger.info(f"Connected to MongoDB database: {self.database_name}")
            except Exception as e:
                logger.error(f"Failed to connect to MongoDB: {e}")

    def generate_text_embeddings(self, text: str) -> list:
        result = self.voyage_client.embed([text], model=self.model_id,
                                          input_type="document")
        return result.embeddings[0]

    def predict(self, text: str):
        try:
            return self.generate_text_embeddings(text)
        except Exception as err:
            self.log.error("Error generating embedding: %s", str(err))
            return None

    def predict_many(self, texts: list):
        """Embed a list of texts in one Voyage call. Order matches the input."""
        try:
            result = self.voyage_client.embed(texts, model=self.model_id,
                                              input_type="document")
            return result.embeddings
        except Exception as err:  # noqa: BLE001
            self.log.error("Error generating batch embeddings: %s", str(err))
            return None

    def embed_mongodb_collection(self,
                                 collection_name: str,
                                 field_to_embed: str,
                                 embedding_field: str = 'embedding',
                                 batch_size: int = 100,
                                 query: Optional[dict] = None):
        """Embed `field_to_embed` for every doc lacking a usable `embedding_field`.

        A pattern seeded with ``embedding: []`` counts as lacking an embedding, so the
        query treats missing OR empty-array embeddings as needing a backfill.
        """
        if self.client is None or self.db is None:
            raise ValueError("MongoDB connection not initialized.")

        collection = self.db[collection_name]

        # Search for the embedding field being missing, empty, or None, and the field to embed being present and non-empty.
        base_query = {
            '$or': [
                {embedding_field: {'$exists': False}},
                {embedding_field: {'$eq': []}},
                {embedding_field: None},
            ],
            field_to_embed: {'$exists': True, '$ne': ''},
        }
        if query:
            base_query.update(query)

        total = collection.count_documents(base_query)
        self.log.info(f"Total documents to process: {total}")

        # Paginated by _id, NOT by .skip(start).limit(n).
        #
        # The original skipped over a query it was simultaneously shrinking: each
        # write removes that document from `base_query`'s result set, so the next
        # skip steps past documents that still need work. With 250 docs and
        # batch_size=100 it would report success having embedded ~150 and left
        # ~100 silently unembedded. Advancing by the last _id seen is stable
        # however many documents leave the set mid-run.
        processed = 0
        after_id = None
        while True:
            page_query = dict(base_query)
            if after_id is not None:
                page_query['_id'] = {'$gt': after_id}

            docs = list(
                collection.find(page_query, {'_id': 1, field_to_embed: 1})
                .sort('_id', 1)
                .limit(batch_size)
            )
            if not docs:
                break
            after_id = docs[-1]['_id']

            # One Voyage call per batch rather than one per document: embed()
            # accepts a list, so this is an order of magnitude fewer round trips
            # and much kinder to the rate limit.
            usable = [(d['_id'], str(d[field_to_embed])) for d in docs if d.get(field_to_embed)]
            if not usable:
                continue

            embeddings = self.predict_many([text for _, text in usable])
            if embeddings is None:
                self.log.error("Batch embedding failed; stopping after %d document(s).", processed)
                break

            for (mongo_id, _), embedding in zip(usable, embeddings):
                if not embedding:
                    continue
                collection.update_one(
                    {'_id': mongo_id},
                    {'$set': {embedding_field: embedding}}
                )
                processed += 1

        self.log.info(f"Processed {processed} documents.")
        return processed

    def close_connection(self):
        if self.client:
            self.client.close()
