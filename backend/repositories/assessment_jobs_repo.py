"""Data access for the assessment_jobs collection: the Fraud Assessment Queue.

One document per claim sent through the queue. The backend's queue worker is
the only writer of a job's lifecycle; the agent never sees this collection — it
is simply invoked once per job, exactly as for a single assessment.

Lifecycle:
    WAITING -> PROCESSING -> READY_FOR_REVIEW -> DECIDED
                          \\-> FAILED
    WAITING -> CANCELLED       (removed from the queue before it started)
    PROCESSING -> FAILED       (agent error, or interrupted by a restart)

`active` is true while a job is WAITING, PROCESSING or READY_FOR_REVIEW. A
partial unique index on (claimId, active=true) is what guarantees one live
assessment per claim, even under concurrent requests.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from pymongo import ASCENDING, ReturnDocument
from pymongo.errors import DuplicateKeyError

from core.config import get_settings
from db.mdb import MongoDBConnector

WAITING = "WAITING"
PROCESSING = "PROCESSING"
READY_FOR_REVIEW = "READY_FOR_REVIEW"
DECIDED = "DECIDED"
FAILED = "FAILED"
CANCELLED = "CANCELLED"

ACTIVE_STATUSES = (WAITING, PROCESSING, READY_FOR_REVIEW)

# The reviewer's decision, recorded by the agent on the job's session while the
# job is READY_FOR_REVIEW. Kept on the job so the window can close mid-record.
DECISION_RECORDING = "RECORDING"
DECISION_FAILED = "FAILED"

# Bulky fields left out of the queue listing; the job detail carries them.
SUMMARY_PROJECTION = {"_id": 0, "steps": 0, "report": 0}


class DuplicateActiveJobError(Exception):
    """The claim already has a job in the queue."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


