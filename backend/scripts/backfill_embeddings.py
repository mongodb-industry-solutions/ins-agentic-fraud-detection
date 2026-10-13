"""Backfill embeddings for a MongoDB collection using Voyage.

Populates an `embedding` field from a text field via `VoyageEmbeddings.embed_mongodb_collection()`
(guide §3.3), which embeds as input_type="document" — correct for the searchable corpus side.

Presets (override any with flags):
  --collection fraud_patterns  -> field=embeddingText, scope={patternType: HISTORICAL_SIMILARITY}
  --collection claims          -> field=description,    scope={} (every claim with a description)

Maintenance task, not part of the request path. Idempotent: only embeds docs whose embedding is
missing / [] / None. Re-run when new docs are added or the Voyage model changes.

Usage:
    uv run python scripts/backfill_embeddings.py                          # fraud_patterns (default)
    uv run python scripts/backfill_embeddings.py --collection claims      # claim corpus
    uv run python scripts/backfill_embeddings.py --collection claims --force
    uv run python scripts/backfill_embeddings.py --collection X --field Y --scope-json '{...}'

Requires MONGODB_URI, MONGODB_DATABASE and VOYAGE_API_KEY in the environment / .env.
"""

import argparse
import json
import logging
import os
import sys

from dotenv import load_dotenv

# Repointed from the original repo's package path to this repo's flat `voyage/` folder.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from voyage import VoyageEmbeddings  # noqa: E402

load_dotenv()
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)-8s | %(message)s")
logger = logging.getLogger("backfill_embeddings")

# Keep in sync with store.VECTOR_DIMENSIONS / the Atlas indexes (voyage-3.5 = 1024).
EXPECTED_DIMS = int(os.environ.get("FRAUD_PATTERN_VECTOR_DIMS", "1024"))

# Per-collection defaults for the text field and the scope filter.
PRESETS = {
    "fraud_patterns": {"field": "embeddingText", "scope": {"patternType": "HISTORICAL_SIMILARITY"}},
    "claims": {"field": "description", "scope": {}},
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill embeddings with Voyage.")
    parser.add_argument("--collection", default="fraud_patterns",
                        help="Collection to embed (default: fraud_patterns).")
    parser.add_argument("--field", default=None,
                        help="Text field to embed (default: per-collection preset).")
    parser.add_argument("--scope-json", default=None,
                        help="JSON query to scope which docs to embed (default: preset).")
    parser.add_argument("--force", action="store_true",
                        help="Clear existing embeddings in scope first, forcing a re-embed.")
    args = parser.parse_args()

    if not os.environ.get("VOYAGE_API_KEY"):
        logger.error("VOYAGE_API_KEY is not set — cannot generate embeddings.")
        return 1
    # This repo names the database DATABASE_NAME; the originating repo used
    # MONGODB_DATABASE. Either is accepted.
    if not os.environ.get("MONGODB_URI") or not (
        os.environ.get("MONGODB_DATABASE") or os.environ.get("DATABASE_NAME")
    ):
        logger.error("MONGODB_URI and DATABASE_NAME (or MONGODB_DATABASE) must be set.")
        return 1

    preset = PRESETS.get(args.collection, {"field": None, "scope": {}})
    field = args.field or preset["field"]
    if not field:
        logger.error("No --field given and no preset for collection %r.", args.collection)
        return 1
    scope = json.loads(args.scope_json) if args.scope_json else dict(preset["scope"])

    emb = VoyageEmbeddings()
    if emb.db is None:
        logger.error("Could not connect to MongoDB — aborting.")
        return 1

    logger.info(
        "Backfilling %s.embedding from '%s' (model=%s, scope=%s, force=%s)",
        args.collection, field, emb.model_id, scope or "{}", args.force,
    )

    try:
        if args.force:
            reset = emb.db[args.collection].update_many(scope, {"$set": {"embedding": []}})
            logger.info("--force: cleared embeddings on %d doc(s).", reset.modified_count)

        processed = emb.embed_mongodb_collection(
            collection_name=args.collection,
            field_to_embed=field,
            embedding_field="embedding",
            query=scope or None,
        )

        # Verify dimensions on a freshly embedded doc so a model/index mismatch surfaces now.
        sample = emb.db[args.collection].find_one(
            {**scope, "embedding.0": {"$exists": True}}, {"embedding": 1},
        )
        if sample:
            dims = len(sample.get("embedding", []))
            if dims != EXPECTED_DIMS:
                logger.warning(
                    "Embedding has %d dims but the index expects %d — the Atlas index and "
                    "VOYAGE_MODEL must agree, or vector search will error.", dims, EXPECTED_DIMS,
                )
            else:
                logger.info("Verified embedding dimensions = %d (matches index).", dims)

        logger.info("Done. Embedded %d doc(s) in %s.", processed, args.collection)
        return 0
    except Exception as exc:  # noqa: BLE001
        logger.error("Backfill failed: %s", exc)
        return 1
    finally:
        emb.close_connection()


if __name__ == "__main__":
    sys.exit(main())
