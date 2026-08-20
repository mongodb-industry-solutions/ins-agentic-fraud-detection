"""Seed / reset the demo database from the JSON fixtures in backend/data.

Never drops a collection: `drop()` would also destroy the Atlas Vector Search
index on fraud_patterns.embedding, which pymongo's standard index API cannot
recreate (see _vector_search_idx_creator.py). Emptying is always done with
`delete_many({})`, which leaves every index in place.

Usage:
    uv run python scripts/seed_db.py --reset [--yes]
    uv run python scripts/seed_db.py --wipe-only [--yes]
"""

import argparse
import logging
import os
import sys

from bson import json_util
from dotenv import load_dotenv

# Allow running as `python scripts/seed_db.py` from the backend/ directory.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.mdb import MongoDBConnector  # noqa: E402

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

load_dotenv()

DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"
)

# Fixed dependency order: a document is only loaded after whatever it
# references. Mongo does not enforce this, but validation or logging added
# later may assume it.
COLLECTIONS = [
    ("customers", "customers.json"),
    ("policies", "policies.json"),
    ("claims", "claims.json"),
    ("fraud_patterns", "fraud_patterns.json"),
    ("decision_traces", "decision_traces.json"),
    ("claim_fraud_reviews", "claim_fraud_reviews.json"),
]


def load_fixture(filename):
    """Load an Extended JSON fixture file into a list of documents."""
    path = os.path.join(DATA_DIR, filename)
    if not os.path.exists(path):
        # Keep the collection shape consistent: a missing fixture is treated as
        # an empty one so the reset still clears the collection.
        logger.warning(f"Fixture not found, treating as empty: {path}")
        return []
    with open(path, "r", encoding="utf-8") as f:
        documents = json_util.loads(f.read())
    if not isinstance(documents, list):
        raise ValueError(f"{filename} must contain a JSON array, got {type(documents).__name__}")
    return documents


def confirm(database_name, mode):
    """Ask for explicit confirmation before touching the database."""
    print(f"\n  Database : {database_name}")
    print(f"  Mode     : {mode}")
    print(f"  Action   : delete_many({{}}) on {len(COLLECTIONS)} collections"
          + (" + reload fixtures" if mode == "reset" else ""))
    answer = input("\nProceed? [y/N] ").strip().lower()
    return answer in ("y", "yes")


def run(reset, assume_yes):
    database_name = os.getenv("DATABASE_NAME")
    mode = "reset" if reset else "wipe-only"

    if not database_name or not os.getenv("MONGODB_URI"):
        logger.error("MONGODB_URI and DATABASE_NAME must both be set. Check your .env file.")
        return 1

    if not assume_yes and not confirm(database_name, mode):
        print("Aborted. Nothing was changed.")
        return 1

    connector = MongoDBConnector()
    summary = []
    failures = []

    for collection_name, filename in COLLECTIONS:
        collection = connector.get_collection(collection_name)
        before = collection.count_documents({})
        expected = 0

        try:
            deleted = collection.delete_many({}).deleted_count
            logger.info(f"[{collection_name}] deleted {deleted} document(s)")

            if reset:
                documents = load_fixture(filename)
                expected = len(documents)
                if documents:
                    inserted = len(collection.insert_many(documents).inserted_ids)
                    logger.info(f"[{collection_name}] inserted {inserted} document(s) from {filename}")
                else:
                    logger.info(f"[{collection_name}] fixture {filename} is empty, nothing to insert")
        except Exception as e:
            logger.error(f"[{collection_name}] FAILED: {e}")
            failures.append((collection_name, str(e)))

        after = collection.count_documents({})
        summary.append((collection_name, before, after, expected))
        logger.info(f"[{collection_name}] count {before} -> {after}")

    print("\n" + "=" * 68)
    print(f"Summary ({mode}) - database: {database_name}")
    print("=" * 68)
    print(f"{'collection':<24}{'before':>10}{'after':>10}{'fixture':>10}{'status':>12}")
    print("-" * 68)
    for collection_name, before, after, expected in summary:
        if any(collection_name == f[0] for f in failures):
            status = "FAILED"
        elif not reset:
            status = "ok" if after == 0 else "MISMATCH"
        else:
            status = "ok" if after == expected else "MISMATCH"
        print(f"{collection_name:<24}{before:>10}{after:>10}"
              f"{(expected if reset else 0):>10}{status:>12}")
    print("-" * 68)
    print(f"{'total':<24}{sum(s[1] for s in summary):>10}{sum(s[2] for s in summary):>10}"
          f"{sum(s[3] for s in summary) if reset else 0:>10}")

    if failures:
        print("\nFailures:")
        for collection_name, error in failures:
            print(f"  - {collection_name}: {error}")
        return 1

    print("\nDone. No collection was dropped; all indexes are intact.")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Seed or wipe the demo database.")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--reset", action="store_true",
                       help="Empty all collections and reload the fixtures (default).")
    group.add_argument("--wipe-only", action="store_true",
                       help="Empty all collections without reloading fixtures.")
    parser.add_argument("--yes", action="store_true",
                        help="Skip the confirmation prompt (for CI / non-interactive use).")
    args = parser.parse_args()

    return run(reset=not args.wipe_only, assume_yes=args.yes)


if __name__ == "__main__":
    sys.exit(main())
