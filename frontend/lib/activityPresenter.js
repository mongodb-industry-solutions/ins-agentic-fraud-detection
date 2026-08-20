import { STATUS, toRelativeTime, toScoreLabel } from "./claimsPresenter";

/**
 * Activity events -> renderable sentence fragments.
 *
 * The feed mixes plain copy with two things that must keep their own styling
 * inside the sentence: claim ids (mono, all-caps) and fraud scores (Lavender
 * chip). Rather than let the component parse strings, the presenter emits an
 * ordered list of typed fragments the component maps straight to elements.
 */
const text = (value) => ({ type: "text", value });
const mono = (value) => ({ type: "mono", value });
const score = (value) => ({ type: "score", value });

function toFragments(event) {
  const scoreLabel = toScoreLabel(event.computedScore);

  switch (event.type) {
    case "AGENT_SCORED":
      return {
        statusKey: STATUS.PENDING,
        icon: "sparkle",
        parts: [
          text("Agent scored "),
          mono(event.claimId),
          text(" at "),
          score(scoreLabel),
          text(" — sent for review"),
        ],
      };
    case "FRAUD_CONFIRMED":
      return {
        statusKey: STATUS.FLAGGED,
        icon: "alert",
        parts: [
          text(`${event.reviewedBy || "Reviewer"} confirmed fraud on `),
          mono(event.claimId),
          ...(scoreLabel ? [text(" scored "), score(scoreLabel)] : []),
        ],
      };
    // case "BATCH_CLEARED":
    //   return {
    //     statusKey: STATUS.CLEARED,
    //     icon: "check",
    //     parts: [text(`Batch of ${event.batchSize ?? 0} claims cleared — no fraud indicators`)],
    //   };
    default:
      return {
        statusKey: STATUS.UNPROCESSED,
        icon: "file",
        parts: [text("New claim "), mono(event.claimId), text(" opened, awaiting analysis")],
      };
  }
}

export function toActivityFeed(response) {
  return (response?.events || []).map((event, index) => ({
    id: `${event.type}-${event.claimId || index}`,
    timestamp: toRelativeTime(event.timestamp),
    ...toFragments(event),
  }));
}
