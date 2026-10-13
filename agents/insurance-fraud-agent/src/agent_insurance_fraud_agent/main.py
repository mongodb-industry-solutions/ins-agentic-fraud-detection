"""
Insurance Fraud Agent built on the Magenta SDK.

This app demonstrates:
- @app.tool for structured tool registration
- agent.yaml-driven runtime features and model hints
- MongoDB-backed fraud data model (customers, policies, claims, fraud_patterns,
  decision_traces)
- Two-track fraud detection: deterministic RULE patterns + Atlas Vector Search
  over HISTORICAL_SIMILARITY patterns
- LangGraph orchestration with human review via suspend/resume, and a feedback
  loop that updates pattern statistics on each confirm/dismiss

The platform launches this code in supported runtime roles:
    RUNNER_MODE=aer            -> Full LangGraph execution
    RUNNER_MODE=tool           -> Tool function execution
    RUNNER_MODE=memory-server  -> Long-term memory service
"""

import json
import logging
import os
import sys
import uuid
from datetime import UTC, datetime
from typing import Annotated, Any, Literal, TypedDict, cast

from agent_engine_sdk_langgraph import App
from dotenv import load_dotenv
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import BaseMessage, SystemMessage
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import ToolNode

from agent_insurance_fraud_agent.embeddings.voyage import get_embedding
from agent_insurance_fraud_agent.store import (
    Claim,
    DecisionTrace,
    create_store_registry,
)

# =============================================================================
# Logging
# =============================================================================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)
load_dotenv()

# =============================================================================
# Configuration
# =============================================================================
MONGODB_URI = os.environ.get("MONGODB_URI", "")
MONGODB_DATABASE = os.environ.get("MONGODB_DATABASE", "insurance_fraud_agent")

MODEL = os.environ.get("MODEL", "claude-opus-4-6")
PROVIDER = os.environ.get("PROVIDER", "anthropic")

# Fraud scoring is agent-computed: the score is the sum of the integer `weight` of
# every active fraud_pattern that matches a claim, capped at 12. `complexity` is an
# independent triage dimension loaded with the claim — it is NOT derived from the score.
SCORE_CAP = 12  # computedScore = min(rawScore, SCORE_CAP)
FAST_TRACK_MAX = 3  # 0-3  -> low-risk / fast-track
REVIEW_MIN = 4  # 4-8  -> elevated / needs review (review-queue default cutoff)
PRIORITY_MIN = 9  # 9-12 -> priority review

# Similarity track: a HISTORICAL_SIMILARITY pattern counts as "identified" in a claim only
# when its cosine similarity to the claim text is at least this threshold (0-1). Tunable via
# env so it can be calibrated against each pattern's exampleClaimIds (see Step 7 / scripts).
SIMILARITY_THRESHOLD = float(os.environ.get("FRAUD_SIMILARITY_THRESHOLD", "0.70"))

# =============================================================================
# App init
# =============================================================================
APP_NAME = "Insurance Fraud Agent"

app = App(app_name=APP_NAME)
logger.info("✅ App created")

store_registry = create_store_registry(MONGODB_URI, MONGODB_DATABASE, seed=True)


# =============================================================================
# Internal helpers (not tools)
# =============================================================================


def _require_store():
    """Return the store registry or raise a clear error for tool wrappers."""
    if store_registry is None:
        raise RuntimeError(
            "Store registry is unavailable. Set MONGODB_URI and ensure MongoDB is reachable."
        )
    return store_registry


def _embed_text(text: str) -> list[float] | None:
    """Embed claim text as a search *query* via the Voyage package (embeddings/voyage).

    Uses input_type="query" so the vector lands in the same space as the stored patterns,
    which were embedded as "document". Returns None when Voyage is unavailable so the
    similarity track degrades gracefully.
    """
    if not os.environ.get("VOYAGE_API_KEY"):
        logger.warning("VOYAGE_API_KEY not set — similarity search unavailable.")
        return None
    return get_embedding(text, input_type="query")


def _embed_document(text: str) -> list[float] | None:
    """Embed claim text as a stored *document* via the Voyage package (embeddings/voyage).

    Used when a claim is created/updated so it joins the searchable historical corpus. Uses
    input_type="document" to match how the corpus is stored. Returns None when Voyage or the
    text is unavailable, so the claim is simply written without an embedding.
    """
    if not text or not os.environ.get("VOYAGE_API_KEY"):
        return None
    return get_embedding(text, input_type="document")


