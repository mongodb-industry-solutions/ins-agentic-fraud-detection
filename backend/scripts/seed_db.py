"""Seed / reset the demo database from the JSON fixtures in backend/data.

A thin CLI over services/demo_reset_service.py, the same code the app's
`POST /api/admin/reset-demo` endpoint runs.

Never drops a collection: `drop()` would also destroy Atlas Vector Search
indexes, which pymongo's standard index API cannot recreate (see
_vector_search_idx_creator.py). Emptying is always done with `delete_many({})`,
which leaves every index in place. `fraud_patterns` is static and left untouched.

Usage:
    uv run python scripts/seed_db.py --reset [--yes]
    uv run python scripts/seed_db.py --wipe-only [--yes]
"""

import argparse
import logging
import os
import sys

from dotenv import load_dotenv

# Allow running as `python scripts/seed_db.py` from the backend/ directory.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from db.mdb import MongoDBConnector  # noqa: E402
from services.demo_reset_service import COLLECTIONS, DemoResetService  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

load_dotenv()


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
    # The "agent is busy" check does not apply: there is no worker in this process.
    service = DemoResetService(connector)

    try:
        rows = service.reset(reload=reset, check_busy=False)
    except Exception as e:
        logger.error(f"Reset FAILED: {e}")
        return 1

    print("\n" + "=" * 68)
    print(f"Summary ({mode}) - database: {database_name}")
    print("=" * 68)
    print(f"{'collection':<24}{'before':>10}{'after':>10}{'fixture':>10}{'status':>12}")
    print("-" * 68)
    for r in rows:
        status = "ok" if r["after"] == r["expected"] else "MISMATCH"
        print(f"{r['collection']:<24}{r['before']:>10}{r['after']:>10}{r['expected']:>10}{status:>12}")
    print("-" * 68)
    print(f"{'total':<24}{sum(r['before'] for r in rows):>10}{sum(r['after'] for r in rows):>10}"
          f"{sum(r['expected'] for r in rows):>10}")

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
