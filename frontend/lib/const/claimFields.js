/**
 * The ten fields backend/schemas/claims.py ClaimUpdateRequest accepts, with the
 * input type each one needs. Anything absent from this map is not editable —
 * notably everything under `fraud`, which is the agent's output, plus the
 * identity fields (claimId/customerId/policyId) the service rejects outright.
 *
 * The types matter: the backend is typed, so a checkbox field must PATCH a real
 * boolean and a count must PATCH a number, not the string an input produces.
 */
export const EDITABLE_FIELDS = {
  claimStatus: "select",
  repairShop: "text",
  adjusterId: "text",
  paymentMethod: "select",
  channel: "select",
  paidAmount: "number",
  policeReport: "boolean",
  witnessCount: "number",
  description: "textarea",
  escalated: "boolean",
};

/* Option sets observed in the live data. These are not enums in the backend
   schema (the fields are plain strings), so an unrecognised stored value is
   added to its own list rather than being silently dropped from the dropdown. */
export const PAYMENT_METHODS = ["ACH", "AUTO_EFT", "CHECK", "CREDIT_CARD"];
export const CHANNELS = ["MOBILE_APP", "AGENT_PORTAL", "BROKER", "PHONE"];
export const CLAIM_STATUSES = ["OPEN", "CLOSED", "CLOSED_DENIED"];

/** Coerces the string-shaped drafts into the types the backend expects. */
export function toUpdatePayload(drafts) {
  const payload = {};

  Object.entries(drafts).forEach(([field, value]) => {
    switch (EDITABLE_FIELDS[field]) {
      case "boolean":
        payload[field] = typeof value === "boolean" ? value : value === "true";
        break;
      case "number": {
        const parsed = Number(value);
        // A blank or unparseable number is dropped rather than sent as NaN or
        // silently written as 0.
        if (value !== "" && Number.isFinite(parsed)) payload[field] = parsed;
        break;
      }
      default:
        payload[field] = value;
    }
  });

  return payload;
}