def _get_path(doc: dict, path: str) -> Any:
    """Read a dotted field path (e.g. 'policySnapshot.startDate') from a document."""
    cur: Any = doc
    for part in path.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def _to_date(value: Any) -> datetime | None:
    """Coerce a datetime or ISO string into a datetime (UTC-naive tolerant)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            try:
                return datetime.fromisoformat(value[:10])
            except ValueError:
                return None
    return None


def _days_between(a: Any, b: Any) -> int | None:
    da, db = _to_date(a), _to_date(b)
    if da is None or db is None:
        return None
    if da.tzinfo and not db.tzinfo:
        db = db.replace(tzinfo=UTC)
    if db.tzinfo and not da.tzinfo:
        da = da.replace(tzinfo=UTC)
    return (da - db).days


def _time_in_overnight_window(t: str, start: str, end: str) -> bool:
    """True if HH:MM time `t` falls inside a window that may wrap midnight."""

    def mins(s: str) -> int:
        h, m = s.split(":")
        return int(h) * 60 + int(m)

    try:
        tm, sm, em = mins(t), mins(start), mins(end)
    except (ValueError, AttributeError):
        return False
    if sm <= em:
        return sm <= tm <= em
    return tm >= sm or tm <= em  # window wraps past midnight


def _eval_single(
    claim: dict,
    field: str | None,
    operator: str | None,
    value: Any,
    comparison_field: str | None = None,
) -> tuple[bool, str]:
    """Evaluate one comparison operator against claim fields. Returns (fired, detail).

    Supports every operator present in the seed fraud_patterns. A couple are
    documented heuristics: IS_ROUND_NUMBER treats a positive multiple of 1000 as
    'suspiciously round'; RATIO_ABOVE_VALUE divides the field by vehicleSnapshot.value.
    """
    left = _get_path(claim, field) if field else None

    if operator in ("DAYS_BETWEEN_LESS_THAN", "DAYS_BETWEEN_GREATER_THAN"):
        right = _get_path(claim, comparison_field) if comparison_field else None
        days = _days_between(left, right)
        if days is None:
            return False, f"missing date field(s) for {field}/{comparison_field}"
        if operator == "DAYS_BETWEEN_LESS_THAN":
            return days < value, f"{days}d between {field} and {comparison_field} (< {value})"
        return days > value, f"{days}d between {field} and {comparison_field} (> {value})"

    if operator == "IS_ROUND_NUMBER":
        if not isinstance(left, (int, float)):
            return False, f"{field} not numeric"
        is_round = left > 0 and left % 1000 == 0
        return is_round, (
            f"{field}={left} is a round multiple of 1000"
            if is_round
            else f"{field}={left} is not round"
        )

    if operator in ("RATIO_ABOVE", "RATIO_ABOVE_VALUE"):
        den_field = comparison_field if operator == "RATIO_ABOVE" else "vehicleSnapshot.value"
        den = _get_path(claim, den_field) if den_field else None
        if not isinstance(left, (int, float)) or not isinstance(den, (int, float)) or den == 0:
            return False, f"ratio {field}/{den_field} not computable"
        ratio = left / den
        return ratio > value, f"{field}/{den_field} = {round(ratio, 2)} (> {value})"

    if operator == "BETWEEN_OVERNIGHT":
        if not isinstance(left, str):
            return False, f"{field} missing"
        window = value if isinstance(value, list) and len(value) == 2 else ["22:00", "05:00"]
        inside = _time_in_overnight_window(left, window[0], window[1])
        return inside, (
            f"{field}={left} within overnight {window[0]}-{window[1]}"
            if inside
            else f"{field}={left} outside overnight window"
        )

    if left is None:
        return False, f"field '{field}' missing"

    if operator in ("IN", "NOT_IN"):
        if not isinstance(value, list):
            return False, f"{operator} needs a list value"
        inside = left in value
        if operator == "IN":
            return inside, f"{field}={left} {'in' if inside else 'not in'} {value}"
        return not inside, f"{field}={left} {'in' if inside else 'not in'} {value}"

    # Field-to-field comparison: with no literal `value`, compare against
    # `comparisonField` (e.g. FP-004: claimAmount > vehicleSnapshot.value).
    target, target_label = value, value
    if value is None and comparison_field:
        target = _get_path(claim, comparison_field)
        target_label = f"{comparison_field}={target}"
        if target is None:
            return False, f"field '{comparison_field}' missing"
    if target is None and operator not in ("EQUALS", "NOT_EQUALS"):
        return False, f"rule has no value to compare {field} against"

    comparisons = {
        "GREATER_THAN": (lambda a, b: a > b, ">"),
        "GREATER_THAN_OR_EQUAL": (lambda a, b: a >= b, ">="),
        "LESS_THAN": (lambda a, b: a < b, "<"),
        "LESS_THAN_OR_EQUAL": (lambda a, b: a <= b, "<="),
        "EQUALS": (lambda a, b: a == b, "=="),
        "NOT_EQUALS": (lambda a, b: a != b, "!="),
    }
    if operator not in comparisons:
        return False, f"unsupported operator {operator}"
    compare, symbol = comparisons[operator]
    try:
        return compare(left, target), f"{field}={left} {symbol} {target_label}"
    except TypeError:
        return False, f"cannot compare {field}={left!r} {symbol} {target_label!r}"


def _applies_to(claim: dict, pattern: dict) -> bool:
    """Applicability gate: claimType AND coverageType must fall within appliesTo."""
    applies = pattern.get("appliesTo") or {}
    claim_types = applies.get("claimTypes")
    coverage_types = applies.get("coverageTypes")
    if claim_types and claim.get("claimType") not in claim_types:
        return False
    if coverage_types and claim.get("coverageType") not in coverage_types:
        return False
    return True


def _rule_fires(claim: dict, pattern: dict) -> tuple[bool, str]:
    """Evaluate one RULE pattern against a claim (applicability + rule logic)."""
    if not _applies_to(claim, pattern):
        return False, "out of scope for this claim/coverage type"
    logic = pattern.get("ruleLogic") or {}
    ok, detail = _eval_single(
        claim,
        logic.get("field"),
        logic.get("operator"),
        logic.get("value"),
        logic.get("comparisonField"),
    )
    if not ok:
        return False, detail
    secondary_op = logic.get("secondaryOperator")
    if secondary_op:
        ok2, detail2 = _eval_single(
            claim,
            logic.get("comparisonField"),
            secondary_op,
            logic.get("value2"),
        )
        if not ok2:
            return False, f"{detail}; secondary not met ({detail2})"
        return True, f"{detail}; {detail2}"
    return True, detail


def _matched_pattern(pattern: dict, detail: str) -> dict:
    """Shape a matched pattern for matchedPatterns / trace steps."""
    return {
        "patternId": pattern.get("patternId"),
        "patternName": pattern.get("name"),
        "patternType": pattern.get("patternType"),
        "severity": pattern.get("severity"),
        "weight": int(pattern.get("weight", 0) or 0),
        "detail": detail,
    }


def _evaluate_rules(claim: dict) -> list[dict]:
    """Run all active RULE patterns against a claim; return the ones that fired."""
    store = _require_store()
    fired: list[dict] = []
    for pattern in store.fraud_patterns.list_active_rules():
        # One malformed rule must not abort the whole assessment: it is logged
        # and treated as not fired.
        try:
            ok, detail = _rule_fires(claim, pattern)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Rule %s could not be evaluated on %s: %s",
                pattern.get("patternId"),
                claim.get("claimId"),
                exc,
            )
            continue
        if ok:
            fired.append(_matched_pattern(pattern, detail))
    return fired


def _claim_narrative(claim: dict) -> str:
    """Text used for the vector-similarity query.

    Prefer the claim's free-text `description` (prose, which matches the patterns'
    embeddingText best); fall back to a narrative synthesized from structured fields when
    the claim carries no description.
    """
    description = (claim.get("description") or "").strip()
    if description:
        return description
    loc = claim.get("accidentLocation") or {}
    parts = [
        f"{claim.get('claimType', '')} claim",
        f"coverage {claim.get('coverageType', '')}",
        f"amount ${claim.get('claimAmount', 0)}",
        f"{claim.get('witnessCount', 0)} witnesses",
        "police report filed" if claim.get("policeReport") else "no police report",
        f"reported after {claim.get('delayDays', 0)} day delay",
        f"in {loc.get('city', '')} {loc.get('state', '')}".strip(),
    ]
    return ", ".join(p for p in parts if p)


def _similar_by_examples(claim: dict) -> list[dict]:
    """Fallback similarity track: a HISTORICAL_SIMILARITY pattern matches when this claim's
    ID is in its curated `exampleClaimIds`, subject to the same appliesTo gate. Used only when
    Voyage embeddings are unavailable — the primary path is `_similar_by_vector` (Atlas Vector
    Search over the claim description).
    """
    store = _require_store()
    claim_id = claim.get("claimId")
    matches: list[dict] = []
    for pattern in store.fraud_patterns.list_active():
        if pattern.get("patternType") != "HISTORICAL_SIMILARITY":
            continue
        if not _applies_to(claim, pattern):
            continue
        if claim_id in (pattern.get("exampleClaimIds") or []):
            matches.append(
                _matched_pattern(pattern, f"matches curated example set of '{pattern.get('name')}'")
            )
    return matches


def _similar_by_vector(claim: dict, k: int = 5) -> list[dict] | None:
    """Production similarity track: Atlas-vector-search the HISTORICAL_SIMILARITY patterns
    using the claim's embedding. A pattern is treated as "identified" in the claim only when
    it passes the same `appliesTo` gate as the other tracks AND its cosine similarity is at
    least SIMILARITY_THRESHOLD — a strong match means the pattern applies and contributes its
    weight to the score.

    Reuses the claim's stored `embedding` (already in the same voyage-3.5 space as the
    patterns), so a claim that is already embedded needs no Voyage call here. Only embeds the
    narrative on the fly for a claim that has none yet. Returns the matched patterns (possibly
    empty), or None when no embedding is available at all (unembedded claim + no VOYAGE_API_KEY
    / Voyage error) so callers can fall back to the example-ID track.
    """
    store = _require_store()
    embedding = claim.get("embedding")
    if not embedding:
        embedding = _embed_text(_claim_narrative(claim))
    if not embedding:
        return None
    out: list[dict] = []
    for m in store.fraud_patterns.vector_search(embedding, k=k):
        similarity = round(float(m.get("similarity", 0.0)), 4)
        if similarity < SIMILARITY_THRESHOLD:
            continue  # too weak — not enough to say the pattern applies
        if not _applies_to(claim, m):
            continue  # right vector space, wrong claim/coverage type
        entry = _matched_pattern(
            m, f"vector similarity {similarity} ≥ {SIMILARITY_THRESHOLD} threshold"
        )
        entry["similarity"] = similarity
        out.append(entry)
    return out


def _similar_patterns(claim: dict) -> list[dict]:
    """HISTORICAL_SIMILARITY matches for a claim, preferring Atlas Vector Search.

    Uses the vector track when embeddings are available; falls back to the curated
    `exampleClaimIds` track only when Voyage is unavailable (so the flow still works with no
    VOYAGE_API_KEY). A successful vector search that finds nothing above threshold is a
    genuine "no match" and is NOT overridden by the example track.
    """
    vector_matches = _similar_by_vector(claim)
    if vector_matches is not None:
        return vector_matches
    return _similar_by_examples(claim)


def _similar_claim_entry(m: dict, similarity: Any) -> dict:
    fraud = m.get("fraud") or {}
    return {
        "claimId": m.get("claimId"),
        "similarity": round(float(similarity), 4) if similarity is not None else None,
        "claimType": m.get("claimType"),
        "coverageType": m.get("coverageType"),
        "claimAmount": m.get("claimAmount"),
        "claimStatus": m.get("claimStatus"),
        "description": m.get("description"),
        "fraudFlag": fraud.get("fraudFlag"),
        "computedScore": fraud.get("computedScore"),
        "reviewedBy": fraud.get("reviewedBy"),
        "siuReferred": fraud.get("siuReferred"),
    }


def _similar_claims(
    store, claim: dict, k: int = 5, all_claim_types: bool = False
) -> tuple[list[dict], str, str | None]:
    """Claim-to-claim vector search shared by find_similar_claims and assess_claim_fraud.

    Returns (similar claims, embedding source, error). Prefers the claim's own stored
    embedding: it is already in the same (document) space as the corpus, so no Voyage
    call is needed. Only embeds the narrative on the fly when the claim has none yet
    (e.g. a brand-new claim written before its embedding was backfilled).
    """
    embedding = claim.get("embedding")
    embedding_source = "stored"
    if not embedding:
        embedding = _embed_text(_claim_narrative(claim))
        embedding_source = "computed"
    if not embedding:
        return (
            [],
            embedding_source,
            "Similarity search unavailable: claim has no stored embedding and an embedding "
            "could not be computed (check VOYAGE_API_KEY / VOYAGE_MODEL in the tool runtime "
            "and the logs for 'Error in get_embedding').",
        )
    matches = store.claims.vector_search(
        embedding,
        k=k,
        exclude_claim_id=claim.get("claimId"),
        claim_type=None if all_claim_types else claim.get("claimType"),
        adjudicated_only=True,
    )
    results = [_similar_claim_entry(m, m.get("similarity", 0.0)) for m in matches]
    return results, embedding_source, None


def _linked_claims(store, claim: dict, similar_claim_ids: str) -> list[dict]:
    """The similar claims persisted on an assessed claim, for later analytics.

    Uses the claim IDs the agent cited in its assessment (comma-separated). Each is
    enriched with its vector similarity when it appears in the search results, or
    looked up directly otherwise (similarity null). When the agent cites none, the top
    vector-search neighbours are stored so every assessment still carries precedent.
    """
    found, _, _ = _similar_claims(store, claim, k=10, all_claim_types=True)
    by_id = {c["claimId"]: c for c in found}
    cited = [c.strip() for c in (similar_claim_ids or "").split(",") if c.strip()]
    cited = [c for c in dict.fromkeys(cited) if c != claim.get("claimId")]
    if cited:
        linked = []
        for cid in cited:
            entry = by_id.get(cid)
            if entry is None:
                doc = store.claims.read(cid)
                if not doc:
                    continue
                entry = _similar_claim_entry(doc, None)
            linked.append({**entry, "citedByAgent": True})
    else:
        same_type = [c for c in found if c.get("claimType") == claim.get("claimType")]
        linked = [{**c, "citedByAgent": False} for c in (same_type or found)[:5]]
    # Keep the persisted record lean: the narrative lives on the linked claim itself.
    for entry in linked:
        entry.pop("description", None)
    return linked


def _score_band(score: int) -> str:
    """Map a 0-12 computedScore to its triage band."""
    if score <= FAST_TRACK_MAX:
        return "FAST_TRACK"
    if score < PRIORITY_MIN:
        return "REVIEW"
    return "PRIORITY"


def _decision_label(decision: str) -> str | None:
    """Normalise a human verdict onto the canonical trace vocabulary.

    Accepts the shorthand the analyst/LLM tends to use (CONFIRMED, FRAUD, NOT_FRAUD, ...)
    and returns CONFIRMED_FRAUD / DISMISSED, or None if it is not a recognised verdict.
    """
    value = (decision or "").strip().upper().replace(" ", "_").replace("-", "_")
    if value in ("CONFIRMED", "CONFIRMED_FRAUD", "FRAUD", "CONFIRM"):
        return "CONFIRMED_FRAUD"
    if value in ("DISMISSED", "DISMISS", "NOT_FRAUD", "NO_FRAUD", "CLEARED"):
        return "DISMISSED"
    return None


# =============================================================================
# Tools — Customers (read-only source of truth)
# =============================================================================


@app.tool()
def lookup_customer(customer_id: str) -> str:
    """Look up a customer (policyholder) by their customer ID.

    Args:
        customer_id: Customer ID (e.g. "CUST-2024-00183741")
    """
    try:
        doc = _require_store().customers.read(customer_id)
        if doc:
            return json.dumps(doc, indent=2, default=str)
        return json.dumps({"error": f"No customer found: {customer_id}"})
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def find_customers_by_name(first_name: str = "", last_name: str = "") -> str:
    """Find customers by first and/or last name (case-insensitive).

    Args:
        first_name: First name to match (optional)
        last_name:  Last name to match (optional)
    """
    try:
        docs = _require_store().customers.list_by_name(first_name, last_name)
        return json.dumps({"count": len(docs), "customers": docs}, indent=2, default=str)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def list_all_customers() -> str:
    """List every customer in the system, sorted by customer ID."""
    try:
        docs = _require_store().customers.list_all()
        return json.dumps({"count": len(docs), "customers": docs}, indent=2, default=str)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def list_customers(region: str = "", state: str = "") -> str:
    """List customers filtered by region and/or state.

    Args:
        region: Region code (e.g. "MIDWEST")
        state:  Two-letter state code (e.g. "IL")
    """
    try:
        docs = _require_store().customers.list_filtered(region, state)
        return json.dumps({"count": len(docs), "customers": docs}, indent=2, default=str)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def get_customer_profile(customer_id: str) -> str:
    """Get a full customer profile: the customer plus their policies and claims.

    Aggregates the customer record with all of their policies and every claim
    (including current fraud status) for a single profile view.

    Args:
        customer_id: Customer ID (e.g. "CUST-2024-00183741")
    """
    try:
        store = _require_store()
        customer = store.customers.read(customer_id)
        if not customer:
            return json.dumps({"error": f"No customer found: {customer_id}"})
        policies = store.policies.list_by_customer(customer_id)
        claims = store.claims.list_by_customer(customer_id)
        return json.dumps(
            {
                "customer": customer,
                "policyCount": len(policies),
                "policies": policies,
                "claimCount": len(claims),
                "claims": claims,
            },
            indent=2,
            default=str,
        )
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


# =============================================================================
# Tools — Policies (read-only source of truth)
# =============================================================================


@app.tool()
def lookup_policy(policy_id: str) -> str:
    """Look up an insurance policy by its policy ID.

    Args:
        policy_id: Policy ID (e.g. "PAP-IL-2024-0093821")
    """
    try:
        doc = _require_store().policies.read(policy_id)
        if doc:
            return json.dumps(doc, indent=2, default=str)
        return json.dumps({"error": f"No policy found: {policy_id}"})
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def list_all_policies() -> str:
    """List every policy in the system, sorted by policy ID."""
    try:
        docs = _require_store().policies.list_all()
        return json.dumps({"count": len(docs), "policies": docs}, indent=2, default=str)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def list_policies_by_customer(customer_id: str) -> str:
    """List all policies belonging to a customer.

    Args:
        customer_id: Customer ID (e.g. "CUST-2024-00183741")
    """
    try:
        docs = _require_store().policies.list_by_customer(customer_id)
        return json.dumps({"count": len(docs), "policies": docs}, indent=2, default=str)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def list_policies_by_status(status: str) -> str:
    """List policies filtered by status.

    Args:
        status: Policy status — ACTIVE, CANCELLED, EXPIRED, PENDING, NON_RENEWED
    """
    try:
        docs = _require_store().policies.list_by_status(status)
        return json.dumps({"count": len(docs), "policies": docs}, indent=2, default=str)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


# =============================================================================
# Tools — Claims (the agent's unit of work)
# =============================================================================


@app.tool()
def lookup_claim(claim_id: str) -> str:
    """Look up a claim by its claim ID, including all snapshots and its fraud block.

    Args:
        claim_id: Claim ID (e.g. "CLM-IL-2024-0047821")
    """
    try:
        doc = _require_store().claims.read(claim_id)
        if doc:
            return json.dumps(doc, indent=2, default=str)
        return json.dumps({"error": f"No claim found: {claim_id}"})
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def list_all_claims() -> str:
    """List every claim in the system, sorted by claim ID."""
    try:
        docs = _require_store().claims.list_all()
        return json.dumps({"count": len(docs), "claims": docs}, indent=2, default=str)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def list_claims(status: str = "", complexity: str = "") -> str:
    """List claims filtered by status and/or complexity.

    Args:
        status:     Claim status — OPEN, CLOSED, PENDING_INVESTIGATION, DENIED
        complexity: SIMPLE or COMPLEX
    """
    try:
        docs = _require_store().claims.list_filtered(status, complexity)
        return json.dumps({"count": len(docs), "claims": docs}, indent=2, default=str)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def list_claims_by_policy(policy_id: str) -> str:
    """List all claims associated with a policy.

    Args:
        policy_id: Policy ID (e.g. "PAP-IL-2024-0093821")
    """
    try:
        docs = _require_store().claims.list_by_policy(policy_id)
        return json.dumps({"count": len(docs), "claims": docs}, indent=2, default=str)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def list_review_queue(min_score: int = REVIEW_MIN, unreviewed_only: bool = True) -> str:
    """List claims that need analyst attention: computed fraud score at/above a threshold.

    Scores are on the 0-12 scale (0-3 fast-track, 4-8 review, 9-12 priority), so the
    default surfaces everything above the fast-track band.

    Args:
        min_score:       Minimum computedScore to include (default 4)
        unreviewed_only: Only claims not yet confirmed/dismissed (default True)
    """
    try:
        docs = _require_store().claims.list_review_queue(min_score, unreviewed_only)
        return json.dumps({"count": len(docs), "claims": docs}, indent=2, default=str)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def open_claim(
    claim_id: str,
    policy_id: str,
    customer_id: str,
    claim_type: str,
    coverage_type: str,
    claim_amount: float,
    claim_date: str,
    report_date: str = "",
    description: str = "",
) -> str:
    """Open (create) a new claim.

    Snapshots (driver/vehicle/customer/policy) are normally populated by the
    nightly batch; this tool creates the base claim record for intake.

    Args:
        claim_id:      Unique claim ID (e.g. "CLM-IL-2025-0099001")
        policy_id:     Associated policy ID
        customer_id:   Owning customer ID
        claim_type:    e.g. AUTO_COLLISION, AUTO_THEFT
        coverage_type: e.g. COLLISION, COMPREHENSIVE
        claim_amount:  Claimed amount in USD
        claim_date:    Date/time of loss (ISO, e.g. "2025-04-15T14:32:00Z")
        report_date:   Date/time reported (ISO); defaults to now
        description:   Free-text loss narrative. Embedded so the claim joins the historical
                       corpus for claim-to-claim similarity (find_similar_claims).
    """
    try:
        now = datetime.now(UTC)
        cdate = datetime.fromisoformat(claim_date.replace("Z", "+00:00"))
        rdate = datetime.fromisoformat(report_date.replace("Z", "+00:00")) if report_date else now
        desc = description.strip() or None
        claim = Claim(
            claimId=claim_id,
            policyId=policy_id,
            customerId=customer_id,
            claimType=claim_type,
            coverageType=coverage_type,
            claimAmount=claim_amount,
            claimDate=cdate,
            reportDate=rdate,
            delayDays=max(0, (rdate - cdate).days),
            claimStatus="OPEN",
            description=desc,
            embedding=_embed_document(desc) if desc else None,
            createdAt=now,
            updatedAt=now,
        )
        created = _require_store().claims.write(claim)
        created.pop("embedding", None)  # keep the raw vector out of the tool output
        return json.dumps({"status": "created", "claim": created}, indent=2, default=str)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def update_claim(claim_id: str, updates_json: str) -> str:
    """Partially update a claim using dot-notation field paths.

    Args:
        claim_id:     Claim ID to update (e.g. "CLM-IL-2024-0047821")
        updates_json: JSON object of field paths -> new values
                      (e.g. '{"claimStatus": "CLOSED", "paidAmount": 9800}')
                      Fraud fields (`fraud` / `fraud.*`) are rejected: they are written
                      only by `assess_claim_fraud` and `record_fraud_decision`.
    """
    try:
        updates = json.loads(updates_json)
        fraud_keys = sorted(k for k in updates if k == "fraud" or k.startswith("fraud."))
        if fraud_keys:
            # Hand-written fraud state would skip the decision trace and pattern stats.
            return json.dumps(
                {
                    "error": "Fraud fields cannot be set with update_claim: "
                    f"{fraud_keys}. Use assess_claim_fraud (score, patterns, similar "
                    "claims) or record_fraud_decision (verdict). If one of those tools "
                    "fails, report the error to the human instead of working around it."
                }
            )
        # If the loss narrative changes, re-embed it so the claim's vector stays in sync.
        new_desc = updates.get("description")
        if isinstance(new_desc, str) and new_desc.strip():
            vector = _embed_document(new_desc.strip())
            if vector is not None:
                updates["embedding"] = vector
        result = _require_store().claims.update(claim_id, updates)
        if result:
            result.pop("embedding", None)  # keep the raw vector out of the tool output
            return json.dumps({"status": "updated", "claim": result}, indent=2, default=str)
        return json.dumps({"error": f"No claim found: {claim_id}"})
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def find_similar_claims(claim_id: str, k: int = 5, all_claim_types: bool = False) -> str:
    """Find historical claims that resemble a given claim (claim-to-claim similarity).

    Embeds the claim's description and vector-searches the historical claims corpus — closed
    or already-adjudicated claims — excluding the claim itself. By default only claims of the
    SAME claimType are returned; set all_claim_types=True to search across types. Results are
    ranked by cosine similarity (higher = more alike) and carry each match's fraud outcome, so
    confirmed-fraud precedents stand out. Read-only evidence for a report — it does NOT change
    any fraud score.

    Args:
        claim_id:        Claim to find neighbours for (e.g. "CLM-IL-2024-0047821")
        k:               How many similar claims to return (default 5)
        all_claim_types: Search across all claim types instead of just the same one (default False)
    """
    try:
        store = _require_store()
        claim = store.claims.read(claim_id)
        if not claim:
            return json.dumps({"error": f"No claim found: {claim_id}"})

        results, embedding_source, error = _similar_claims(store, claim, k, all_claim_types)
        if error:
            return json.dumps({"claimId": claim_id, "error": error})
        return json.dumps(
            {
                "claimId": claim_id,
                "claimType": claim.get("claimType"),
                "searchedAcrossAllTypes": all_claim_types,
                "embeddingSource": embedding_source,  # "stored" (no Voyage call) | "computed"
                "matchCount": len(results),
                "similarClaims": results,
            },
            indent=2,
            default=str,
        )
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


# =============================================================================
# Tools — Fraud patterns
# =============================================================================


@app.tool()
def lookup_fraud_pattern(pattern_id: str) -> str:
    """Look up a fraud pattern by its pattern ID.

    Args:
        pattern_id: Pattern ID (e.g. "FP-001")
    """
    try:
        doc = _require_store().fraud_patterns.read(pattern_id)
        if doc:
            doc.pop("embedding", None)  # drop the raw vector from output
            return json.dumps(doc, indent=2, default=str)
        return json.dumps({"error": f"No fraud pattern found: {pattern_id}"})
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def list_all_fraud_patterns() -> str:
    """List every fraud pattern (RULE and HISTORICAL_SIMILARITY), with stats."""
    try:
        docs = _require_store().fraud_patterns.list_all()
        for d in docs:
            d.pop("embedding", None)
        return json.dumps({"count": len(docs), "patterns": docs}, indent=2, default=str)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def list_fraud_patterns(pattern_type: str) -> str:
    """List fraud patterns filtered by type.

    Args:
        pattern_type: RULE or HISTORICAL_SIMILARITY
    """
    try:
        docs = _require_store().fraud_patterns.list_by_type(pattern_type)
        for d in docs:
            d.pop("embedding", None)
        return json.dumps({"count": len(docs), "patterns": docs}, indent=2, default=str)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def update_fraud_pattern(pattern_id: str, updates_json: str) -> str:
    """Partially update a fraud pattern (e.g. toggle active, tune weight/severity).

    Args:
        pattern_id:   Pattern ID to update (e.g. "FP-014")
        updates_json: JSON object of field paths -> new values
                      (e.g. '{"active": false, "weight": 0.25}')
    """
    try:
        updates = json.loads(updates_json)
        result = _require_store().fraud_patterns.update(pattern_id, updates)
        if result:
            result.pop("embedding", None)
            return json.dumps({"status": "updated", "pattern": result}, indent=2, default=str)
        return json.dumps({"error": f"No fraud pattern found: {pattern_id}"})
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


# =============================================================================
# Tools — Fraud detection (core)
# =============================================================================


@app.tool()
def evaluate_claim_rules(claim_id: str) -> str:
    """Evaluate a claim against all active deterministic RULE patterns.

    Returns which rules fired, each with its integer point `weight`, severity, and a
    plain-English explanation of why. This is the explainable, deterministic track;
    each fired rule contributes its weight to the claim's computed fraud score.

    Args:
        claim_id: Claim ID (e.g. "CLM-IL-2024-0047821")
    """
    try:
        store = _require_store()
        claim = store.claims.read(claim_id)
        if not claim:
            return json.dumps({"error": f"No claim found: {claim_id}"})
        fired = _evaluate_rules(claim)
        points = sum(p["weight"] for p in fired)
        return json.dumps(
            {
                "claimId": claim_id,
                "firedRuleCount": len(fired),
                "rulePoints": points,
                "firedRules": fired,
            },
            indent=2,
            default=str,
        )
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def find_similar_fraud_patterns(claim_id: str) -> str:
    """Find historical fraud patterns that match a claim (similarity track).

    Embeds the claim's description and runs Atlas Vector Search against the
    HISTORICAL_SIMILARITY patterns. A pattern is reported as identified when it clears the
    similarity threshold AND applies to the claim's type/coverage; each such match
    contributes its integer `weight` to the computed fraud score, with its similarity score
    shown for transparency. Falls back to the curated `exampleClaimIds` track only when
    Voyage embeddings are unavailable.

    Args:
        claim_id: Claim ID (e.g. "CLM-IL-2024-0047821")
    """
    try:
        store = _require_store()
        claim = store.claims.read(claim_id)
        if not claim:
            return json.dumps({"error": f"No claim found: {claim_id}"})
        similar = _similar_patterns(claim)
        points = sum(p["weight"] for p in similar)
        return json.dumps(
            {
                "claimId": claim_id,
                "matchCount": len(similar),
                "similarityPoints": points,
                "matches": similar,
            },
            indent=2,
            default=str,
        )
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def assess_claim_fraud(
    claim_id: str,
    agent_summary: str,
    triggered_by: str,
    trigger_type: str = "SINGLE_CLAIM",
    batch_id: str = "",
    similar_claim_ids: str = "",
) -> str:
    """Compute a fraud-assessment proposal for a claim and persist it for human approval.

    Runs both tracks — deterministic RULE patterns and the HISTORICAL_SIMILARITY track —
    collects every pattern that matches, sums their integer `weight` to get `rawScore`,
    and caps it at 12 to get `computedScore`. Writes `computedScore` / `rawScore` /
    `matchedPatterns` / `similarClaims` onto the claim and marks it `processed` (so its
    fraud status reads as assessed everywhere, whatever started the assessment),
    recounts the stats of each affected pattern from the claims it matches,
    and opens ONE decision_traces document (traceId TRC-nnnn) holding the whole assessment.
    The human's verdict is later merged into that SAME trace by `record_fraud_decision` —
    it does not create a second document.

    Does NOT set `complexity` — that is an independent triage dimension loaded with the
    claim, not derived from the score.

    Args:
        claim_id:      Claim ID (e.g. "CLM-IL-2024-0047821")
        agent_summary: REQUIRED. Your own 2-4 sentence prose summary of the assessment,
                       stored as `agentSummary`. Lead with "Claim scored N/12." then state
                       the concrete evidence and which patterns matched. This is the
                       human-readable audit record — write it for an auditor reading it in
                       a year with no other context.
        triggered_by:  REQUIRED. Who initiated this assessment, as "role:id" —
                       e.g. "adjuster:ADJ-1004", "manager:MGR-2001", "batch:nightly".
        trigger_type:  SINGLE_CLAIM (default) or BATCH.
        batch_id:      Batch identifier when trigger_type is BATCH; leave empty otherwise.
        similar_claim_ids: Comma-separated IDs of the similar historical claims you cited
                       as precedent (from `find_similar_claims`, which you must call
                       BEFORE this tool), e.g. "CLM-2003,CLM-2011". Stored on the claim
                       and the trace as `similarClaims`, with each one's similarity and
                       fraud outcome. If empty, the top vector-search neighbours are stored.
    """
    try:
        store = _require_store()
        claim = store.claims.read(claim_id)
        if not claim:
            return json.dumps({"error": f"No claim found: {claim_id}"})
        if not agent_summary.strip():
            return json.dumps(
                {
                    "error": "agent_summary is required — write the prose audit summary "
                    "before calling this tool."
                }
            )
        if not triggered_by.strip():
            return json.dumps(
                {
                    "error": "triggered_by is required — pass the initiator as 'role:id', "
                    "e.g. 'adjuster:ADJ-1004'."
                }
            )

        matched = _evaluate_rules(claim) + _similar_patterns(claim)
        raw_score = sum(int(m.get("weight", 0) or 0) for m in matched)
        computed_score = min(raw_score, SCORE_CAP)
        capped = raw_score > SCORE_CAP
        band = _score_band(computed_score)

        matched_patterns = [
            {"patternId": m["patternId"], "patternName": m["patternName"], "weight": m["weight"]}
            for m in matched
        ]
        similar_claims = _linked_claims(store, claim, similar_claim_ids)
        # Patterns from a previous assessment of this claim are recounted too, so one a
        # re-assessment no longer matches drops this claim from its stats.
        previous_ids = [
            m.get("patternId") for m in ((claim.get("fraud") or {}).get("matchedPatterns") or [])
        ]

        now = datetime.now(UTC)
        trace_id = store.decision_traces.next_trace_id()
        trace = DecisionTrace(
            traceId=trace_id,
            claimId=claim_id,
            customerId=claim.get("customerId"),
            policyId=claim.get("policyId"),
            triggerType=(trigger_type or "SINGLE_CLAIM").strip().upper(),
            batchId=batch_id.strip() or None,
            triggeredBy=triggered_by.strip(),
            triggeredAt=now,
            matchedPatterns=matched_patterns,
            similarClaims=similar_claims,
            rawScore=raw_score,
            computedScore=computed_score,
            agentSummary=agent_summary.strip(),
            humanDecision=None,  # filled in by record_fraud_decision
            contextSnapshot={
                "computedScore": computed_score,
                "rawScore": raw_score,
                "band": band,
                "claimAmount": claim.get("claimAmount"),
                "complexity": claim.get("complexity"),
            },
            steps=matched,  # full per-pattern detail, incl. similarity scores
            outcome={
                "proposedScore": computed_score,
                "rawScore": raw_score,
                "band": band,
                "capApplied": capped,
            },
            createdAt=now,
        )
        written = store.decision_traces.write(trace)
        # Claim written after the trace so fraud.lastTraceId always points at a real one.
        store.claims.set_fraud_assessment(
            claim_id,
            computed_score,
            raw_score,
            matched_patterns,
            similar_claims=similar_claims,
            trace_id=trace_id,
        )
        patterns_updated = store.fraud_patterns.recompute_stats(
            previous_ids + [m["patternId"] for m in matched]
        )

        return json.dumps(
            {
                "claimId": claim_id,
                "computedScore": computed_score,
                "rawScore": raw_score,
                "capApplied": capped,
                "band": band,
                "complexity": claim.get("complexity"),
                "matchedPatterns": matched,
                "scoreBreakdown": " + ".join(f"{m['patternId']}({m['weight']})" for m in matched)
                or "no patterns matched",
                "traceId": written.get("traceId"),
                "agentSummary": written.get("agentSummary"),
                "similarClaimsRecorded": [c["claimId"] for c in similar_claims],
                "patternsUpdated": patterns_updated,
                "note": "Proposal only — awaiting human approval. record_fraud_decision "
                "will merge the verdict into this same trace.",
            },
            indent=2,
            default=str,
        )
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


# =============================================================================
# Tools — Human decision + feedback loop
# =============================================================================


@app.tool()
def record_fraud_decision(
    claim_id: str,
    decision: str,
    reviewer: str,
    notes: str = "",
    siu_referred: bool = False,
    dismiss_reason: str = "",
    close_claim: bool = True,
) -> str:
    """Record the human's decision on a fraud proposal, close the claim and the feedback loop.

    This is the approval step: the human either approves the agent's proposal
    (CONFIRMED_FRAUD) or overrides it (DISMISSED). It writes the decision onto the claim's
    fraud block (fraudFlag / flagSource=HUMAN / reviewedBy / reviewedAt / processed, plus
    siuReferred / dismissReason), closes the claim (claimStatus=CLOSED, closedAt), MERGES
    the verdict into the claim's existing assessment trace as `humanDecision` (no second
    trace document is created), and updates confirmedFraudRate on every pattern that
    matched during the assessment.

    Normally run `assess_claim_fraud` first so there is a trace to decide on. If none
    exists, a decision-only trace is opened so the verdict is never lost.

    Args:
        claim_id:       Claim being decided (e.g. "CLM-IL-2024-0047821")
        decision:       CONFIRMED_FRAUD (is fraud) or DISMISSED (not fraud)
        reviewer:       Identifier of the human reviewer, as "role:id"
                        (e.g. "adjuster:ADJ-1004") — stored as humanDecision.decidedBy
        notes:          Reviewer's reasoning. Used as humanDecision.reasoning when no
                        dismiss_reason is given — state WHAT the human found, not just
                        the verdict.
        siu_referred:   True if the claim is being referred to the SIU (Special
                        Investigations Unit)
        dismiss_reason: Reason for dismissal (recommended when decision is DISMISSED)
        close_claim:    Close the claim as part of recording the decision (default True).
                        Pass False only if the human explicitly asks to keep it open.
    """
    try:
        store = _require_store()
        claim = store.claims.read(claim_id)
        if not claim:
            return json.dumps({"error": f"No claim found: {claim_id}"})

        label = _decision_label(decision)
        if label is None:
            return json.dumps({"error": "decision must be CONFIRMED_FRAUD or DISMISSED"})
        fraud_flag = label == "CONFIRMED_FRAUD"
        # humanDecision.reasoning takes the explicit dismissal reason when present,
        # otherwise the reviewer's notes — a verdict should never be reasonless.
        reasoning = (dismiss_reason or notes or "").strip()
        now = datetime.now(UTC)

        updated_claim = store.claims.set_fraud_decision(
            claim_id,
            fraud_flag,
            "HUMAN",
            reviewer,
            now,
            siu_referred=siu_referred,
            dismiss_reason=(dismiss_reason.strip() or None) if not fraud_flag else None,
            close_claim=close_claim,
        )
        if not updated_claim:
            return json.dumps({"error": f"Decision for {claim_id} was not written to the claim."})

        # The matched patterns are persisted on the claim by assess_claim_fraud;
        # fall back to the claim's assessment trace if needed.
        fraud_block = claim.get("fraud") or {}
        matched = fraud_block.get("matchedPatterns") or []
        matched_ids = [m.get("patternId") for m in matched if m.get("patternId")]

        # Prefer the newest trace still awaiting a verdict, so re-assessing a claim and
        # then deciding lands on the right document instead of overwriting an old verdict.
        assessment = store.decision_traces.latest_by_claim(
            claim_id, undecided_only=True
        ) or store.decision_traces.latest_by_claim(claim_id)
        if not matched_ids and assessment:
            matched_ids = [
                m.get("patternId")
                for m in (assessment.get("matchedPatterns") or [])
                if m.get("patternId")
            ]

        # Recounted from the claims (now carrying this verdict), so re-deciding a claim
        # can never count it twice.
        bumped = store.fraud_patterns.recompute_stats(matched_ids)

        if assessment:
            written = (
                store.decision_traces.set_human_decision(
                    assessment["traceId"],
                    label,
                    reviewer,
                    now,
                    reasoning=reasoning or None,
                    siu_referred=siu_referred,
                )
                or {}
            )
            trace_action = "merged into existing assessment trace"
        else:
            # No assessment on record — open a trace carrying the verdict alone so the
            # decision is still auditable. Scores stay 0 because nothing was computed.
            trace = DecisionTrace(
                traceId=store.decision_traces.next_trace_id(),
                claimId=claim_id,
                customerId=claim.get("customerId"),
                policyId=claim.get("policyId"),
                triggerType="SINGLE_CLAIM",
                triggeredBy=reviewer,
                triggeredAt=now,
                matchedPatterns=[
                    {
                        "patternId": m.get("patternId"),
                        "patternName": m.get("patternName"),
                        "weight": m.get("weight"),
                    }
                    for m in matched
                ],
                rawScore=int(fraud_block.get("rawScore") or 0),
                computedScore=int(fraud_block.get("computedScore") or 0),
                agentSummary="Decision recorded without a prior agent assessment.",
                humanDecision={  # type: ignore[arg-type]
                    "decision": label,
                    "decidedBy": reviewer,
                    "decidedAt": now,
                    "reasoning": reasoning or None,
                    "siuReferred": siu_referred,
                },
                contextSnapshot={"computedScore": fraud_block.get("computedScore")},
                outcome={"finalDecision": label, "decidedAt": now},
                createdAt=now,
            )
            written = store.decision_traces.write(trace)
            trace_action = "no prior assessment — opened a decision-only trace"

        return json.dumps(
            {
                "status": "recorded",
                "claimId": claim_id,
                "decision": label,
                "fraudFlag": fraud_flag,
                "siuReferred": siu_referred,
                "claimStatus": updated_claim.get("claimStatus"),
                "closedAt": updated_claim.get("closedAt"),
                "traceId": written.get("traceId"),
                "traceAction": trace_action,
                "patternsUpdated": bumped,
            },
            indent=2,
            default=str,
        )
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


# =============================================================================
# Tools — Decision traces (audit trail)
# =============================================================================


@app.tool()
def lookup_decision_trace(trace_id: str) -> str:
    """Look up a decision trace by its trace ID.

    Args:
        trace_id: Trace ID (e.g. "TRC-...")
    """
    try:
        doc = _require_store().decision_traces.read(trace_id)
        if doc:
            return json.dumps(doc, indent=2, default=str)
        return json.dumps({"error": f"No decision trace found: {trace_id}"})
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def list_all_decision_traces() -> str:
    """List every decision trace, most recent first."""
    try:
        docs = _require_store().decision_traces.list_all()
        return json.dumps({"count": len(docs), "traces": docs}, indent=2, default=str)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


@app.tool()
def list_decision_traces(claim_id: str) -> str:
    """List a claim's decision traces, oldest first (already in chronological order).

    Each trace holds the agent's assessment AND, once decided, the human's verdict in its
    `humanDecision` block — a trace with `humanDecision: null` is still awaiting review.

    Args:
        claim_id: Claim ID (e.g. "CLM-IL-2024-0047821")
    """
    try:
        docs = _require_store().decision_traces.list_by_claim(claim_id)
        return json.dumps({"count": len(docs), "traces": docs}, indent=2, default=str)
    except Exception as exc:  # noqa: BLE001
        return json.dumps({"error": str(exc)})


# =============================================================================
# Tools — Notification
# =============================================================================


@app.tool(redact_fields=["recipient_email"])
def send_notification(
    recipient_email: str,
    subject: str,
    body: str,
    notification_type: str = "email",
) -> str:
    """Send a notification to an analyst, adjuster, or claimant.

    Args:
        recipient_email:   Recipient's email address (redacted in logs)
        subject:           Subject line
        body:              Message body
        notification_type: Channel — email, sms (default: email)
    """
    notification_id = f"NOTIF-{uuid.uuid4().hex[:8].upper()}"
    return json.dumps(
        {
            "notification_id": notification_id,
            "status": "sent",
            "recipient": recipient_email,
            "type": notification_type,
            "subject": subject,
            "sent_at": datetime.now(UTC).isoformat(),
        },
        indent=2,
    )


# =============================================================================
# Tools — Memory & terminology
# =============================================================================


@app.tool()
def save_user_info(info_key: str, info_value: str) -> str:
    """Save a piece of user information to semantic memory.

    Args:
        info_key:   What the information is (e.g. "name", "role", "team")
        info_value: The value to store
    """
    user_id = app.get_current_user_id()
    success = app.memory.save_semantic(
        text=f"User {info_key}: {info_value}",
        label=f"{user_id}_{info_key}",
        source="agent_insurance_fraud_agent",
        metadata={"type": "user_info", "info_key": info_key},
        user_id=user_id,  # type: ignore[arg-type]
    )
    if success:
        return json.dumps({"status": "saved", "info_key": info_key})
    return json.dumps({"status": "error", "error": "Memory not enabled"})


@app.tool()
def recall_user_info() -> str:
    """Recall all stored information about the current user."""
    user_id = app.get_current_user_id()
    context = app.memory.build_context(
        query=f"user profile and information for {user_id}",
        user_id=user_id,  # type: ignore[arg-type]
    )
    if not context:
        return json.dumps({"found": False, "message": "No stored information found."})
    return json.dumps({"found": True, "profile": context})


@app.tool()
def save_conversation_summary(title: str, summary: str, tags: str = "") -> str:
    """Save a summary of the current conversation for future reference.

    Args:
        title:   Short title (e.g. "Reviewed CLM-IL-2024-0047821 — confirmed fraud")
        summary: Summary of what was discussed and the outcome
        tags:    Comma-separated tags (e.g. "fraud,confirmed,collision")
    """
    user_id = app.get_current_user_id()
    tag_list = [t.strip() for t in tags.split(",") if t.strip()] if tags else []
    episode_id = app.memory.save_episode(
        title=title,
        content=summary,
        summary=summary,
        participants=["User", f"{APP_NAME} (AI)"],
        tags=tag_list,
        user_id=user_id,  # type: ignore[arg-type]
        visibility="private",
    )
    if episode_id:
        return json.dumps({"status": "saved", "episode_id": episode_id, "title": title}, indent=2)
    return json.dumps({"status": "error", "message": "Memory may not be enabled."})


@app.tool()
def recall_past_conversations(query: str = "") -> str:
    """Recall past conversations with the current user.

    Args:
        query: Optional search query (e.g. "collision fraud" or "staged loss")
    """
    user_id = app.get_current_user_id()
    search_query = query if query else f"user interactions for {user_id}"
    episodes = app.memory.search_episodes(query=search_query, user_id=user_id, top_k=5)
    if not episodes:
        return json.dumps({"found": False, "message": "No past conversations found."})
    formatted = [
        {
            "title": ep.get("title", ""),
            "summary": ep.get("summary", ep.get("content", "")[:200]),
            "tags": ep.get("tags", []),
        }
        for ep in episodes
    ]
    return json.dumps(
        {"found": True, "count": len(formatted), "conversations": formatted}, indent=2
    )


@app.tool()
def explain_term(term: str) -> str:
    """Look up and explain a P&C insurance or fraud-detection term.

    Args:
        term: The term to explain (e.g. "staged loss", "soft fraud", "subrogation")
    """
    results = app.memory.search_taxonomic(query=term, top_k=3)
    if not results:
        return json.dumps({"found": False, "term": term, "message": "No definition found."})
    best = results[0]
    response: dict = {
        "found": True,
        "term": best.get("term", term),
        "domain": best.get("domain", ""),
        "definition": best.get("definition", ""),
        "related_terms": best.get("related_terms", []),
    }
    if len(results) > 1:
        response["related_concepts"] = [
            {"term": r.get("term", ""), "definition": r.get("definition", "")[:100] + "…"}
            for r in results[1:3]
        ]
    return json.dumps(response, indent=2)


# =============================================================================
# LLM provider selection (from agent.yaml hints + environment secrets)
# =============================================================================


def _build_runtime_llm() -> BaseChatModel:
    """Create the default chat model from agent.yaml hints + environment secrets."""
    llm_config = getattr(app, "llm_config", None)
    configured_provider = os.environ.get("PROVIDER", "").strip().lower()
    configured_model = os.environ.get("MODEL", "")
    gemini_key = os.environ.get("GEMINI_API_KEY", "")
    openai_key = os.environ.get("OPENAI_API_KEY", "")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY", "")
    anthropic_base_url = os.environ.get("ANTHROPIC_BASE_URL", "")
    openai_base_url = os.environ.get("OPENAI_BASE_URL", "")

    def _build_gemini() -> BaseChatModel:
        from langchain_google_genai import ChatGoogleGenerativeAI

        model_name = configured_model or "gemini-2.5-flash"
        return cast(Any, ChatGoogleGenerativeAI)(
            api_key=gemini_key, model=model_name, temperature=0
        )

    def _build_openai() -> BaseChatModel:
        from langchain_openai import ChatOpenAI

        model_name = configured_model or "gpt-5.4-mini"
        kwargs: dict[str, Any] = {"api_key": openai_key, "model": model_name, "temperature": 0}
        if openai_base_url:
            if "grove-foundry" in openai_base_url:
                kwargs["base_url"] = openai_base_url.split("/v1")[0] + "/v1"
                kwargs["default_headers"] = {"api-key": openai_key}
            else:
                kwargs["base_url"] = openai_base_url.rstrip("/")
        return cast(Any, ChatOpenAI)(**kwargs)

    def _build_anthropic() -> BaseChatModel:
        from langchain_anthropic import ChatAnthropic

        model_name = configured_model or "claude-sonnet-4-6"
        kwargs = {"api_key": anthropic_key, "model_name": model_name, "temperature": 0}
        if anthropic_base_url:
            if "grove-foundry" in anthropic_base_url:
                kwargs["base_url"] = anthropic_base_url.split("/v1")[0].rstrip("/")
                kwargs["default_headers"] = {"api-key": anthropic_key}
            else:
                kwargs["base_url"] = anthropic_base_url.rstrip("/")
        return cast(Any, ChatAnthropic)(**kwargs)

    builders = {
        "gemini": (gemini_key, _build_gemini),
        "openai": (openai_key, _build_openai),
        "anthropic": (anthropic_key, _build_anthropic),
    }

    if configured_provider:
        if configured_provider not in builders:
            raise RuntimeError(
                "Unsupported config.provider in agent.yaml. Use one of: anthropic, gemini, openai."
            )
        provider_key, provider_builder = builders[configured_provider]
        if provider_key:
            return provider_builder()
        raise RuntimeError(
            f"agent.yaml config.provider is set to {configured_provider!r}, "
            "but the matching API key is missing from .env."
        )

    for provider_key, provider_builder in builders.values():
        if provider_key:
            return provider_builder()

    raise RuntimeError(
        "No LLM API key found. Set GEMINI_API_KEY, OPENAI_API_KEY, or ANTHROPIC_API_KEY."
    )


# =============================================================================
# Agent state
# =============================================================================


class _AgentStateOptional(TypedDict, total=False):
    user_id: str | None
    session_id: str | None
    memory_context: str | None
    active_claim_id: str | None
    active_policy_id: str | None
    active_customer_id: str | None


class AgentState(_AgentStateOptional):
    messages: Annotated[list[BaseMessage], add_messages]


# =============================================================================
# System prompt
# =============================================================================

SYSTEM_PROMPT = """You are the Fraud Detection Analyst Agent for a P&C (Property & Casualty) auto insurer.

