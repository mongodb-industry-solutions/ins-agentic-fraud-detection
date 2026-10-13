"""Drives a full fraud assessment of one claim through the agent.

This is the assessment counterpart to free-form chat: same transport, same
streaming contract, but the instruction sent to the agent is composed here
rather than typed by a user. Keeping the wording server-side means every
assessment in the demo asks for the same things in the same order, and the
client cannot reshape what the agent is asked to do.

The agent is the only writer of fraud state. Once the reviewer starts an
assessment the agent takes the lead: it gathers the context, scores the claim
and records the assessment itself (`assess_claim_fraud` writes the score,
matched patterns, linked similar claims and `processed=true` onto the claim,
and opens the decision trace). When the reviewer decides, `stream_decision`
hands the verdict to the agent, which merges it into that same trace
(`record_fraud_decision`) and closes the claim. The same tools run whether the assessment starts
here, in chat or in a batch, so the claim's status is right either way.

This service never parses the stream and never writes to MongoDB itself. It
depends on the agent actually having those write tools; an agent without them
will happily *say* it recorded something, so the client reads the claim back
afterwards to check.
"""

import logging
from collections.abc import AsyncIterator

from core.exceptions import NotFoundError, ValidationError
from repositories.claims_repo import ClaimsRepository
from services.agent_chat_service import AgentChatService

logger = logging.getLogger(__name__)

# Used when the caller does not say who started the assessment. The agent's
# tools require an initiator, and in a non-interactive run the agent cannot ask.
DEFAULT_INITIATOR = "analyst:claims-portal"

# One instruction, one place to edit it. Phrased as a task rather than a
# question so the agent runs its tools instead of describing what it would do.
ASSESSMENT_INSTRUCTION = """Run a full fraud assessment on claim {claim_id}, requested by {triggered_by}.

Do all of the following, in order:
1. Retrieve the claim, its policy and its customer, including the customer's claim history.
2. Evaluate it against the fraud pattern catalogue and list every pattern that matches, with the points each contributes.
3. Find similar historical claims with find_similar_claims and say what that comparison implies.
4. Record the assessment with assess_claim_fraud, passing triggered_by="{triggered_by}", your agent_summary, and similar_claim_ids with the IDs of the similar claims you cite. This persists the score, matched patterns, linked similar claims and processed status on the claim, and opens the decision trace.
5. Report the final fraud score, its review band and the traceId.
6. Finish with a clear recommendation for the human reviewer — confirm as fraud, or dismiss — and the single strongest piece of evidence behind it.

Do not record a fraud decision: the human reviewer makes that call.

Explain your reasoning as you go, so a reviewer can audit how the score was reached."""

# The closing turn. Sent on the assessment's session when there is one, so the
# agent still holds the analysis in context. Without one the agent can still
# record the verdict: the assessment trace it merges into is in MongoDB.
DECISION_INSTRUCTION = """The human reviewer has made a decision on claim {claim_id}.

Decision: {decision}
Reviewer: {reviewed_by}
SIU referral: {siu_referred}
{reason_line}
Record it by calling record_fraud_decision with claim_id="{claim_id}", decision="{decision}", reviewer="{reviewed_by}", siu_referred={siu_referred}{reason_arg}. Do not set any fraud fields by hand with update_claim: record_fraud_decision writes the verdict onto the claim, closes the claim, and merges the verdict into the claim's decision trace.

Then reply with a short confirmation of exactly what was written: the traceId, the claim fields set (including claimStatus), and the patterns whose stats were updated. If the tool returns an error, say so plainly; do not report success for a write that did not happen."""


class FraudAssessmentService:
    """Composes the assessment instruction and streams the agent's response."""

    def __init__(self, claims_repo: ClaimsRepository, agent: AgentChatService):
        self._claims_repo = claims_repo
        self._agent = agent

    def _build_message(self, claim_id: str, focus: str | None, triggered_by: str | None) -> str:
        message = ASSESSMENT_INSTRUCTION.format(
            claim_id=claim_id,
            triggered_by=(triggered_by or "").strip() or DEFAULT_INITIATOR,
        )
        if focus and focus.strip():
            # Appended, never substituted: a caller can steer the emphasis but
            # cannot drop any of the required steps.
            message = f"{message}\n\nPay particular attention to: {focus.strip()}"
        return message

    def _build_decision_message(
        self,
        claim_id: str,
        decision: str,
        reviewed_by: str,
        dismiss_reason: str | None,
        siu_referred: bool,
    ) -> str:
        reason_line = f"Reason given: {dismiss_reason}\n" if dismiss_reason else ""
        # The reason is a required part of the record for a dismissal, so it is
        # passed as a tool argument verbatim rather than left to the agent to infer.
        quoted = (dismiss_reason or "").replace('"', "'")
        reason_arg = f', dismiss_reason="{quoted}", notes="{quoted}"' if quoted else ""
        return DECISION_INSTRUCTION.format(
            claim_id=claim_id,
            decision=decision,
            reviewed_by=reviewed_by,
            # Spelled out as the tool's boolean, not left to the model to map.
            siu_referred="true" if siu_referred else "false",
            reason_line=reason_line,
            reason_arg=reason_arg,
        )

    async def stream_decision(
        self,
        claim_id: str,
        decision: str,
        reviewed_by: str,
        session_id: str | None = None,
        dismiss_reason: str | None = None,
        siu_referred: bool = False,
        user_id: str | None = None,
    ) -> tuple[AsyncIterator[bytes], str, str | None]:
        """Hand the reviewer's verdict to the agent to record.

        `session_id` is optional: on the assessment's session the agent can
        reference its own analysis in the confirmation, but the write itself
        only needs the claim's trace, which is already persisted.

        A dismissal without a reason is refused here — the reason IS the record.
        """
        if decision not in {"CONFIRMED_FRAUD", "DISMISSED"}:
            raise ValidationError(
                "decision must be CONFIRMED_FRAUD or DISMISSED.",
                details={"decision": decision},
            )
        if decision == "DISMISSED" and not (dismiss_reason or "").strip():
            raise ValidationError("A dismissal needs a reason.")
        if not self._claims_repo.get_raw(claim_id):
            raise NotFoundError("claim", claim_id)

        logger.info("Sending %s decision for claim %s to the agent", decision, claim_id)
        return await self._agent.invoke_stream(
            message=self._build_decision_message(
                claim_id, decision, reviewed_by, dismiss_reason, siu_referred
            ),
            session_id=session_id,
            user_id=user_id,
        )

    async def stream_assessment(
        self,
        claim_id: str,
        session_id: str | None = None,
        user_id: str | None = None,
        focus: str | None = None,
        triggered_by: str | None = None,
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
            message=self._build_message(claim_id, focus, triggered_by),
            session_id=session_id,
            user_id=user_id,
        )
