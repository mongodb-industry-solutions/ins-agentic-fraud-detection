"""Chat routes for the fraud assessment agent.

Thin authenticated proxies, nothing more: no route interprets the agent's
payload. `/chat` streams Server-Sent Events straight through to the browser,
which is where the frames are parsed.
"""

from fastapi import APIRouter, Response
from fastapi.responses import StreamingResponse

from core.dependencies import AgentChatServiceDep
from schemas.chat import ChatRequest, ResumeRequest

router = APIRouter(prefix="/chat", tags=["agent-chat"])


@router.post(
    "",
    summary="Ask the fraud assessment agent a question and stream the answer",
    response_class=StreamingResponse,
)
async def invoke_agent(payload: ChatRequest, service: AgentChatServiceDep) -> StreamingResponse:
    """Proxy one turn to the agent, forwarding its SSE stream verbatim.

    Frame shapes (`chunk_type: text | progress | error | done`) are the
    platform's contract with the browser — deliberately not decoded here.
    """
    stream, content_type = await service.invoke_stream(
        message=payload.message,
        session_id=payload.sessionId,
        user_id=payload.userId,
    )
    return StreamingResponse(
        stream,
        media_type=content_type,
        headers={
            "Cache-Control": "no-cache",
            # Stops nginx/Kanopy ingress from buffering the stream into one
            # response, which would defeat token-by-token rendering.
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/resume", summary="Submit a human-review decision for a suspended run")
async def resume_execution(payload: ResumeRequest, service: AgentChatServiceDep) -> Response:
    status_code, body, content_type = await service.resume(
        execution_id=payload.execution_id,
        decision=payload.decision.value,
    )
    return Response(content=body, status_code=status_code, media_type=content_type)


@router.get("/status/{execution_id}", summary="Read the current state of an execution")
async def get_execution_status(execution_id: str, service: AgentChatServiceDep) -> Response:
    status_code, body, content_type = await service.status(execution_id)
    return Response(content=body, status_code=status_code, media_type=content_type)