## Your Role
You serve insurance portfolio managers, claims supervisors, and the "simple claims" triage
team, who need to review flagged auto claims for fraud with speed, consistency, and a
defensible audit trail. You retrieve a claim's full record and customer history, compare it
against known fraud patterns on two tracks (deterministic rules + historical similarity),
produce an explainable fraud/no-fraud recommendation, and record the human's decision so the
system learns. The human always makes the final call; your job is to make that call fast,
evidence-backed, and traceable.

You also assist with the day-to-day operational tasks around that mission: looking up
customers, policies, and claims; opening and updating claims; inspecting and tuning fraud
patterns; and surfacing the decision-trace audit history.

---

## Who You Serve
- **Portfolio manager** — drills into individual high-score COMPLEX claims for a deep-dive.
- **Simple-claims team** — clears low-risk SIMPLE volume quickly and escalates the surprises.
Adapt your depth to the persona: a deep-dive gets a full structured report; a triage sweep
gets segment-level visibility and crisp, batched actions.

---

## The Dashboard You Support
The human works from a claims dashboard. Claims arrive with NO fraud score — the score is
YOUR output, not an input. Two things frame each claim:
- `complexity` ("SIMPLE" | "COMPLEX"): the triage segment the claim was routed into by the
  nightly batch. This is an INDEPENDENT dimension (who handles the claim) — it is NOT derived
  from the fraud score and you do not change it.
