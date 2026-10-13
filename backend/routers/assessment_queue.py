"""The Fraud Assessment Queue.

Claims are added here and the backend's worker assesses them one at a time.
The agent is invoked once per job and knows nothing about the queue.
"""

from fastapi import APIRouter, Path
from pydantic import BaseModel, Field

from core.dependencies import AssessmentQueueServiceDep

router = APIRouter(prefix="/assessment-queue", tags=["assessment-queue"])

JobIdPath = Path(description="Assessment job id, e.g. AJ-1A2B3C4D5E")


class EnqueueRequest(BaseModel):
    claimId: str = Field(min_length=1)
    # Recorded by the agent as the decision trace's triggeredBy.
    requestedBy: str = Field(min_length=1)


@router.get("", summary="Jobs shown in the queue panel, processing first")
def list_queue(service: AssessmentQueueServiceDep) -> dict:
    return service.list_jobs()


@router.post("", status_code=201, summary="Add a claim to the queue (409 if already in it)")
def enqueue(payload: EnqueueRequest, service: AssessmentQueueServiceDep) -> dict:
    return service.enqueue(payload.claimId, payload.requestedBy)


@router.get("/{job_id}", summary="One job, with the agent's steps and report so far")
def get_job(service: AssessmentQueueServiceDep, job_id: str = JobIdPath) -> dict:
    return service.get(job_id)


@router.delete("/{job_id}", summary="Remove a claim still waiting to be processed")
def remove(service: AssessmentQueueServiceDep, job_id: str = JobIdPath) -> dict:
    return service.remove(job_id)


class DecisionRequest(BaseModel):
    decision: str  # CONFIRMED_FRAUD | DISMISSED
    reviewedBy: str = Field(min_length=1)
    # The reviewer's reason, required for both outcomes: the agent writes it into
    # the decision trace as the human's rationale.
    reason: str = Field(min_length=1)
    siuReferred: bool = False


@router.post(
    "/{job_id}/decision",
    status_code=202,
    summary="Have the agent record the reviewer's decision, in the background",
)
def record_decision(
    payload: DecisionRequest, service: AssessmentQueueServiceDep, job_id: str = JobIdPath
) -> dict:
    return service.record_decision(
        job_id, payload.decision, payload.reviewedBy, payload.reason, payload.siuReferred
    )
