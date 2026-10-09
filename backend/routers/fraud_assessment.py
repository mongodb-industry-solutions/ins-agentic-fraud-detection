"""Agent-driven fraud assessment of a single claim.

Kept separate from `claims.py` (CRUD) and `fraud.py` (portfolio analytics)
because this is the one claim-scoped route that invokes the agent and streams.
"""

from fastapi import APIRouter, Path
from fastapi.responses import StreamingResponse

from core.dependencies import FraudAssessmentServiceDep
from schemas.assessment import AssessmentRequest, DecisionInstructionRequest
from services.agent_chat_service import SESSION_HEADER

router = APIRouter(prefix="/fraud-assessment", tags=["fraud-assessment"])

ClaimIdPath = Path(description="Claim id, e.g. CLM-1001")


@router.post(
    "/{claim_id}",
    summary="Run the agent's full fraud assessment on a claim and stream it",
    response_class=StreamingResponse,
)
async def assess_claim(
    service: FraudAssessmentServiceDep,
    payload: AssessmentRequest | None = None,
    claim_id: str = ClaimIdPath,
) -> StreamingResponse:
    """Stream the assessment as SSE, using the same frame contract as /api/chat.

    404 if the claim does not exist, 503 if the agent is not configured.
    """
    options = payload or AssessmentRequest()

    stream, content_type, session_id = await service.stream_assessment(
        claim_id=claim_id,
        session_id=options.sessionId,
        user_id=options.userId,
        focus=options.focus,
        triggered_by=options.triggeredBy,
    )

    return StreamingResponse(
        stream,
        media_type=content_type,
        headers={
            # Relayed so the caller can ask follow-up questions in the same
            # conversation as the assessment they just watched run.
            **({SESSION_HEADER: session_id} if session_id else {}),
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post(
    "/{claim_id}/decision",
    summary="Hand the reviewer's verdict to the agent to record, and stream its reply",
    response_class=StreamingResponse,
)
async def commit_decision_via_agent(
    payload: DecisionInstructionRequest,
    service: FraudAssessmentServiceDep,
    claim_id: str = ClaimIdPath,
) -> StreamingResponse:
    """The closing turn of an assessment: the agent records the verdict.

    The agent is the only writer of fraud state, so this asks it to merge the
    verdict into the claim's decision trace (record_fraud_decision) rather
    than writing to MongoDB here. Uses the assessment's session when given.

    Streams the agent's confirmation of what it wrote. 400 if the decision is
    unusable, 404 if the claim does not exist, 503 if the agent is not
    configured.
    """
    stream, content_type, session_id = await service.stream_decision(
        claim_id=claim_id,
        decision=payload.decision,
        reviewed_by=payload.reviewedBy,
        session_id=payload.sessionId,
        dismiss_reason=payload.dismissReason,
        siu_referred=payload.siuReferred,
        user_id=payload.userId,
    )

    return StreamingResponse(
        stream,
        media_type=content_type,
        headers={
            **({SESSION_HEADER: session_id} if session_id else {}),
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