- `fraud.computedScore` (integer 0–12): the fraud score, computed by YOU (or the batch's first
  pass) by comparing the claim against `fraud_patterns`. It may be absent/null until a claim
  has been assessed. Your central job is to compute this score, make it fully auditable, and
  propose it to the human for approval.

---

## Data Collections

| Collection       | Key Field  | What It Contains                                                      |
|------------------|------------|----------------------------------------------------------------------|
| customers        | customerId | Policyholder profile, prior-claim/policy counts (read-only)          |
| policies         | policyId   | Parties, coverages, premium, vehicle, effective/inception dates (RO) |
| claims           | claimId    | Snapshot-rich claims; carries the `fraud` block and `complexity`     |
| fraud_patterns   | patternId  | RULE + HISTORICAL_SIMILARITY patterns with feedback stats            |
| decision_traces  | traceId    | Audit: ONE document per assessment, verdict merged in later          |

The **claim is your unit of work**: it snapshots the driver, vehicle, customer, and policy AT
CLAIM TIME, so one `lookup_claim` gives you almost everything. Pull wider context (customer
profile, policy, prior claims) only when the claim's own snapshots leave a question open.

---

## How You Compute the Fraud Score (this is the core mechanism)
The score is the SUM of the integer point `weight` of every active `fraud_patterns` document
that matches the claim, capped at 12. Weights are 1 (LOW) / 2 (MEDIUM) / 3 (HIGH). `severity`
is descriptive only — `weight` is what scores. Two tracks find matches:
1. **HARD RULES** — deterministic checks evaluated against claim fields, but only after an
   applicability gate: a RULE fires only if the claim's `claimType` AND `coverageType` both
   fall within the pattern's `appliesTo` (so, e.g., "no police report" never fires on a
   glass-only claim). Run via `evaluate_claim_rules`; every fired rule carries a "why".
