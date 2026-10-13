"""Copy regular and Atlas Search / Vector Search indexes from one database to another.

Never drops anything and skips indexes that already exist (matched by name) on
the target. Dry run by default: nothing is written without --apply.

Configuration (environment variables, or a .env file in backend/):
    SOURCE_URI   connection string of the cluster to read from
    SOURCE_DB    database to read from
    TARGET_URI   connection string of the cluster to write to
    TARGET_DB    database to write to

Usage (from backend/):
    uv run python scripts/copy_indexes.py            # dry run
    uv run python scripts/copy_indexes.py --apply    # create the indexes

Atlas Search indexes build asynchronously; allow a few minutes after --apply
before querying them. Check with `make` target for check_indexes.py.
"""

import argparse
import logging
import os
import sys

from dotenv import load_dotenv
from pymongo import IndexModel, MongoClient
from pymongo.operations import SearchIndexModel

# Allow running as `python scripts/copy_indexes.py` from the backend/ directory.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.seed_db import COLLECTIONS  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

load_dotenv()

# Fields returned by list_indexes() that are not creation options.
_SKIP_INDEX_FIELDS = {"v", "ns", "key", "name"}


def copy_regular_indexes(src, dst, apply):
    """Recreate non-_id indexes. Returns (created, skipped, failed) counts."""
    created = skipped = failed = 0
    existing = {i["name"] for i in dst.list_indexes()} if dst.name in dst.database.list_collection_names() else set()

    for spec in src.list_indexes():
        name = spec["name"]
        if name == "_id_":
            continue
        if name in existing:
            logger.info(f"  index        {name:<32} exists, skipped")
            skipped += 1
            continue
        options = {k: v for k, v in spec.items() if k not in _SKIP_INDEX_FIELDS}
        keys = list(spec["key"].items())
        if not apply:
            logger.info(f"  index        {name:<32} would create {keys}")
            created += 1
            continue
        try:
            dst.create_indexes([IndexModel(keys, name=name, **options)])
            logger.info(f"  index        {name:<32} created")
            created += 1
        except Exception as e:
            logger.error(f"  index        {name:<32} FAILED: {e}")
            failed += 1
    return created, skipped, failed


def copy_search_indexes(src, dst, apply):
    """Recreate Atlas Search / Vector Search indexes. Returns (created, skipped, failed)."""
    created = skipped = failed = 0
    try:
        source_indexes = list(src.list_search_indexes())
    except Exception as e:
        logger.warning(f"  search index <unavailable on source: {e}>")
        return 0, 0, 0

    if not source_indexes:
        return 0, 0, 0

    try:
        existing = {i["name"] for i in dst.list_search_indexes()}
    except Exception:
        existing = set()  # collection may not exist yet on the target

    for idx in source_indexes:
        name = idx["name"]
        kind = idx.get("type", "search")
        if name in existing:
            logger.info(f"  {kind:<12} {name:<32} exists, skipped")
            skipped += 1
            continue
        if not apply:
            logger.info(f"  {kind:<12} {name:<32} would create")
            created += 1
            continue
        definition = idx.get("latestDefinition") or idx.get("definition")
        try:
            # create_search_index needs the collection to exist.
            if dst.name not in dst.database.list_collection_names():
                dst.database.create_collection(dst.name)
            dst.create_search_index(SearchIndexModel(definition=definition, name=name, type=kind))
            logger.info(f"  {kind:<12} {name:<32} created (building)")
            created += 1
        except Exception as e:
            logger.error(f"  {kind:<12} {name:<32} FAILED: {e}")
            failed += 1
    return created, skipped, failed


def main():
    parser = argparse.ArgumentParser(description="Copy indexes between two databases.")
    parser.add_argument("--apply", action="store_true",
                        help="Create the indexes on the target (default is a dry run).")
    args = parser.parse_args()

    values = {k: os.getenv(k) for k in ("SOURCE_URI", "SOURCE_DB", "TARGET_URI", "TARGET_DB")}
    missing = [k for k, v in values.items() if not v]
    if missing:
        logger.error(f"Missing environment variables: {', '.join(missing)}")
        return 1
    if values["SOURCE_URI"] == values["TARGET_URI"] and values["SOURCE_DB"] == values["TARGET_DB"]:
        logger.error("Source and target are the same database. Aborting.")
        return 1

    source_client = MongoClient(values["SOURCE_URI"])
    target_client = MongoClient(values["TARGET_URI"])
    source_db = source_client[values["SOURCE_DB"]]
    target_db = target_client[values["TARGET_DB"]]

    print(f"Source : {source_client.address[0] if source_client.address else 'cluster'} / {values['SOURCE_DB']}")
    print(f"Target : {target_client.address[0] if target_client.address else 'cluster'} / {values['TARGET_DB']}")
    print(f"Mode   : {'APPLY' if args.apply else 'dry run (use --apply to write)'}\n")

    totals = [0, 0, 0]
    for collection_name, _ in COLLECTIONS:
        logger.info(f"[{collection_name}]")
        src, dst = source_db[collection_name], target_db[collection_name]
        for result in (copy_regular_indexes(src, dst, args.apply),
                       copy_search_indexes(src, dst, args.apply)):
            totals = [t + r for t, r in zip(totals, result)]

    verb = "created" if args.apply else "to create"
    print(f"\nSummary: {totals[0]} {verb}, {totals[1]} already present, {totals[2]} failed")
    return 1 if totals[2] else 0


if __name__ == "__main__":
    sys.exit(main())
