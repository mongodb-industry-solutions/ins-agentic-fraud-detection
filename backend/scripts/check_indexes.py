"""Report every regular and Atlas Search index on the demo collections.

Run before and after `make seed` and diff the output: the two must be
identical. A missing index means a `drop()` slipped in somewhere instead of
`delete_many({})`.

Usage:
    uv run python scripts/check_indexes.py
"""

import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.mdb import MongoDBConnector  # noqa: E402
from scripts.seed_db import COLLECTIONS  # noqa: E402

load_dotenv()


def main():
    connector = MongoDBConnector()
    print(f"Database: {connector.database_name}\n")

    for collection_name, _ in COLLECTIONS:
        collection = connector.get_collection(collection_name)
        print(f"{collection_name} ({collection.count_documents({})} documents)")

        for index in collection.list_indexes():
            keys = ", ".join(f"{field}:{direction}" for field, direction in index["key"].items())
            print(f"  index         {index['name']:<28} [{keys}]")

        try:
            for index in collection.list_search_indexes():
                print(f"  search index  {index['name']:<28} "
                      f"type={index.get('type', 'search')} status={index.get('status', '?')}")
        except Exception as e:
            print(f"  search index  <unavailable: {e}>")

        print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
