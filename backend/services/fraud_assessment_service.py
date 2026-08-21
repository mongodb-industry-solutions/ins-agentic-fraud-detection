"""Drives a full fraud assessment of one claim through the agent.

This is the assessment counterpart to free-form chat: same transport, same
streaming contract, but the instruction sent to the agent is composed here
rather than typed by a user. Keeping the wording server-side means every
assessment in the demo asks for the same things in the same order, and the
client cannot reshape what the agent is asked to do.

Scoring lives in the agent. Nothing is written to the database by an assessment:
the result is a *recommendation*, and it only becomes a record once a human
confirms or dismisses it through `POST /claims/{claim_id}/decision`. This service
therefore does not parse the answer or persist anything — and the instruction
below deliberately does not ask the agent to save its findings either.
"""

import logging
from collections.abc import AsyncIterator

from core.exceptions import NotFoundError
from repositories.claims_repo import ClaimsRepository
from services.agent_chat_service import AgentChatService

logger = logging.getLogger(__name__)

# One instruction, one place to edit it. Phrased as a task rather than a
# question so the agent runs its tools instead of describing what it would do.
ASSESSMENT_INSTRUCTION = """Run a full fraud assessment on claim {claim_id}.

Do all of the following, in order:
1. Retrieve the claim, its policy and its customer, including the customer's claim history.
2. Evaluate it against the fraud pattern catalogue and list every pattern that matches, with the points each contributes.
3. Compare it against similar historical claims and say what that comparison implies.
4. Compute the final fraud score and state which review band it falls into.
5. Finish with a clear recommendation for the human reviewer — confirm as fraud, or dismiss — and the single strongest piece of evidence behind it.

Do not save or record anything: this assessment is a recommendation, and the human reviewer is the one who commits the decision.

Explain your reasoning as you go, so a reviewer can audit how the score was reached."""


class FraudAssessmentService:
    """Composes the assessment instruction and streams the agent's response."""

    def __init__(self, claims_repo: ClaimsRepository, agent: AgentChatService):
        self._claims_repo = claims_repo
        self._agent = agent

    def _build_message(self, claim_id: str, focus: str | None) -> str:
        message = ASSESSMENT_INSTRUCTION.format(claim_id=claim_id)
        if focus and focus.strip():
            # Appended, never substituted: a caller can steer the emphasis but
            # cannot drop any of the required steps.
            message = f"{message}\n\nPay particular attention to: {focus.strip()}"
        return message

    async def stream_assessment(
        self,
        claim_id: str,
        session_id: str | None = None,
        user_id: str | None = None,
        focus: str | None = None,
    ) -> tuple[AsyncIterator[bytes], str, str | None]:
        """Validate the claim, then stream the agent's assessment of it.

        Returns the same triple as `AgentChatService.invoke_stream`:
        (byte iterator, content type, session id).

        The existence check is not redundant with the agent's own lookup: an
        agent run costs 15-30 seconds and shared pool capacity, and a typo'd id
        would otherwise come back as a plausible-sounding answer about a claim
        that does not exist. A 404 here is cheaper and truthful.
        """
        if not self._claims_repo.get_raw(claim_id):
            raise NotFoundError("claim", claim_id)

        logger.info("Starting fraud assessment for claim %s", claim_id)
        return await self._agent.invoke_stream(
            message=self._build_message(claim_id, focus),
            session_id=session_id,
            user_id=user_id,
        )
