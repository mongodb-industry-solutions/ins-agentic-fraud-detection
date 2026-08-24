"""Drives a full fraud assessment of one claim through the agent.

This is the assessment counterpart to free-form chat: same transport, same
streaming contract, but the instruction sent to the agent is composed here
rather than typed by a user. Keeping the wording server-side means every
assessment in the demo asks for the same things in the same order, and the
client cannot reshape what the agent is asked to do.

Scoring lives in the agent, and so does persistence. An assessment writes
nothing — it is a *recommendation*, and the instruction deliberately forbids
saving. It becomes a record when the reviewer decides: `stream_decision` sends
the verdict back on the SAME conversation and asks the agent to write the claim
outcome and its own audit-trail entry. The agent produced the findings, so the
agent records them.

This service still never parses the stream and never writes to MongoDB itself.
Two consequences worth knowing:

* It depends on the agent actually having write tools. Nothing here can grant
  them, and an agent without them will happily *say* it recorded the decision.
  The client reads the claim back afterwards for exactly that reason.
* `POST /claims/{claim_id}/decision` still exists and writes the verdict
  directly, without the agent. Both paths are live: the dashboard's report
  drawer uses the deterministic one, the analysis modal uses this one.
"""

import logging
from collections.abc import AsyncIterator

from core.exceptions import NotFoundError, ValidationError
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

# The closing turn of the same conversation. Sent on the assessment's session id,
# so the agent still holds the analysis it produced and does not have to be told
# what it found — only what the human concluded and what to do about it.
#
# This is the one instruction in the app that asks the agent to *write*. The
# assessment above explicitly forbids it; here the human has committed, so there
# is something worth persisting. Both live in this module so the pair can be read
# together.
DECISION_INSTRUCTION = """The human reviewer has made a decision on claim {claim_id}.

Decision: {decision}
Reviewer: {reviewed_by}
{reason_line}
Now close the case. Do all of the following, in order:
1. Record the decision on the claim document, setting every one of these fields:
   - fraud.fraudFlag: {fraud_flag}
   - fraud.processed: true
   - fraud.flagSource: "HUMAN"
   - fraud.reviewedBy: "{reviewed_by}"
   - fraud.reviewedAt: the current timestamp
   - fraud.processedAt: the current timestamp, but ONLY if the claim does not already have one. If fraud.processedAt is already set, leave it exactly as it is — it records when the claim entered the review queue, and overwriting it would erase how long the claim waited.
   - fraud.computedScore and fraud.rawScore: the score you computed in this assessment
   - fraud.matchedPatterns: the patterns you matched, each with its patternId, name and weight
   fraud.processed must be true even though the score was not saved earlier in this
   conversation — every read of this claim treats processed=false as "never analysed" and
   would hide the decision you are recording.{reason_step}
2. Write the audit-trail record for this review: the claim id, the score you computed, the patterns that matched, the decision, the reviewer, and a concise summary of how you reached your recommendation.
3. Close the case.

Then reply with a short confirmation of exactly what you wrote and where — name each collection and field you changed, so the reviewer can verify it. If any write fails, say so plainly and state which parts did not persist; do not report success for a write that did not happen."""


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

    def _build_decision_message(
        self,
        claim_id: str,
        decision: str,
        reviewed_by: str,
        dismiss_reason: str | None,
        siu_referred: bool,
    ) -> str:
        reason_line = f"Reason given: {dismiss_reason}\n" if dismiss_reason else ""
        if siu_referred:
            reason_line += "This claim is being referred to the SIU.\n"

        # The reason is a required part of the record for a dismissal, so the
        # instruction names it as a step rather than leaving the agent to infer
        # that it matters.
        reason_step = (
            f" Store the reviewer's reason verbatim: \"{dismiss_reason}\"."
            if dismiss_reason
            else ""
        )

        return DECISION_INSTRUCTION.format(
            claim_id=claim_id,
            decision=decision,
            # Spelled out rather than left to the agent to infer from the verdict
            # name: fraudFlag is a boolean and "DISMISSED" -> false is exactly
            # the kind of mapping a model gets backwards under load.
            fraud_flag="true" if decision == "CONFIRMED_FRAUD" else "false",
            reviewed_by=reviewed_by,
            reason_line=reason_line,
            reason_step=reason_step,
        )

    async def stream_decision(
        self,
        claim_id: str,
        decision: str,
        reviewed_by: str,
        session_id: str,
        dismiss_reason: str | None = None,
        siu_referred: bool = False,
        user_id: str | None = None,
    ) -> tuple[AsyncIterator[bytes], str, str | None]:
        """Hand the reviewer's verdict to the agent that ran the assessment.

        `session_id` is required, not optional: the point of this call is that
        the agent still has the analysis in context. Starting a new conversation
        would ask it to record findings it never made.

        A dismissal without a reason is refused here for the same reason the REST
        decision endpoint refuses it — the reason IS the record.
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
