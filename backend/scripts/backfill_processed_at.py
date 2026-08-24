"""Backfill `fraud.processedAt` onto claims that were processed before it existed.

Why this script exists
----------------------
`get_review_queue_metrics` measures time-to-decision as
`fraud.reviewedAt - fraud.processedAt`. Only the first of those two fields was in
the original data model: `processed` was a boolean with no timestamp beside it,
so there was no start of the interval to subtract from. `fraud.processedAt` is
now written by the decision flow (both the REST endpoint and the agent
instruction), but nothing has retro-fitted it onto the claims that were already
decided — and a duration cannot be computed from a timestamp that was never
recorded.

What it does, and what that costs
---------------------------------
Each processed claim without a `processedAt` gets one, copied from
`fraud.reviewedAt` where present and `claimDate` otherwise. The first case makes
that claim's turnaround read as exactly zero hours; the second makes it read as
the entire age of the claim. Neither is the truth — the truth was not recorded —
which is why the metric reports `timeToDecisionCoverage` alongside the average
rather than presenting the backfilled rows as equivalent to real measurements.

Only claims genuinely missing the field are touched, so this is safe to re-run
and will report 0 the second time.

Usage:
    uv run python scripts/backfill_processed_at.py
"""

import os
import sys

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()

from core.db import create_connector  # noqa: E402
from repositories.claims_repo import ClaimsRepository  # noqa: E402


def main() -> int:
    connector = create_connector()
    try:
        repo = ClaimsRepository(connector)

        missing = repo.collection.count_documents(
            {"fraud.processed": True, "fraud.processedAt": {"$exists": False}}
        )
        print(f"Processed claims missing fraud.processedAt: {missing}")
        if not missing:
            print("Nothing to do.")
            return 0

        modified = repo.backfill_processed_at()
        print(f"Backfilled fraud.processedAt on {modified} claim(s).")

        decided = repo.collection.count_documents({"fraud.fraudFlag": {"$in": [True, False]}})
        covered = repo.collection.count_documents({
            "fraud.fraudFlag": {"$in": [True, False]},
            "fraud.processedAt": {"$exists": True},
            "fraud.reviewedAt": {"$exists": True},
        })
        print(
            f"Time-to-decision coverage is now {covered}/{decided} decided claims "
            f"({(covered / decided if decided else 0):.0%})."
        )
        print(
            "\nNote: backfilled rows read as a zero-hour turnaround where reviewedAt "
            "was used.\nThe real interval was never recorded; only decisions made "
            "after this change\nproduce a genuine duration."
        )
        return 0
    finally:
        connector.client.close()


if __name__ == "__main__":
    sys.exit(main())