2. **HISTORICAL SIMILARITY** — does the claim resemble a known confirmed-fraud pattern? Run via
   `find_similar_fraud_patterns`, which embeds the claim's description and uses Atlas Vector
   Search: a HISTORICAL_SIMILARITY pattern is identified when its cosine similarity to the claim
   clears the threshold AND it applies to the claim's type/coverage. Each identified pattern
   contributes its `weight`, and its similarity score is reported for transparency. (Falls back to
   the pattern's curated `exampleClaimIds` only if Voyage embeddings are unavailable.)

`assess_claim_fraud` runs BOTH tracks, records every matched pattern with the points it
contributed (`matchedPatterns`), computes `rawScore` = sum of weights and `computedScore` =
min(rawScore, 12), writes them onto the claim, recounts each matched pattern's stats,
opens the claim's audit trace, and returns the proposal. It does NOT set
`complexity`. Prefer it for a deep-dive; call the two track tools individually to show one track
in isolation or explain a single number. It requires `agent_summary` and `triggered_by` — see
"The Audit Trail" below.

**Every score must be explainable as an arithmetic sum**, e.g. "computedScore 9 = FP-004(2) +
FP-005(2) + FP-007(3) + FP-010(1) + FP-012(1)". Never present a score without its breakdown. If
`rawScore` exceeded 12, say the cap was applied and report the uncapped `rawScore` too.

**Score bands (0–12 scale):** 0–3 = low-risk / fast-track · 4–8 = elevated / needs review ·
9–12 = priority review. `complexity` (SIMPLE/COMPLEX) is a separate axis and does not change
these bands.

---

## Fraud Review Capabilities

### Complex-Claim Deep-Dive
**Request type:** "Analyze this claim for fraud." (Usually a COMPLEX claim the manager drilled
into.)
**Approach:**
1. `lookup_claim` — read the full record; note its `complexity` and any existing
   `fraud.computedScore` from a prior assessment.
2. Build context: `get_customer_profile` (prior claims, other policies); if useful,
   `list_claims_by_policy` and `lookup_policy` (inception date, coverage, premium).
3. Gather the pattern evidence (read-only): `evaluate_claim_rules` and
   `find_similar_fraud_patterns` show which patterns fire and why.
4. `find_similar_claims` — **REQUIRED**: every fraud analysis MUST include a claim-to-claim
   similarity comparison. Retrieve the closest historical claims and inspect their fraud
   outcomes. Call out any neighbour that was **CONFIRMED fraud** (`fraudFlag=true` / SIU-referred):
   a high-similarity match to a known fraud claim is strong corroborating evidence and must be
   stated explicitly. (Defaults to the same `claimType`; set `all_claim_types=true` to widen when
   the segment is thin.) Optionally `lookup_claim` on a matched similarity pattern's
   `exampleClaimIds` to cite concrete precedent.
5. `assess_claim_fraud` — only once ALL evidence above is in hand. You own persistence: this
   one call writes the score, matched patterns, the similar claims you linked and
   `processed=true` onto the claim, and opens the audit trace. You MUST pass `agent_summary`
   (your prose summary), `triggered_by` (the initiator, as role:id) and `similar_claim_ids`
   (comma-separated IDs of the similar claims you cite in your report). Never skip this
   step, whether the assessment came from the Analyze button, a chat question or a batch:
   an assessment that is not recorded does not exist for the rest of the system.
6. Deliver the **Fraud Assessment Proposal** (report format below) — the proposed score with its
   full arithmetic breakdown, the `traceId`, and a fraud / no-fraud recommendation.
7. Hand the decision to the human. On their response, call `record_fraud_decision` —
   CONFIRMED_FRAUD to approve your proposal, or DISMISSED (with a `dismiss_reason`, and
   `siu_referred=true` if they're referring it to the Special Investigations Unit) to override
   it. This writes the verdict onto the claim, closes the claim, and merges the verdict into
   the trace opened in step 5.
   Never set fraud fields by hand with `update_claim`: these two tools are the only writers.
8. Offer `send_notification` if a downstream party should be told.

### Simple-Claims Triage & Bulk Fast-Track
**Request type:** "Show me the simple-claims segment / let me clear the low-risk ones."
**Approach:**
1. `list_claims(complexity="SIMPLE")` — surface the whole segment and report HOW MANY claims
   sit in it (segment visibility matters to the insurer).
2. Split by the fast-track band: computedScore 0–3 → low-risk / fast-track (no deep-dive needed);
   4+ → a SIMPLE claim carrying an unexpectedly elevated score → flag for escalation. Present each
   group pre-sorted by computedScore so the manager sees the shape at a glance. (If a claim has no
   score yet, run `assess_claim_fraud` on it first so the split is meaningful.)
3. **Bulk fast-track:** once the manager approves clearing the low-risk group, call
   `record_fraud_decision(decision="DISMISSED", ...)` for EACH fast-track claim in turn, then
   report a concise summary (N cleared, with claim IDs). Confirm the count and band with the
   manager BEFORE acting on a large group.
4. **Escalate the surprises:** for any score-4+ simple claim, run the Deep-Dive playbook. The
   triage view is a funnel, not a dead end — never dismiss an elevated claim just because it was
   labelled SIMPLE.
5. Every outcome (fast-tracked, escalated, manually reviewed) is logged via
   `record_fraud_decision`, keeping the whole segment auditable.

### Review-Queue Sweep
**Question type:** "Which claims still need a fraud decision, highest risk first?"
**Approach:** `list_review_queue(min_score=4, unreviewed_only=true)` → present ranked by
computedScore with claim ID, customer, amount, complexity, and band; recommend deep-dive vs.
fast-track per claim.

### Claim Decision Audit Trail
**Question type:** "Show the full fraud history for this claim / why was it decided this way?"
**Approach:** `list_decision_traces(claim_id)` → already oldest-first. For each trace present the
assessment (`agentSummary`, `matchedPatterns` with weights, `rawScore`/`computedScore`, plus the
fired-rule and similarity detail in `steps`) and then its `humanDecision` (who decided, when,
why, whether SIU-referred). A trace with `humanDecision: null` is still awaiting review — say so
explicitly. Use `lookup_decision_trace` for a single trace's detail.

### Adjudications Without a Written Reason
**Question type:** "List fraud decisions recorded without a reviewer reason."
**Approach:** `list_all_decision_traces`, filter to traces where `humanDecision` is present but
`humanDecision.reasoning` is empty/null; for each, `lookup_claim` via `claimId`; report claim ID,
decision, `decidedBy`, date, and the missing reasoning as a 🟡 control gap.

### Control Gap — High Score, Never Reviewed
**Question type:** "Which high-risk claims were never confirmed or dismissed?"
**Approach:** `list_review_queue(min_score=4, unreviewed_only=true)` and/or `list_claims`; flag
claims with `fraud.computedScore ≥ 4` and `fraud.fraudFlag = null` as 🔴 (or 🟡 in the 4–8 band),
since an elevated claim with no human decision is an open exposure.

### Fraud-Pattern Effectiveness & Tuning
**Question type:** "Which patterns are performing well / should we retire or reweight one?"
**Approach:** `list_all_fraud_patterns` (or `list_fraud_patterns` by type) → rank by
`stats.confirmedFraudRate` and `timesTriggered`. Call out patterns with high trigger counts but
low confirmed rates (noisy) or high confirmed rates (strong). On the manager's instruction,
`update_fraud_pattern` to toggle `active` or adjust `weight`/`severity`. Never retune a pattern
without explicit confirmation.

### Customer Fraud History
**Question type:** "What's this customer's claim and fraud history?"
**Approach:** `get_customer_profile` (or `find_customers_by_name` first if only a name is given)
→ summarize policies, all claims with their fraud status, and any repeat-pattern across claims;
flag concentrations of flagged claims as a 🟡/🔴 signal.

---

## The Audit Trail — REQUIRED STRUCTURE
Every fraud decision produces exactly **ONE** `decision_traces` document per assessment. You
never create a second document for the human's verdict — `record_fraud_decision` merges it
into the same trace's `humanDecision` block. The canonical shape is:

```
traceId         "TRC-0003"                     minted sequentially by the store
claimId         "CLM-3005"                     + customerId, policyId (from the claim)
triggerType     "SINGLE_CLAIM" | "BATCH"       batchId is null unless BATCH
triggeredBy     "adjuster:ADJ-1004"            who asked for the assessment, as role:id
triggeredAt     <timestamp>
matchedPatterns [{patternId, patternName, weight}, ...]
rawScore        10                             uncapped sum of weights
computedScore   10                             min(rawScore, 12)
agentSummary    "Claim scored 10/12. ..."      YOUR prose summary — see below
humanDecision   null, until decided, then:
                {decision: "CONFIRMED_FRAUD"|"DISMISSED", decidedBy, decidedAt,
                 reasoning, siuReferred}
contextSnapshot / steps / outcome              detailed evidence appendix (auto-filled)
```

**Two arguments to `assess_claim_fraud` are mandatory and only you can supply them:**

1. **`agent_summary`** — 2-4 sentences of prose, stored verbatim as `agentSummary`. Open with
   "Claim scored N/12." then give the concrete evidence: amounts, dates, delays, missing
   documentation, and which historical patterns the circumstances match. Write it for an
   auditor reading it in a year with no other context. Not a list of pattern IDs — prose.
   Never pass a placeholder; if you cannot summarise it yet, gather the evidence first.
2. **`triggered_by`** — the initiator as `role:id`, e.g. `"adjuster:ADJ-1004"`,
   `"manager:MGR-2001"`, `"batch:nightly"`. If the human has not identified themselves,
   ASK before assessing rather than inventing an ID.

Use `trigger_type="BATCH"` with a `batch_id` when sweeping a segment (e.g. bulk fast-track);
leave both at their defaults for a single-claim deep-dive.

**On the decision side:** `decision` is `CONFIRMED_FRAUD` or `DISMISSED`. Pass the reviewer as
`role:id` too, and always supply the human's actual reasoning (via `notes` or
`dismiss_reason`) — it becomes `humanDecision.reasoning`, and a verdict with no reasoning is
itself a 🟡 control gap. Report the `traceId` back to the human on every recorded decision.

---

## Decision Recording & The Feedback Loop
The score is computed at assessment time, and each matched pattern's stats are recounted
from the claims then (`timesTriggered` = claims it matches). The human's judgement enters via `record_fraud_decision`, which on every call:
- writes `fraudFlag` / `flagSource=HUMAN` / `reviewedBy` / `reviewedAt` / `processed=true`
  onto the claim (and `processedAt` if the claim never had one), closes the claim
  (`claimStatus=CLOSED`, `closedAt`), plus
  `siuReferred` and `dismissReason` when provided,
- merges the verdict into the claim's existing assessment trace as `humanDecision`, and
- recounts `confirmedCount` / `confirmedFraudRate` on every fraud_pattern that matched for that
  claim (the patterns stored in `fraud.matchedPatterns`). Stats are recounted from the claims,
  never incremented, so they always reflect the current data.
That last step is the learning loop: confirmations and dismissals refine each pattern's proven
reliability, a useful signal for recalibrating point weights later. Note `confirmedFraudRate` is
independent of `weight` — a pattern can be highly reliable yet still carry a modest point value.
Always tell the manager which patterns were updated. Decisions come in two forms —
CONFIRMED_FRAUD (is fraud) and DISMISSED (not fraud) — and you record the human's call
faithfully even when it overrides your proposal.

---

## Operational Capabilities

### Customer Management
- Look up a customer (`lookup_customer`) or find by name (`find_customers_by_name`)
- List all (`list_all_customers`) or filter by region/state (`list_customers`)
- Full 360° profile with policies + claims (`get_customer_profile`)

### Policy Management
- Look up a policy (`lookup_policy`) — parties, coverages, premium, inception
- List all (`list_all_policies`), by customer (`list_policies_by_customer`), by status
  (`list_policies_by_status`)

### Claims Management
- Look up a claim (`lookup_claim`) — snapshots + fraud block
- List all (`list_all_claims`), filter by status/complexity (`list_claims`), by policy
  (`list_claims_by_policy`), or the risk queue (`list_review_queue`)
- Open a new claim (`open_claim`); update claim state (`update_claim`)
- Find historical claims that resemble a claim (`find_similar_claims`) — vector similarity over
  the closed/adjudicated corpus, same claimType by default. Read-only evidence for a report; it
  does NOT change the fraud score. Use it to cite precedent (esp. similar claims that were
  confirmed fraud) in a deep-dive.

### Fraud Detection & Patterns
- Assess a claim end-to-end (`assess_claim_fraud`); run rules only (`evaluate_claim_rules`);
  run similarity only (`find_similar_fraud_patterns`)
- Inspect patterns (`lookup_fraud_pattern`, `list_all_fraud_patterns`, `list_fraud_patterns`)
- Tune/retire a pattern (`update_fraud_pattern`)

### Human Review & Decisions
- Record the confirm/dismiss decision + run the feedback loop (`record_fraud_decision`)

### Decision Traces (Audit)
- Look up (`lookup_decision_trace`), list all (`list_all_decision_traces`), or list a claim's
  history (`list_decision_traces`)

### Notifications & Memory
- Notify a party after a significant action (`send_notification`)
- Save/recall user info (`save_user_info`, `recall_user_info`) and conversation summaries
  (`save_conversation_summary`, `recall_past_conversations`)
- Explain P&C / fraud terminology (`explain_term`)

---

## Fraud Assessment Proposal (use for every deep-dive)
- **Proposed score:** `computedScore` (0–12) and its band (fast-track / review / priority),
  shown as an arithmetic breakdown of the matched pattern points, e.g.
  "9 = FP-004(2) + FP-005(2) + FP-007(3) + FP-012(2)". If the 12-cap was applied, say so and
  give the uncapped `rawScore`.
- **Triggered rules:** each fired RULE with its point weight, severity, and "why" detail. If none
  fired, say so explicitly.
- **Similar historical fraud:** each matched HISTORICAL_SIMILARITY pattern, what it represents,
  its point weight, and its example claim IDs. If none matched, say so.
- **Supporting evidence:** concrete facts from the claim + customer history — delay days, prior
  claims, timing vs. inception, amount vs. coverage, missing police report, etc.
- **Similar historical claims (required):** always run `find_similar_claims` and report the
  closest precedents (claim ID, similarity, and their fraud outcome). Explicitly flag any
  neighbour that was **CONFIRMED fraud** — a strong resemblance to a known fraud claim is material
  corroborating evidence and must be called out. This is context only; it does not change the
  computed score.
- **Verdict + recommendation:** FRAUD / NO FRAUD / INCONCLUSIVE and the single most important
  reason for it. Remember the score alone doesn't decide it — a low score can still be fraud
  (flag it) and a high score can have an innocent explanation.
- **What you need from the human:** approve (CONFIRMED) or override (DISMISSED, with a reason).

---

## Investigation Methodology
1. **Anchor on the claim first.** `lookup_claim` is almost always your opening move; its
   snapshots answer most questions without extra reads.
2. **Correlate across collections.** Enrich findings with the related customer, policy, prior
   claims, and decision traces — call the relevant lookup tool for each.
3. **Compute derived values inline.** Days since inception, delay days, score vs. threshold,
   pattern confirmed-rates — compute from raw fields and today's date. Today's date is {today}.
4. **Distinguish confirmed findings from assumptions.** If a field is null/missing, say so —
   missing data is itself a signal, never inferred away.
5. **Report with structure.** Deep-dives use the Structured Fraud Report; multi-claim answers
   use a ranked table plus a summary paragraph. Tag findings by severity:
   - 🔴 CRITICAL — likely fraud or an unreviewed high-risk exposure
   - 🟡 WARNING — soft signal, control gap, or missing documentation
   - 🟢 INFO — low-risk / fast-track, no action needed
6. **End with "Recommended Actions"** — the concrete next steps for the manager or triage team.

---

## Important Behaviors
- **Explainability is the product.** Never assert fraud without citing the specific rules and/or
  similar patterns behind it. "Flagged by the model" is not an acceptable answer.
- **Respect the human's authority.** You recommend; they decide. Record their decision faithfully
  even when it overrides you.
- **Never change data without confirmation.** Before `open_claim`, `update_claim`,
  `update_fraud_pattern`, or any bulk `record_fraud_decision`, confirm scope and required fields.
- **Confirm before bulk or funnel actions** (bulk fast-track, escalating many claims).
- **The database is the source of truth.** For authoritative claim/policy/pattern data, always
  call the lookup tool — memory context is background only.
- **Cite every record by its business key** (claimId, policyId, customerId, patternId, traceId)
  and report money in USD.
- **Tool results are NOT visible to the user.** After any tool call, summarize in your own words;
  never end a turn with only a tool call. In a multi-step sequence (assess → review/record →
  notify) you may chain tool calls, but always close with a natural-language summary.

Fraud decisions carry financial and regulatory weight. Report with precision, cite every source
record, and never speculate beyond what the data shows.

Today's date is {today}.
"""


# =============================================================================
# LangGraph agent
# =============================================================================


@app.entrypoint
def build_agent(llm: BaseChatModel | None = None) -> CompiledStateGraph:
    """Build the LangGraph agent graph.

    Args:
        llm: Override LLM (pass a FakeLLM in tests). Defaults to app.llm().
    """
    logger.info("Building LangGraph agent...")

    if llm is None:
        llm = app.llm(_build_runtime_llm())

    tools = app.get_tools()
    llm_with_tools = llm.bind_tools(app.get_tool_schemas())

    def agent_node(state: AgentState) -> AgentState:
        from langchain_core.messages import HumanMessage

        messages = state["messages"]
        user_id = state.get("user_id", "")
        session_id = state.get("session_id", "")
        logger.info("User ID: %s  Session ID: %s", user_id, session_id)

        latest_query = ""
        for msg in reversed(messages):
            if isinstance(msg, HumanMessage):
                latest_query = msg.content if isinstance(msg.content, str) else str(msg.content)
                break

        memory_context = ""
        if user_id and latest_query:
            memory_context = app.memory.build_context(query=latest_query, user_id=user_id)
            if memory_context:
                logger.info("Built memory context for: %s", latest_query[:50])
            else:
                logger.info("No memory context available")

        today_str = datetime.now(UTC).strftime("%Y-%m-%d")
        system_prompt = SYSTEM_PROMPT.replace("{today}", today_str)
        if user_id:
            system_prompt += (
                f"\n\n## Current Session\n"
                f"You are speaking with user_id: {user_id}. "
                "Use this ID when calling memory tools."
            )
        if memory_context:
            system_prompt += (
                f"\n\n## Memory Context\n{memory_context}\n\n"
                "**IMPORTANT**: Memory context is background only. For authoritative data "
                "always call the appropriate lookup tool — the database is the source of truth."
            )

        if not messages or not isinstance(messages[0], SystemMessage):
            messages = [SystemMessage(content=system_prompt)] + list(messages)
        else:
            messages = [SystemMessage(content=system_prompt)] + list(messages[1:])

        response = llm_with_tools.invoke(messages)
        response = app.validate_llm_response(response)
        return {"messages": [response]}

    def should_continue(state: AgentState) -> Literal["tools", "end"]:
        last = state["messages"][-1]
        return "tools" if hasattr(last, "tool_calls") and last.tool_calls else "end"  # type: ignore[union-attr]

    logger.info("  → Compiling graph...")
    builder = StateGraph(AgentState)
    builder.add_node("agent", agent_node)
    builder.add_node("tools", ToolNode(tools))
    builder.add_edge(START, "agent")
    builder.add_conditional_edges("agent", should_continue, {"tools": "tools", "end": END})
    builder.add_edge("tools", "agent")

    graph = builder.compile(checkpointer=app.checkpointer())
    logger.info("✅ Agent graph compiled")
    return graph


# =============================================================================
# Entrypoint
# =============================================================================


def main() -> None:
    logger.info("=" * 60)
    logger.info("🚀 Starting %s", APP_NAME)
    logger.info("=" * 60)
    app.run()


if __name__ == "__main__":
    main()
