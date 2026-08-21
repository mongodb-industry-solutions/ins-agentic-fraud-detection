"""Request model for the claim fraud-assessment route.

There is no response model: the route streams the agent's SSE frames straight
through, exactly like /api/chat, so the frame shapes stay the platform's
contract with the browser.
"""

from pydantic import BaseModel

# camelCase to match the rest of our own API; the platform's snake_case names
# are applied in AgentChatService.


class AssessmentRequest(BaseModel):
    """Options for one assessment run. Every field is optional — an empty body
    means "assess this claim in a fresh conversation"."""

    # Omit to run the assessment in its own new conversation, which is the
    # normal case: an assessment should not inherit context from unrelated chat.
    # Pass a session id to continue an existing conversation instead, so a
    # follow-up question lands in the same thread as the assessment it is about.
    sessionId: str | None = None
    # Anonymous per-browser id, forwarded for attribution on the platform side.
    userId: str | None = None
    # Free-text steer appended to the instruction, e.g. "focus on the repair
    # shop relationship". Never replaces the instruction — see the service.
    focus: str | None = None