class AssessmentJobsRepository:
    def __init__(self, db: MongoDBConnector):
        self.collection = db.get_collection(get_settings().ASSESSMENT_JOBS_COLLECTION)

    def ensure_indexes(self) -> None:
        self.collection.create_index("jobId", unique=True)
        self.collection.create_index(
            "claimId",
            name="one_active_job_per_claim",
            unique=True,
            partialFilterExpression={"active": True},
        )
        self.collection.create_index([("status", ASCENDING), ("enqueuedAt", ASCENDING)])

    # ------------------------------------------------------------------ reads

    def get(self, job_id: str) -> dict[str, Any] | None:
        return self.collection.find_one({"jobId": job_id}, {"_id": 0})

    def get_active_for_claim(self, claim_id: str) -> dict[str, Any] | None:
        return self.collection.find_one(
            {"claimId": claim_id, "active": True}, SUMMARY_PROJECTION
        )

    def list_visible(self, decided_visible_seconds: int) -> list[dict[str, Any]]:
        """Everything the queue panel shows: live jobs, failures still to be
        acknowledged, and decisions recorded in the last few seconds.

        Ordered processing first, then ready, then waiting in queue order.
        """
        since = _now() - timedelta(seconds=decided_visible_seconds)
        jobs = list(
            self.collection.find(
                {
                    "$or": [
                        {"active": True},
                        {"status": FAILED, "dismissedAt": None},
                        {"status": DECIDED, "decidedAt": {"$gte": since}},
                    ]
                },
                SUMMARY_PROJECTION,
            ).sort("enqueuedAt", ASCENDING)
        )
        order = {PROCESSING: 0, READY_FOR_REVIEW: 1, WAITING: 2, FAILED: 3, DECIDED: 4}
        return sorted(jobs, key=lambda job: order.get(job["status"], 9))

    def count_processing(self) -> int:
        return self.collection.count_documents({"status": PROCESSING})

    # ----------------------------------------------------------------- writes

    def enqueue(self, claim_id: str, requested_by: str) -> dict[str, Any]:
        doc = {
            "jobId": f"AJ-{uuid.uuid4().hex[:10].upper()}",
            "claimId": claim_id,
            "status": WAITING,
            "active": True,
            "requestedBy": requested_by,
            "enqueuedAt": _now(),
            "startedAt": None,
            "finishedAt": None,
            "decidedAt": None,
            "dismissedAt": None,
            "sessionId": None,
            "decisionStatus": None,
            "decisionRequest": None,
            "decisionReply": None,
            "decisionError": None,
            "steps": [],
            "report": "",
            "error": None,
        }
        try:
            self.collection.insert_one(doc)
        except DuplicateKeyError as error:
            raise DuplicateActiveJobError(claim_id) from error
        doc.pop("_id", None)
        return doc

    def claim_next(self) -> dict[str, Any] | None:
        """Move the oldest WAITING job to PROCESSING and return it.

        The status filter makes this atomic: two workers can never take the same
        job. Callers check `count_processing()` first to keep one run at a time.
        """
        return self.collection.find_one_and_update(
            {"status": WAITING},
            {"$set": {"status": PROCESSING, "startedAt": _now()}},
            sort=[("enqueuedAt", ASCENDING)],
            projection={"_id": 0},
            return_document=ReturnDocument.AFTER,
        )

    def set_session(self, job_id: str, session_id: str) -> None:
        self.collection.update_one({"jobId": job_id}, {"$set": {"sessionId": session_id}})

    def set_progress(self, job_id: str, steps: list[str], report: str) -> None:
        self.collection.update_one(
            {"jobId": job_id}, {"$set": {"steps": steps, "report": report}}
        )

    def finish(self, job_id: str, status: str, steps: list[str], report: str,
               error: str | None = None) -> None:
        self.collection.update_one(
            {"jobId": job_id, "status": PROCESSING},
            {"$set": {
                "status": status,
                "active": status == READY_FOR_REVIEW,
                "steps": steps,
                "report": report,
                "error": error,
                "finishedAt": _now(),
            }},
        )

    def cancel_waiting(self, job_id: str) -> bool:
        result = self.collection.update_one(
            {"jobId": job_id, "status": WAITING},
            {"$set": {"status": CANCELLED, "active": False, "finishedAt": _now()}},
        )
        return result.modified_count == 1

    def start_decision(self, job_id: str, request: dict[str, Any]) -> dict[str, Any] | None:
        """Claim the job for recording a decision; None if it is not ready for
        review or a decision is already being recorded."""
        return self.collection.find_one_and_update(
            {"jobId": job_id, "status": READY_FOR_REVIEW,
             "decisionStatus": {"$ne": DECISION_RECORDING}},
            {"$set": {"decisionStatus": DECISION_RECORDING, "decisionRequest": request,
                      "decisionReply": None, "decisionError": None,
                      "decisionStartedAt": _now()}},
            projection={"_id": 0},
            return_document=ReturnDocument.AFTER,
        )

    def set_decision_reply(self, job_id: str, reply: str) -> None:
        self.collection.update_one({"jobId": job_id}, {"$set": {"decisionReply": reply}})

    def fail_decision(self, job_id: str, reply: str, error: str) -> None:
        """The decision did not land: the job stays ready for review, so the
        reviewer can record it again."""
        self.collection.update_one(
            {"jobId": job_id},
            {"$set": {"decisionStatus": DECISION_FAILED, "decisionReply": reply,
                      "decisionError": error}},
        )

    def mark_decided(self, job_id: str, reply: str | None = None) -> dict[str, Any] | None:
        return self.collection.find_one_and_update(
            {"jobId": job_id, "status": READY_FOR_REVIEW},
            {"$set": {"status": DECIDED, "active": False, "decidedAt": _now(),
                      "decisionStatus": DECIDED,
                      **({"decisionReply": reply} if reply is not None else {})}},
            projection=SUMMARY_PROJECTION,
            return_document=ReturnDocument.AFTER,
        )

    def dismiss_failed(self, job_id: str) -> bool:
        result = self.collection.update_one(
            {"jobId": job_id, "status": FAILED},
            {"$set": {"dismissedAt": _now()}},
        )
        return result.modified_count == 1

    def fail_interrupted(self) -> int:
        """At startup: a PROCESSING job belongs to a run this process no longer
        owns (the backend restarted mid-assessment). It is failed rather than
        silently restarted, so the reviewer decides whether to run it again."""
        result = self.collection.update_many(
            {"status": PROCESSING},
            {"$set": {
                "status": FAILED,
                "active": False,
                "finishedAt": _now(),
                "error": "The assessment was interrupted by a backend restart. "
                         "Add the claim to the queue again to re-run it.",
            }},
        )
        # A decision being recorded when the process stopped: offer it again.
        self.collection.update_many(
            {"decisionStatus": DECISION_RECORDING},
            {"$set": {"decisionStatus": DECISION_FAILED,
                      "decisionError": "Recording the decision was interrupted by a backend "
                                       "restart. Please record it again."}},
        )
        return result.modified_count
