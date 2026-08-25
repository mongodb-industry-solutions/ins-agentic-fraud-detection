"""Request/response models for the fraud assessment agent chat routes.

The agent platform's own payloads are deliberately *not* modelled: /api/chat
streams bytes straight through and the status route returns the upstream body
verbatim, so a change in the platform's frame shapes stays a client-side change.
"""

from enum import Enum

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    """One conversational turn sent to the agent.

    Fields are camelCase because this is *our* API, not the platform's: this
    router is the translation boundary, and the upstream snake_case names are
    applied in `AgentChatService` so they never leak into the browser client.
    """

    message: str = Field(min_length=1)
    # Absent on the first turn of a conversation — that absence is what tells
    # the platform to start a new one, so it is never forwarded as null.
    sessionId: str | None = None
    # Anonymous per-browser id, used only for attribution on the platform side.
    userId: str | None = None


class ReviewDecision(str, Enum):
    approved = "approved"
    denied = "denied"


class ResumeRequest(BaseModel):
    """A human-review decision for an execution the agent suspended."""

    execution_id: str = Field(min_length=1)
    decision: ReviewDecision
