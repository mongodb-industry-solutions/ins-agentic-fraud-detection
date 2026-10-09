"""The Fraud Assessment Queue: enqueueing, and the worker that drains it.

The backend owns the queue; the agent does not know it exists. The worker takes
one WAITING job at a time, runs the same assessment the Analyze button always
ran (FraudAssessmentService.stream_assessment), and records the agent's progress
steps and report on the job as the stream arrives. Because the run lives here
and not in the browser, closing or reloading the page never interrupts it.

This is the one place the backend reads the agent's SSE stream instead of
relaying it: the browser is no longer attached to the run, so someone has to
keep what it says. The frame handling mirrors frontend/lib/api/agentChat.js.
"""

import asyncio
import json
import logging
import time
from typing import Any

from core.config import get_settings
from core.exceptions import ConflictError, NotFoundError, ValidationError
from repositories.assessment_jobs_repo import (
    DECISION_RECORDING,
    FAILED,
    PROCESSING,
    READY_FOR_REVIEW,
    WAITING,
    AssessmentJobsRepository,
    DuplicateActiveJobError,
)
from repositories.claims_repo import ClaimsRepository
from services.fraud_assessment_service import FraudAssessmentService

logger = logging.getLogger(__name__)

# One assessment at a time, by design for now.
MAX_CONCURRENT = 1
# How long a recorded decision stays visible in the queue panel.
DECIDED_VISIBLE_SECONDS = 5
# Progress is written to MongoDB at most this often while a run streams, so a
# long report is not one write per token.
FLUSH_INTERVAL_SECONDS = 1.0
# Fallback poll, in case a wake-up signal is missed (e.g. another replica enqueued).
IDLE_POLL_SECONDS = 5.0

SSE_DATA_PREFIX = "data: "


class AssessmentQueueService:
    """Request-side operations on the queue. Stateless; the worker is separate."""

    def __init__(self, jobs: AssessmentJobsRepository, claims: ClaimsRepository,
                 worker: "AssessmentQueueWorker | None"):
        self._jobs = jobs
        self._claims = claims
        self._worker = worker

    def list_jobs(self) -> dict[str, Any]:
        jobs = self._jobs.list_visible(DECIDED_VISIBLE_SECONDS)
        self._attach_claim_summaries(jobs)
        return {
            "jobs": jobs,
            "waiting": sum(job["status"] == WAITING for job in jobs),
            "processing": sum(job["status"] == PROCESSING for job in jobs),
            "readyForReview": sum(job["status"] == READY_FOR_REVIEW for job in jobs),
        }

    def _attach_claim_summaries(self, jobs: list[dict[str, Any]]) -> None:
        """What a queue card shows besides the claim id: customer, type, amount.

        Two `$in` reads for the whole list, so the cost does not grow per card.
        """
        claim_ids = list({job["claimId"] for job in jobs})
        if not claim_ids:
            return
        claims = {
            c["claimId"]: c
            for c in self._claims.collection.find(
                {"claimId": {"$in": claim_ids}},
                {"_id": 0, "claimId": 1, "customerId": 1, "claimType": 1,
                 "coverageType": 1, "claimAmount": 1, "complexity": 1},
            )
        }
        customer_ids = list({c.get("customerId") for c in claims.values() if c.get("customerId")})
        customers = {
            c["customerId"]: f"{c.get('firstName', '')} {c.get('lastName', '')}".strip()
            for c in self._claims.db.get_collection(get_settings().CUSTOMERS_COLLECTION).find(
                {"customerId": {"$in": customer_ids}},
                {"_id": 0, "customerId": 1, "firstName": 1, "lastName": 1},
            )
        }
        for job in jobs:
            claim = claims.get(job["claimId"]) or {}
            job["claim"] = {
                "customerName": customers.get(claim.get("customerId")) or None,
                "claimType": claim.get("claimType"),
                "coverageType": claim.get("coverageType"),
                "claimAmount": claim.get("claimAmount"),
                "complexity": claim.get("complexity"),
            }

    def get(self, job_id: str) -> dict[str, Any]:
        job = self._jobs.get(job_id)
        if not job:
            raise NotFoundError("assessment job", job_id)
        return job

    def enqueue(self, claim_id: str, requested_by: str) -> dict[str, Any]:
        if not self._claims.get_raw(claim_id):
            raise NotFoundError("claim", claim_id)
        try:
            job = self._jobs.enqueue(claim_id, requested_by)
        except DuplicateActiveJobError:
            existing = self._jobs.get_active_for_claim(claim_id)
            raise ConflictError(
                f"Claim {claim_id} is already in the Fraud Assessment Queue.",
                details={"job": existing},
            )
        if self._worker:
            self._worker.wake()
        return job

    def remove(self, job_id: str) -> dict[str, Any]:
        """Take a job out of the queue. Only before its assessment has started;
        a failed job can be dismissed from the panel too."""
        job = self.get(job_id)
        if job["status"] == WAITING and self._jobs.cancel_waiting(job_id):
            return {"jobId": job_id, "removed": True}
        if job["status"] == FAILED and self._jobs.dismiss_failed(job_id):
            return {"jobId": job_id, "removed": True}
        raise ConflictError(
            "Only claims still waiting to be processed can be removed from the queue.",
            details={"status": job["status"]},
        )

    def record_decision(
        self,
        job_id: str,
        decision: str,
        reviewed_by: str,
        dismiss_reason: str | None,
        siu_referred: bool,
    ) -> dict[str, Any]:
        """Hand the reviewer's decision to the agent, in the background.

        Returns at once: the agent's decision turn runs in the backend on the
        job's own session, so the reviewer can close the window straight away.
        The job moves to DECIDED only once the claim really carries the decision.
        """
        if decision not in {"CONFIRMED_FRAUD", "DISMISSED"}:
            raise ValidationError("decision must be CONFIRMED_FRAUD or DISMISSED.")
        if not (dismiss_reason or "").strip():
            raise ValidationError("A decision needs a reason.")
        job = self.get(job_id)
        if job.get("decisionStatus") == DECISION_RECORDING:
            raise ConflictError("A decision is already being recorded for this claim.")
        request = {
            "decision": decision,
            "reviewedBy": reviewed_by,
            "dismissReason": dismiss_reason.strip(),
            "siuReferred": siu_referred,
        }
        started = self._jobs.start_decision(job_id, request)
        if not started:
            raise ConflictError(
                "A decision can only be recorded on an assessment ready for review.",
                details={"status": job["status"]},
            )
        if not self._worker:
            raise ConflictError("The assessment worker is not running.")
        self._worker.record_decision(started)
        return {"jobId": job_id, "decisionStatus": DECISION_RECORDING}


