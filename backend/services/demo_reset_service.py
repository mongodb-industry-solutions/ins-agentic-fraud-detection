"""Reset the demo database to its starting state.

Shared by the `POST /api/admin/reset-demo` endpoint and `scripts/seed_db.py`, so
the two can never drift apart.

Never drops a collection: `drop()` would also destroy Atlas Vector Search
indexes, which pymongo's standard index API cannot recreate. Emptying is always
`delete_many({})`, which leaves every index in place.

`fraud_patterns` is deliberately not part of the reset: the patterns are static
reference data, so they are neither emptied nor reloaded.
"""

import logging
import os
import re
import threading
import time
from typing import Any

from bson import json_util

from core.exceptions import ConflictError
from repositories.assessment_jobs_repo import DECISION_RECORDING, PROCESSING

logger = logging.getLogger(__name__)

DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"
)

TRACE_COUNTER_ID = "traceId"

# Fixed dependency order: a document is only loaded after whatever it
# references. Mongo does not enforce this, but validation or logging added
# later may assume it. A None fixture means "empty on reset, nothing to reload".
COLLECTIONS: list[tuple[str, str | None]] = [
    ("customers", "customers.json"),
    ("policies", "policies.json"),
    ("claims", "claims.json"),
    ("decision_traces", "decision_traces.json"),
    # Runtime state written by the app.
    ("assessment_jobs", None),
    # Trace-ID sequence: emptied, then re-seeded from the loaded traces.
    ("counters", None),
]

# One reset at a time, process-wide.
_reset_lock = threading.Lock()


def load_fixture(filename: str) -> list[dict]:
    """Load an Extended JSON fixture file into a list of documents.

    A missing or malformed fixture raises: a reset must not silently leave a
    collection empty because a file went missing.
    """
    path = os.path.join(DATA_DIR, filename)
    if not os.path.exists(path):
        raise FileNotFoundError(f"Fixture not found: {path}")
    with open(path, "r", encoding="utf-8") as f:
        documents = json_util.loads(f.read())
    if not isinstance(documents, list):
        raise ValueError(f"{filename} must contain a JSON array, got {type(documents).__name__}")
    return documents


def highest_trace_seq(traces: list[dict]) -> int:
    """Highest numeric TRC-#### among the given traces (0 if none)."""
    highest = 0
    for doc in traces:
        match = re.match(r"^TRC-(\d+)$", doc.get("traceId", ""))
        if match:
            highest = max(highest, int(match.group(1)))
    return highest


class DemoResetService:
    def __init__(self, connector):
        self._db = connector

    def status(self) -> dict[str, Any]:
        return {"database": self._db.database_name}

    def reset(self, *, reload: bool = True, check_busy: bool = True) -> list[dict[str, Any]]:
        """Empty every demo collection and (by default) reload the fixtures.

        `check_busy` is switched off only by the CLI, which has no worker to race.
        Returns one row per collection: name, before, deleted, inserted.
        """
        if not _reset_lock.acquire(blocking=False):
            raise ConflictError("A reset is already running.")
        try:
            if check_busy:
                self._ensure_idle()
            return self._run(reload)
        finally:
            _reset_lock.release()

    # ---------------------------------------------------------------- internals

    def _ensure_idle(self) -> None:
        """Refuse while the agent is writing: an assessment in progress or a decision being recorded.

        Jobs merely waiting or pending review are fine; they are wiped with the rest.
        """
        jobs = self._db.get_collection("assessment_jobs")
        busy = jobs.count_documents(
            {"$or": [{"status": PROCESSING}, {"decisionStatus": DECISION_RECORDING}]}
        )
        if busy:
            raise ConflictError(
                "The agent is busy: an assessment is in progress or a decision is being recorded. "
                "Wait for it to finish, then reset again.",
                {"busyJobs": busy},
            )

    def _run(self, reload: bool) -> list[dict[str, Any]]:
        started = time.monotonic()
        # Read and parse every fixture BEFORE deleting anything, so a bad file
        # aborts the reset instead of leaving the database empty.
        fixtures: dict[str, list[dict]] = {}
        if reload:
            for name, filename in COLLECTIONS:
                if filename:
                    fixtures[name] = load_fixture(filename)

        rows = []
        for name, filename in COLLECTIONS:
            collection = self._db.get_collection(name)
            row = {"collection": name, "before": collection.count_documents({}), "deleted": 0, "inserted": 0}
            row["deleted"] = collection.delete_many({}).deleted_count

            if reload and name == "counters":
                # Without this the agent restarts the sequence at TRC-0001 and
                # collides with the loaded traces (unique index on traceId).
                seq = highest_trace_seq(fixtures.get("decision_traces", []))
                collection.insert_one({"_id": TRACE_COUNTER_ID, "seq": seq})
                row["inserted"] = 1
            elif reload and filename and fixtures[name]:
                row["inserted"] = len(collection.insert_many(fixtures[name]).inserted_ids)

            row["after"] = collection.count_documents({})
            row["expected"] = (1 if name == "counters" else len(fixtures.get(name, []))) if reload else 0
            logger.info("[reset] %s: %d -> %d", name, row["before"], row["after"])
            rows.append(row)

        mismatched = [r["collection"] for r in rows if r["after"] != r["expected"]]
        if mismatched:
            raise RuntimeError(f"Reset finished but counts do not match the fixtures: {mismatched}")
        logger.info("[reset] done in %.1fs", time.monotonic() - started)
        return rows
