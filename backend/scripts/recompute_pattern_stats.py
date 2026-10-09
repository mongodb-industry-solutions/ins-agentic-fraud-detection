"""Recount every fraud pattern's stats from the claims it currently matches.

The agent recounts the affected patterns each time it records an assessment or a
decision (FraudPatternStore.recompute_stats). This script does the same for every
pattern at once: run it after seeding or editing claims directly, so the stats
reflect the data instead of the fixture's sample numbers.

  timesTriggered     = claims whose fraud.matchedPatterns include the pattern
  confirmedCount     = those claims confirmed as fraud (fraudFlag = true)
  confirmedFraudRate = confirmedCount / timesTriggered

Usage (from backend/):
    uv run python scripts/recompute_pattern_stats.py
"""

import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pymongo import MongoClient  # noqa: E402

from core.config import get_settings  # noqa: E402


def main() -> int:
    settings = get_settings()
    db = MongoClient(settings.MONGODB_URI)[settings.DATABASE_NAME]
    claims = db[settings.CLAIMS_COLLECTION]
    patterns = db[settings.PATTERNS_COLLECTION]

    print(f"database: {settings.DATABASE_NAME}")
    print(f"{'pattern':<8} {'before (trig/conf/rate)':<26} after (trig/conf/rate)")
    for pattern in patterns.find({}, {"_id": 0, "patternId": 1, "stats": 1}).sort("patternId"):
        pattern_id = pattern["patternId"]
        old = pattern.get("stats") or {}
        matched = {"fraud.matchedPatterns.patternId": pattern_id}
        times = claims.count_documents(matched)
        confirmed = claims.count_documents({**matched, "fraud.fraudFlag": True})
        rate = round(confirmed / times, 4) if times else 0.0
        patterns.update_one(
            {"patternId": pattern_id},
            {"$set": {
                "stats.timesTriggered": times,
                "stats.confirmedCount": confirmed,
                "stats.confirmedFraudRate": rate,
                "updatedAt": datetime.now(timezone.utc),
            }},
        )
        before = f"{old.get('timesTriggered')}/{old.get('confirmedCount')}/{old.get('confirmedFraudRate')}"
        print(f"{pattern_id:<8} {before:<26} {times}/{confirmed}/{rate}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