class AssessmentQueueWorker:
    """Background task that processes the queue, one job at a time."""

    def __init__(self, jobs: AssessmentJobsRepository, assessments: FraudAssessmentService,
                 claims: ClaimsRepository):
        self._jobs = jobs
        self._assessments = assessments
        self._claims = claims
        # Decision turns run alongside the queue (they are short and must not
        # wait behind assessments). Held so they are not garbage-collected.
        self._decision_tasks: set[asyncio.Task] = set()
        self._wake = asyncio.Event()
        self._task: asyncio.Task | None = None
        self._loop: asyncio.AbstractEventLoop | None = None

    # --------------------------------------------------------------- control

    def start(self) -> None:
        interrupted = self._jobs.fail_interrupted()
        if interrupted:
            logger.warning("Marked %d interrupted assessment(s) as failed", interrupted)
        # The routes that call into the worker are sync handlers, which FastAPI
        # runs on a threadpool — not on this loop. Every entry point below hands
        # its work to this loop via call_soon_threadsafe.
        self._loop = asyncio.get_running_loop()
        self._task = asyncio.create_task(self._run_forever(), name="assessment-queue-worker")

    async def shutdown(self) -> None:
        for task in list(self._decision_tasks):
            task.cancel()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    def _on_loop(self, callback, *args) -> None:
        """Run `callback` on the worker's event loop, from any thread."""
        self._loop.call_soon_threadsafe(callback, *args)

    def wake(self) -> None:
        self._on_loop(self._wake.set)

    def record_decision(self, job: dict[str, Any]) -> None:
        self._on_loop(self._start_decision_task, job)

    def _start_decision_task(self, job: dict[str, Any]) -> None:
        task = asyncio.create_task(self._record_decision(job))
        self._decision_tasks.add(task)
        task.add_done_callback(self._decision_tasks.discard)

    async def _record_decision(self, job: dict[str, Any]) -> None:
        job_id, claim_id = job["jobId"], job["claimId"]
        request = job["decisionRequest"]
        reply_parts: list[str] = []
        error: str | None = None
        logger.info("Queue: recording %s on %s", request["decision"], claim_id)
        try:
            stream, _content_type, _session = await self._assessments.stream_decision(
                claim_id=claim_id,
                decision=request["decision"],
                reviewed_by=request["reviewedBy"],
                session_id=job.get("sessionId"),
                dismiss_reason=request.get("dismissReason"),
                siu_referred=bool(request.get("siuReferred")),
            )
            buffer = ""
            steps: list[str] = []
            last_flush = time.monotonic()
            try:
                async for chunk in stream:
                    buffer += chunk.decode("utf-8", errors="replace")
                    lines = buffer.split("\n")
                    buffer = lines.pop()
                    for line in lines:
                        error = self._apply_frame(line, steps, reply_parts) or error
                    if time.monotonic() - last_flush >= FLUSH_INTERVAL_SECONDS:
                        await asyncio.to_thread(
                            self._jobs.set_decision_reply, job_id, "".join(reply_parts)
                        )
                        last_flush = time.monotonic()
                if buffer:
                    error = self._apply_frame(buffer, steps, reply_parts) or error
            finally:
                await stream.aclose()
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001
            logger.exception("Queue: recording the decision on %s failed", claim_id)
            error = getattr(exc, "message", None) or str(exc) or "The agent could not be reached."

        reply = "".join(reply_parts)
        # The agent saying it wrote is not proof: the claim is read back.
        claim = await asyncio.to_thread(self._claims.get_raw, claim_id) or {}
        fraud = claim.get("fraud") or {}
        landed = (
            fraud.get("fraudFlag") is not None
            and fraud.get("reviewedAt") is not None
            and claim.get("claimStatus") == "CLOSED"
        )
        if landed:
            await asyncio.to_thread(self._jobs.mark_decided, job_id, reply)
            logger.info("Queue: decision on %s recorded", claim_id)
        else:
            await asyncio.to_thread(
                self._jobs.fail_decision, job_id, reply,
                error or "The decision did not reach the claim record (it is not marked as "
                         "decided and closed). Check the agent's reply and record it again.",
            )
            logger.warning("Queue: decision on %s did not land", claim_id)

    # ------------------------------------------------------------------ loop

    async def _run_forever(self) -> None:
        while True:
            try:
                job = None
                if await asyncio.to_thread(self._jobs.count_processing) < MAX_CONCURRENT:
                    job = await asyncio.to_thread(self._jobs.claim_next)
                if job:
                    await self._process(job)
                    continue  # straight on to the next waiting claim
                self._wake.clear()
                try:
                    await asyncio.wait_for(self._wake.wait(), timeout=IDLE_POLL_SECONDS)
                except asyncio.TimeoutError:
                    pass
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001 — the worker must outlive one bad job
                logger.exception("Assessment queue worker error")
                await asyncio.sleep(IDLE_POLL_SECONDS)

    async def _process(self, job: dict[str, Any]) -> None:
        job_id, claim_id = job["jobId"], job["claimId"]
        logger.info("Queue: assessing %s (%s)", claim_id, job_id)
        steps: list[str] = []
        report_parts: list[str] = []
        errors: list[str] = []

        async def consume() -> None:
            stream, _content_type, session_id = await self._assessments.stream_assessment(
                claim_id=claim_id, triggered_by=job.get("requestedBy")
            )
            if session_id:
                await asyncio.to_thread(self._jobs.set_session, job_id, session_id)
            buffer = ""
            last_flush = time.monotonic()
            try:
                async for chunk in stream:
                    buffer += chunk.decode("utf-8", errors="replace")
                    lines = buffer.split("\n")
                    buffer = lines.pop()  # a frame may be split across chunks
                    for line in lines:
                        error = self._apply_frame(line, steps, report_parts)
                        if error:
                            errors.append(error)
                    if time.monotonic() - last_flush >= FLUSH_INTERVAL_SECONDS:
                        await asyncio.to_thread(
                            self._jobs.set_progress, job_id, list(steps), "".join(report_parts)
                        )
                        last_flush = time.monotonic()
                if buffer:
                    error = self._apply_frame(buffer, steps, report_parts)
                    if error:
                        errors.append(error)
            finally:
                await stream.aclose()  # closes the upstream connection on any exit

        try:
            await consume()
        except asyncio.CancelledError:
            raise  # the worker itself is shutting down
        except Exception as exc:  # noqa: BLE001
            logger.exception("Queue: assessment of %s failed", claim_id)
            errors.append(
                getattr(exc, "message", None) or str(exc) or "The assessment could not be completed."
            )

        status = FAILED if errors else READY_FOR_REVIEW
        await asyncio.to_thread(
            self._jobs.finish, job_id, status, steps, "".join(report_parts),
            errors[-1] if errors else None,
        )
        logger.info("Queue: %s finished as %s", claim_id, status)

    @staticmethod
    def _apply_frame(line: str, steps: list[str], report_parts: list[str]) -> str | None:
        """Apply one SSE line to the run's state. Returns an error message, if any."""
        line = line.strip()
        if not line or line == f"{SSE_DATA_PREFIX}[DONE]":
            return None
        raw = line[len(SSE_DATA_PREFIX):] if line.startswith(SSE_DATA_PREFIX) else line
        try:
            frame = json.loads(raw)
        except json.JSONDecodeError:
            report_parts.append(raw)  # bare text, treated as content
            return None
        if not isinstance(frame, dict):
            return None
        kind = frame.get("chunk_type")
        if kind == "progress":
            # Empty frames arrive between steps; consecutive repeats ("Thinking...")
            # are collapsed. Same rules as the browser used to apply.
            label = str(frame.get("content") or "").strip()
            if label and (not steps or steps[-1] != label):
                steps.append(label)
        elif kind == "text":
            report_parts.append(frame.get("content") or "")
        elif kind == "error":
            return str(frame.get("content") or frame.get("error") or frame.get("message")
                       or "The agent reported an error.")
        return None
