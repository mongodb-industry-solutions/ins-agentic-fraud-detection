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

        # MongoDB — this repo uses MONGODB_URI / MONGODB_DATABASE
        self.mongodb_uri = mongodb_uri or os.getenv("MONGODB_URI")
        self.database_name = database_name or os.getenv("MONGODB_DATABASE")
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

        processed = 0
        for start in range(0, total, batch_size):
            # Processing in batches to avoid loading too many documents into memory at once
            docs = list(collection.find(base_query).skip(start).limit(batch_size))
            for doc in docs:
                # Ensure the field to embed is present and non-empty before generating the embedding
                if not doc.get(field_to_embed):
                    continue

                # Generate the embedding for the specified field
                embedding = self.predict(str(doc[field_to_embed]))

                # Update the document with the new embedding if it was successfully generated
                if embedding:
                    collection.update_one(
                        {'_id': doc['_id']},
                        {'$set': {embedding_field: embedding}}
                    )
                    processed += 1

        self.log.info(f"Processed {processed} documents.")
        return processed

    def close_connection(self):
        if self.client:
            self.client.close()
