"""
Store — MongoDB-backed data models and stores for the insurance fraud agent.

Collections (fraud detection data model):
  customers        — policyholder profiles (read-only source of truth)
  policies         — policies with parties, coverages, premium, vehicle
  claims           — the agent's unit of work; snapshot-rich, carries a fraud block
  fraud_patterns   — RULE + HISTORICAL_SIMILARITY patterns (vector-searchable)
  decision_traces  — append-only audit trail of assessments and human decisions

Design notes (from the approved data-model proposal):
  - The claim is the agent's unit of work: it snapshots driver/vehicle/customer/policy
    state at claim time, so the agent reads one document to run a fraud check.
  - fraud_patterns holds two kinds of pattern, differentiated by `patternType`:
    deterministic RULE patterns (evaluated in the agent) and HISTORICAL_SIMILARITY
    patterns carrying an `embedding` for Atlas Vector Search.
  - decision_traces holds ONE document per claim assessment, keyed by `traceId`
    (TRC-0001, sequential). The agent's assessment creates it; the human's verdict is
    later merged into that same document's `humanDecision` sub-document, so a single
    trace tells the whole story of one fraud decision.
"""

import logging
import os
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from bson import json_util
from pydantic import BaseModel, Field
from pymongo import ASCENDING, DESCENDING, MongoClient, UpdateOne
from pymongo.errors import BulkWriteError, PyMongoError

logger = logging.getLogger(__name__)


# =============================================================================
# Shared helpers
# =============================================================================


def _strip_id(doc: dict | None) -> dict | None:
    if doc is None:
        return None
    return {k: v for k, v in doc.items() if k != "_id"}


# =============================================================================
# Collection name constants
# =============================================================================

CUSTOMERS_COLLECTION = "customers"
POLICIES_COLLECTION = "policies"
CLAIMS_COLLECTION = "claims"
FRAUD_PATTERNS_COLLECTION = "fraud_patterns"
DECISION_TRACES_COLLECTION = "decision_traces"
# Holds the atomic sequence used to mint sequential traceIds (TRC-0001, TRC-0002, ...).
COUNTERS_COLLECTION = "counters"
TRACE_COUNTER_ID = "traceId"

# Name of the Atlas Vector Search index over fraud_patterns.embedding.
VECTOR_INDEX_NAME = os.environ.get("FRAUD_PATTERN_VECTOR_INDEX", "fraud_pattern_vector_index")
# Name of the Atlas Vector Search index over claims.embedding (claim-to-claim similarity).
CLAIM_VECTOR_INDEX_NAME = os.environ.get("CLAIM_VECTOR_INDEX", "claim_vector_index")
# Embedding dimensions must match the Voyage model used at query/seed time
# (voyage-3.5 = 1024, voyage-3.5-lite = 1024 by default). Keep this in sync with VOYAGE_MODEL.
# Claims and patterns share the same model, so the same dimension count applies to both.
VECTOR_DIMENSIONS = int(os.environ.get("FRAUD_PATTERN_VECTOR_DIMS", "1024"))

# data/ lives two levels above src/agent_insurance_fraud_agent/
_DATA_DIR = Path(__file__).parent.parent.parent / "data"

_SEED_MAP: dict[str, tuple] = {
    #  collection name              file name                 business key field
    CUSTOMERS_COLLECTION: ("customers.json", "customerId"),
    POLICIES_COLLECTION: ("policies.json", "policyId"),
    CLAIMS_COLLECTION: ("claims.json", "claimId"),
    FRAUD_PATTERNS_COLLECTION: ("fraud_patterns.json", "patternId"),
    DECISION_TRACES_COLLECTION: ("decision_traces.json", "traceId"),
}


# =============================================================================
# Pydantic models — used when creating new documents programmatically
# =============================================================================


class Customer(BaseModel):
    customer_id: str = Field(..., alias="customerId")
    first_name: str | None = Field(default=None, alias="firstName")
    last_name: str | None = Field(default=None, alias="lastName")
    date_of_birth: str | None = Field(default=None, alias="dateOfBirth")
    gender: str | None = Field(default=None)
    license_years: int | None = Field(default=None, alias="licenseYears")
    address: dict[str, Any] | None = Field(default=None)
    num_policies: int = Field(default=0, alias="numPolicies")
    num_previous_claims: int = Field(default=0, alias="numPreviousClaims")
    customer_since: str | None = Field(default=None, alias="customerSince")
    created_at: datetime | None = Field(default=None, alias="createdAt")
    updated_at: datetime | None = Field(default=None, alias="updatedAt")

    model_config = {"populate_by_name": True}


class Policy(BaseModel):
    policy_id: str = Field(..., alias="policyId")
    customer_id: str = Field(..., alias="customerId")
    policy_type: str = Field(..., alias="policyType")
    product_code: str | None = Field(default=None, alias="productCode")
    status: str = Field(default="ACTIVE")
    jurisdiction: dict[str, Any] | None = Field(default=None)
    effective_period: dict[str, Any] = Field(default_factory=dict, alias="effectivePeriod")
    parties: list[dict[str, Any]] = Field(default_factory=list)
    vehicle: dict[str, Any] | None = Field(default=None)
    coverages: list[dict[str, Any]] = Field(default_factory=list)
    premium: dict[str, Any] | None = Field(default=None)
    billing: dict[str, Any] | None = Field(default=None)
    agent_id: str | None = Field(default=None, alias="agentId")
    agency_id: str | None = Field(default=None, alias="agencyId")
    channel: str | None = Field(default=None)
    trace_anchor: dict[str, Any] | None = Field(default=None, alias="traceAnchor")
    created_at: datetime | None = Field(default=None, alias="createdAt")
    updated_at: datetime | None = Field(default=None, alias="updatedAt")

    model_config = {"populate_by_name": True}


class Claim(BaseModel):
    claim_id: str = Field(..., alias="claimId")
    policy_id: str = Field(..., alias="policyId")
    customer_id: str = Field(..., alias="customerId")
    claim_date: datetime | None = Field(default=None, alias="claimDate")
    report_date: datetime | None = Field(default=None, alias="reportDate")
    delay_days: int | None = Field(default=None, alias="delayDays")
    accident_time: str | None = Field(default=None, alias="accidentTime")
    accident_location: dict[str, Any] | None = Field(default=None, alias="accidentLocation")
    claim_type: str = Field(..., alias="claimType")
    coverage_type: str | None = Field(default=None, alias="coverageType")
    claim_amount: float = Field(default=0.0, alias="claimAmount")
    paid_amount: float = Field(default=0.0, alias="paidAmount")
    claim_status: str = Field(default="OPEN", alias="claimStatus")
    police_report: bool | None = Field(default=None, alias="policeReport")
    witness_count: int | None = Field(default=None, alias="witnessCount")
    repair_shop: str | None = Field(default=None, alias="repairShop")
    adjuster_id: str | None = Field(default=None, alias="adjusterId")
    payment_method: str | None = Field(default=None, alias="paymentMethod")
    channel: str | None = Field(default=None)
    policy_snapshot: dict[str, Any] | None = Field(default=None, alias="policySnapshot")
    driver_snapshot: dict[str, Any] | None = Field(default=None, alias="driverSnapshot")
    vehicle_snapshot: dict[str, Any] | None = Field(default=None, alias="vehicleSnapshot")
    customer_snapshot: dict[str, Any] | None = Field(default=None, alias="customerSnapshot")
    fraud: dict[str, Any] = Field(
        default_factory=lambda: {
            "computedScore": None,  # min(rawScore, 12) — agent-computed
            "rawScore": None,  # uncapped sum of matched pattern weights
            "matchedPatterns": [],  # [{patternId, patternName, weight}]
            "similarClaims": [],  # [{claimId, similarity, fraudFlag, ...}] cited precedents
            "processed": False,  # true once assessed or decided
            "processedAt": None,  # when the claim entered the review queue
            "fraudFlag": None,  # human confirm/dismiss label
            "flagSource": None,
            "reviewedBy": None,
            "reviewedAt": None,
            "siuReferred": False,
            "dismissReason": None,
        }
    )
    complexity: str | None = Field(default=None)
    description: str | None = Field(default=None)  # free-text loss narrative (embedded)
    embedding: list[float] | None = Field(default=None)  # voyage-3.5 vector of description
    created_at: datetime | None = Field(default=None, alias="createdAt")
    updated_at: datetime | None = Field(default=None, alias="updatedAt")

    model_config = {"populate_by_name": True}


class FraudPattern(BaseModel):
    pattern_id: str = Field(..., alias="patternId")
    pattern_type: str = Field(..., alias="patternType")  # RULE | HISTORICAL_SIMILARITY
    name: str = Field(...)
    description: str | None = Field(default=None)
    applies_to: dict[str, Any] | None = Field(default=None, alias="appliesTo")
    rule_logic: dict[str, Any] | None = Field(default=None, alias="ruleLogic")
    embedding_text: str | None = Field(default=None, alias="embeddingText")
    embedding: list[float] | None = Field(default=None)
    example_claim_ids: list[str] = Field(default_factory=list, alias="exampleClaimIds")
    severity: str | None = Field(default=None)
    weight: float = Field(default=0.0)
    active: bool = Field(default=True)
    stats: dict[str, Any] = Field(
        default_factory=lambda: {"timesTriggered": 0, "confirmedFraudRate": 0.0}
    )
    created_at: datetime | None = Field(default=None, alias="createdAt")
    updated_at: datetime | None = Field(default=None, alias="updatedAt")

    model_config = {"populate_by_name": True}


class HumanDecision(BaseModel):
    """The analyst's verdict, merged into the assessment trace when they decide."""

    decision: str  # CONFIRMED_FRAUD | DISMISSED
    decided_by: str | None = Field(default=None, alias="decidedBy")
    decided_at: datetime | None = Field(default=None, alias="decidedAt")
    reasoning: str | None = Field(default=None)
    siu_referred: bool = Field(default=False, alias="siuReferred")

    model_config = {"populate_by_name": True}


class DecisionTrace(BaseModel):
    """One audit document per claim assessment.

    Field order below mirrors the canonical document layout. `humanDecision` starts as
    null and is filled in later by `DecisionTraceStore.set_human_decision`, so the trace
    always tells the whole story of one fraud decision in one place.

    `contextSnapshot` / `steps` / `outcome` are the detailed evidence appendix: the claim
    state at assessment time, the per-pattern "why" (including similarity scores), and the
    proposal the agent put to the human.
    """

    trace_id: str = Field(..., alias="traceId")
    claim_id: str = Field(..., alias="claimId")
    customer_id: str | None = Field(default=None, alias="customerId")
    policy_id: str | None = Field(default=None, alias="policyId")
    trigger_type: str = Field(default="SINGLE_CLAIM", alias="triggerType")
    batch_id: str | None = Field(default=None, alias="batchId")
    triggered_by: str | None = Field(default=None, alias="triggeredBy")
    triggered_at: datetime | None = Field(default=None, alias="triggeredAt")
    matched_patterns: list[dict[str, Any]] = Field(
        default_factory=list, alias="matchedPatterns"
    )  # [{patternId, patternName, weight}]
    similar_claims: list[dict[str, Any]] = Field(
        default_factory=list, alias="similarClaims"
    )  # claim-to-claim precedents cited in the assessment
    raw_score: int = Field(default=0, alias="rawScore")
    computed_score: int = Field(default=0, alias="computedScore")
    agent_summary: str | None = Field(default=None, alias="agentSummary")
    human_decision: HumanDecision | None = Field(default=None, alias="humanDecision")
    context_snapshot: dict[str, Any] | None = Field(default=None, alias="contextSnapshot")
    steps: list[dict[str, Any]] = Field(default_factory=list)
    outcome: dict[str, Any] | None = Field(default=None)
    created_at: datetime | None = Field(default=None, alias="createdAt")

    model_config = {"populate_by_name": True}


# =============================================================================
# Store classes
# =============================================================================


class CustomerStore:
    """MongoDB-backed store for customer (policyholder) documents."""

    def __init__(self, client: MongoClient, database: str) -> None:
        self._col = client[database][CUSTOMERS_COLLECTION]
        self._col.create_index("customerId", unique=True)
        self._col.create_index("lastName")
        self._col.create_index("firstName")
        self._col.create_index("address.region")
        self._col.create_index("address.state")

    def read(self, customer_id: str) -> dict | None:
        return _strip_id(self._col.find_one({"customerId": customer_id}, {"_id": 0}))

    def list_all(self) -> list[dict]:
        return [_strip_id(d) for d in self._col.find({}, {"_id": 0}).sort("customerId", ASCENDING)]

    def list_by_name(self, first_name: str = "", last_name: str = "") -> list[dict]:
        query: dict[str, Any] = {}
        if first_name:
            query["firstName"] = {"$regex": f"^{re.escape(first_name)}$", "$options": "i"}
        if last_name:
            query["lastName"] = {"$regex": f"^{re.escape(last_name)}$", "$options": "i"}
        if not query:
            return []
        return [
            _strip_id(d) for d in self._col.find(query, {"_id": 0}).sort("customerId", ASCENDING)
        ]

    def list_filtered(self, region: str = "", state: str = "") -> list[dict]:
        query: dict[str, Any] = {}
        if region:
            query["address.region"] = region
        if state:
            query["address.state"] = state
        return [
            _strip_id(d) for d in self._col.find(query, {"_id": 0}).sort("customerId", ASCENDING)
        ]


class PolicyStore:
    """MongoDB-backed store for insurance policy documents."""

    def __init__(self, client: MongoClient, database: str) -> None:
        self._col = client[database][POLICIES_COLLECTION]
        self._col.create_index("policyId", unique=True)
        self._col.create_index("customerId")
        self._col.create_index("status")
        self._col.create_index("policyType")

    def read(self, policy_id: str) -> dict | None:
        return _strip_id(self._col.find_one({"policyId": policy_id}, {"_id": 0}))

    def list_all(self) -> list[dict]:
        return [_strip_id(d) for d in self._col.find({}, {"_id": 0}).sort("policyId", ASCENDING)]

    def list_by_customer(self, customer_id: str) -> list[dict]:
        return [_strip_id(d) for d in self._col.find({"customerId": customer_id}, {"_id": 0})]

    def list_by_status(self, status: str) -> list[dict]:
        return [_strip_id(d) for d in self._col.find({"status": status}, {"_id": 0})]


class ClaimStore:
    """MongoDB-backed store for insurance claim documents (the agent's unit of work)."""

    def __init__(self, client: MongoClient, database: str) -> None:
        self._col = client[database][CLAIMS_COLLECTION]
        self._col.create_index("claimId", unique=True)
        self._col.create_index("policyId")
        self._col.create_index("customerId")
        self._col.create_index("claimStatus")
        self._col.create_index("complexity")
        self._col.create_index("fraud.computedScore")
        self._col.create_index("fraud.fraudFlag")
        self._col.create_index("claimType")
        self._ensure_vector_index()

    def _ensure_vector_index(self) -> None:
        """Best-effort creation of the Atlas Vector Search index over claims.`embedding`.

        Silently no-ops if the index already exists or the cluster/tier does not support
        programmatic search-index creation — in that case create it once in the Atlas UI
        with the same name (see CLAIM_VECTOR_INDEX_NAME).
        """
        try:
            from pymongo.operations import SearchIndexModel

            existing = {ix.get("name") for ix in self._col.list_search_indexes()}
            if CLAIM_VECTOR_INDEX_NAME in existing:
                return
            model = SearchIndexModel(
                definition={
                    "fields": [
                        {
                            "type": "vector",
                            "path": "embedding",
                            "numDimensions": VECTOR_DIMENSIONS,
                            "similarity": "cosine",
                        }
                    ]
                },
                name=CLAIM_VECTOR_INDEX_NAME,
                type="vectorSearch",
            )
            self._col.create_search_index(model=model)
            logger.info("Requested Atlas Vector Search index '%s'", CLAIM_VECTOR_INDEX_NAME)
        except Exception as exc:  # noqa: BLE001 — index creation is best-effort
            logger.warning(
                "Could not auto-create vector index '%s' (%s). "
                "Create it manually in Atlas if claim similarity is needed.",
                CLAIM_VECTOR_INDEX_NAME,
                exc,
            )

    # ── Read ────────────────────────────────────────────────────────────────

    def read(self, claim_id: str) -> dict | None:
        return _strip_id(self._col.find_one({"claimId": claim_id}, {"_id": 0}))

    def list_all(self) -> list[dict]:
        return [_strip_id(d) for d in self._col.find({}, {"_id": 0}).sort("claimId", ASCENDING)]

    def list_by_policy(self, policy_id: str) -> list[dict]:
        return [_strip_id(d) for d in self._col.find({"policyId": policy_id}, {"_id": 0})]

    def list_by_customer(self, customer_id: str) -> list[dict]:
        return [_strip_id(d) for d in self._col.find({"customerId": customer_id}, {"_id": 0})]

    def list_filtered(self, status: str = "", complexity: str = "") -> list[dict]:
        query: dict[str, Any] = {}
        if status:
            query["claimStatus"] = status
        if complexity:
            query["complexity"] = complexity
        return [_strip_id(d) for d in self._col.find(query, {"_id": 0}).sort("claimId", ASCENDING)]

    def list_review_queue(self, min_score: int = 4, unreviewed_only: bool = True) -> list[dict]:
        query: dict[str, Any] = {"fraud.computedScore": {"$gte": min_score}}
        if unreviewed_only:
            query["fraud.fraudFlag"] = None
        return [
            _strip_id(d)
            for d in self._col.find(query, {"_id": 0}).sort("fraud.computedScore", DESCENDING)
        ]

    def list_needing_embedding(self) -> list[dict]:
        """Claims that have a description but no usable embedding yet (for backfill)."""
        query = {
            "description": {"$exists": True, "$ne": ""},
            "$or": [
                {"embedding": {"$exists": False}},
                {"embedding": {"$eq": []}},
                {"embedding": None},
            ],
        }
        return [_strip_id(d) for d in self._col.find(query, {"_id": 0, "embedding": 0})]

    def vector_search(
        self,
        embedding: list[float],
        k: int = 5,
        exclude_claim_id: str | None = None,
        claim_type: str | None = None,
        adjudicated_only: bool = True,
    ) -> list[dict]:
        """Atlas $vectorSearch for claims similar to `embedding` (claim-to-claim similarity).

        Post-filters the ANN candidates: excludes the subject claim, optionally restricts to
        one `claim_type`, and (by default) keeps only adjudicated "historical" claims (CLOSED /
        DENIED, or carrying a human fraud decision). Returns up to `k` claims (without their raw
        embedding) plus a `similarity` score in [0, 1]. Empty list if search is unavailable.
        """
        match: dict[str, Any] = {}
        if exclude_claim_id:
            match["claimId"] = {"$ne": exclude_claim_id}
        if claim_type:
            match["claimType"] = claim_type
        if adjudicated_only:
            # "Historical/adjudicated" = anything not still OPEN, or that already carries a
            # human fraud decision (robust to the exact closed-status spelling, e.g.
            # CLOSED / CLOSED_DENIED).
            match["$or"] = [
                {"claimStatus": {"$ne": "OPEN"}},
                {"fraud.fraudFlag": {"$ne": None}},
            ]

        # Pull a generous candidate pool, then post-filter and trim to k (a single $project
        # cannot mix exclusion with the added similarity field, so use $addFields first).
        pipeline: list[dict[str, Any]] = [
            {
                "$vectorSearch": {
                    "index": CLAIM_VECTOR_INDEX_NAME,
                    "path": "embedding",
                    "queryVector": embedding,
                    "numCandidates": max(k * 40, 200),
                    "limit": max(k * 20, 100),
                }
            },
        ]
        if match:
            pipeline.append({"$match": match})
        pipeline += [
            {"$addFields": {"similarity": {"$meta": "vectorSearchScore"}}},
            {"$project": {"_id": 0, "embedding": 0}},
            {"$limit": k},
        ]
        try:
            return list(self._col.aggregate(pipeline))
        except PyMongoError as exc:
            logger.warning("Claim vector search failed (%s); returning no matches.", exc)
            return []

    # ── Write ───────────────────────────────────────────────────────────────

    def set_embedding(self, claim_id: str, embedding: list[float]) -> dict | None:
        """Store the description embedding on a claim (used at write time and by backfill)."""
        result = self._col.find_one_and_update(
            {"claimId": claim_id},
            {"$set": {"embedding": embedding, "updatedAt": datetime.now(UTC)}},
            return_document=True,
        )
        return _strip_id(result)

    def write(self, claim: Claim) -> dict:
        now = datetime.now(UTC)
        doc = claim.model_dump(by_alias=True, exclude_none=True)
        doc.setdefault("createdAt", now)
        doc["updatedAt"] = now
        self._col.insert_one(doc)
        return _strip_id(doc)  # type: ignore[return-value]

    def update(self, claim_id: str, updates: dict) -> dict | None:
        updates["updatedAt"] = datetime.now(UTC)
        result = self._col.find_one_and_update(
            {"claimId": claim_id},
            {"$set": updates},
            return_document=True,
        )
        return _strip_id(result)

    def set_fraud_assessment(
        self,
        claim_id: str,
        computed_score: int,
        raw_score: int,
        matched_patterns: list[dict[str, Any]],
        similar_claims: list[dict[str, Any]] | None = None,
        trace_id: str | None = None,
    ) -> dict | None:
        """Write the agent's complete assessment onto the claim.

        Persists `fraud.computedScore` (= min(rawScore, 12)), `fraud.rawScore`
        (uncapped sum), `fraud.matchedPatterns`, `fraud.similarClaims` (the
        claim-to-claim precedents cited in the assessment) and
        `fraud.lastTraceId`, and marks the claim `fraud.processed=true`.
        `processed` is what every reader keys the fraud status label on, so an
        assessment run from any entry point (button, chat, batch) shows up.

        `fraud.processedAt` is set only when absent: it records when the claim
        entered the review queue, and re-assessing must not reset that clock.
        Does NOT touch `complexity`, which is an independent triage dimension.
        """
        now = datetime.now(UTC)
        fields: dict[str, Any] = {
            "fraud.computedScore": computed_score,
            "fraud.rawScore": raw_score,
            "fraud.matchedPatterns": matched_patterns,
            "fraud.similarClaims": similar_claims or [],
            "fraud.processed": True,
            "fraud.assessedAt": now,
            "updatedAt": now,
        }
        if trace_id:
            fields["fraud.lastTraceId"] = trace_id
        # Pipeline update so processedAt can be written only if absent, atomically.
        # Values are $literal so a string starting with "$" is never read as a path.
        result = self._col.find_one_and_update(
            {"claimId": claim_id},
            [
                {"$set": {k: {"$literal": v} for k, v in fields.items()}},
                {"$set": {"fraud.processedAt": {"$ifNull": ["$fraud.processedAt", now]}}},
            ],
            return_document=True,
        )
        return _strip_id(result)

    def set_fraud_decision(
        self,
        claim_id: str,
        fraud_flag: bool,
        flag_source: str,
        reviewed_by: str,
        reviewed_at: datetime | None = None,
        siu_referred: bool = False,
        dismiss_reason: str | None = None,
        close_claim: bool = True,
    ) -> dict | None:
        """Write the human confirm/dismiss decision onto the claim, and close it.

        A human verdict means the claim has been through fraud review, so
        `fraud.processed` is set too. `fraud.processedAt` is written only if
        absent: a claim decided without an assessment starts and finishes now
        (zero-hour turnaround). With `close_claim` the decision also ends the
        claim's lifecycle: `claimStatus=CLOSED` and `closedAt`.
        """
        now = reviewed_at or datetime.now(UTC)
        fields: dict[str, Any] = {
            "fraud.fraudFlag": fraud_flag,
            "fraud.flagSource": flag_source,
            "fraud.reviewedBy": reviewed_by,
            "fraud.reviewedAt": now,
            "fraud.siuReferred": siu_referred,
            "fraud.dismissReason": dismiss_reason,
            "fraud.processed": True,
            "updatedAt": now,
        }
        if close_claim:
            fields["claimStatus"] = "CLOSED"
            fields["closedAt"] = now
        # Pipeline update so processedAt can be written only if absent, atomically.
        # Values are $literal so a string starting with "$" is never read as a path.
        result = self._col.find_one_and_update(
            {"claimId": claim_id},
            [
                {"$set": {k: {"$literal": v} for k, v in fields.items()}},
                {"$set": {"fraud.processedAt": {"$ifNull": ["$fraud.processedAt", now]}}},
            ],
            return_document=True,
        )
        return _strip_id(result)


class FraudPatternStore:
    """MongoDB-backed store for fraud patterns (RULE + HISTORICAL_SIMILARITY)."""

    def __init__(self, client: MongoClient, database: str) -> None:
        self._col = client[database][FRAUD_PATTERNS_COLLECTION]
        # Read-only here: pattern stats are recounted from the claims they matched.
        self._claims = client[database][CLAIMS_COLLECTION]
        self._col.create_index("patternId", unique=True)
        self._col.create_index("patternType")
        self._col.create_index("active")
        self._ensure_vector_index()

    def _ensure_vector_index(self) -> None:
        """Best-effort creation of the Atlas Vector Search index over `embedding`.

        Silently no-ops if the index already exists or the cluster/tier does not
        support programmatic search-index creation — in that case create it once
        in the Atlas UI with the same name (see VECTOR_INDEX_NAME).
        """
        try:
            from pymongo.operations import SearchIndexModel

            existing = {ix.get("name") for ix in self._col.list_search_indexes()}
            if VECTOR_INDEX_NAME in existing:
                return
            model = SearchIndexModel(
                definition={
                    "fields": [
                        {
                            "type": "vector",
                            "path": "embedding",
                            "numDimensions": VECTOR_DIMENSIONS,
                            "similarity": "cosine",
                        }
                    ]
                },
                name=VECTOR_INDEX_NAME,
                type="vectorSearch",
            )
            self._col.create_search_index(model=model)
            logger.info("Requested Atlas Vector Search index '%s'", VECTOR_INDEX_NAME)
        except Exception as exc:  # noqa: BLE001 — index creation is best-effort
            logger.warning(
                "Could not auto-create vector index '%s' (%s). "
                "Create it manually in Atlas if vector search is needed.",
                VECTOR_INDEX_NAME,
                exc,
            )

    # ── Read ────────────────────────────────────────────────────────────────

    def read(self, pattern_id: str) -> dict | None:
        return _strip_id(self._col.find_one({"patternId": pattern_id}, {"_id": 0}))

    def list_all(self) -> list[dict]:
        return [_strip_id(d) for d in self._col.find({}, {"_id": 0}).sort("patternId", ASCENDING)]

    def list_by_type(self, pattern_type: str) -> list[dict]:
        return [_strip_id(d) for d in self._col.find({"patternType": pattern_type}, {"_id": 0})]

    def list_active(self) -> list[dict]:
        """All active patterns (both RULE and HISTORICAL_SIMILARITY)."""
        return [_strip_id(d) for d in self._col.find({"active": True}, {"_id": 0})]

    def list_active_rules(self) -> list[dict]:
        return [
            _strip_id(d)
            for d in self._col.find({"patternType": "RULE", "active": True}, {"_id": 0})
        ]

    def vector_search(self, embedding: list[float], k: int = 5) -> list[dict]:
        """Atlas $vectorSearch over active HISTORICAL_SIMILARITY patterns.

        Returns matched patterns (without the raw embedding) plus a `similarity`
        score in [0, 1]. Returns an empty list if vector search is unavailable.
        """
        pipeline: list[dict[str, Any]] = [
            {
                "$vectorSearch": {
                    "index": VECTOR_INDEX_NAME,
                    "path": "embedding",
                    "queryVector": embedding,
                    "numCandidates": max(k * 20, 100),
                    "limit": k,
                }
            },
            {"$match": {"patternType": "HISTORICAL_SIMILARITY", "active": True}},
            # Capture the similarity score, then drop bulky fields. Two stages because a
            # single $project cannot mix field exclusion with an added computed field.
            {"$addFields": {"similarity": {"$meta": "vectorSearchScore"}}},
            {"$project": {"_id": 0, "embedding": 0}},
        ]
        try:
            return list(self._col.aggregate(pipeline))
        except PyMongoError as exc:
            logger.warning("Vector search failed (%s); returning no similarity matches.", exc)
            return []

    # ── Write ───────────────────────────────────────────────────────────────

    def recompute_stats(self, pattern_ids: list[str]) -> list[dict]:
        """Recount each pattern's stats from the claims it currently matches.

        Called once when an assessment or a decision is recorded, for the patterns it
        touched. Counting replaces incrementing, so the stats always equal the data:
        re-assessing or re-deciding a claim never double-counts, and a pattern a
        re-assessment dropped loses that claim.

          timesTriggered     = claims whose fraud.matchedPatterns include the pattern
          confirmedCount     = those claims confirmed as fraud (fraudFlag = true)
          confirmedFraudRate = confirmedCount / timesTriggered
        """
        updated = []
        for pattern_id in dict.fromkeys(p for p in pattern_ids if p):
            matched = {"fraud.matchedPatterns.patternId": pattern_id}
            times = self._claims.count_documents(matched)
            confirmed = self._claims.count_documents({**matched, "fraud.fraudFlag": True})
            stats = {
                "timesTriggered": times,
                "confirmedCount": confirmed,
                "confirmedFraudRate": round(confirmed / times, 4) if times else 0.0,
            }
            result = self._col.update_one(
                {"patternId": pattern_id},
                {"$set": {**{f"stats.{k}": v for k, v in stats.items()},
                          "updatedAt": datetime.now(UTC)}},
            )
            if result.matched_count:
                updated.append({"patternId": pattern_id, **stats})
        return updated

    def update(self, pattern_id: str, updates: dict) -> dict | None:
        updates["updatedAt"] = datetime.now(UTC)
        result = self._col.find_one_and_update(
            {"patternId": pattern_id},
            {"$set": updates},
            return_document=True,
        )
        return _strip_id(result)

class DecisionTraceStore:
    """Store for fraud decision traces — one document per claim assessment.

    The assessment inserts the trace; the human's verdict is merged into that same
    document via `set_human_decision`. Those are the only two writes: nothing else
    mutates a trace, and nothing deletes one.
    """

    def __init__(self, client: MongoClient, database: str) -> None:
        db = client[database]
        self._col = db[DECISION_TRACES_COLLECTION]
        self._counters = db[COUNTERS_COLLECTION]
        self._col.create_index("traceId", unique=True)
        self._col.create_index("claimId")
        self._col.create_index("customerId")
        self._col.create_index("policyId")
        self._col.create_index("triggerType")
        self._col.create_index("batchId")
        self._col.create_index("humanDecision.decision")
        self._col.create_index([("triggeredAt", DESCENDING)])
        self._init_counter()

    # ── Trace IDs ───────────────────────────────────────────────────────────

    def _init_counter(self) -> None:
        """Seed the traceId sequence from the highest existing TRC-nnnn, once.

        Keeps minted IDs from colliding with seeded fixture traces. Best-effort: if the
        counter cannot be initialised the sequence still works, it just starts at 1.
        """
        try:
            if self._counters.find_one({"_id": TRACE_COUNTER_ID}):
                return
            highest = 0
            for doc in self._col.find({"traceId": {"$regex": r"^TRC-\d+$"}}, {"traceId": 1}):
                match = re.match(r"^TRC-(\d+)$", doc.get("traceId", ""))
                if match:
                    highest = max(highest, int(match.group(1)))
            self._counters.update_one(
                {"_id": TRACE_COUNTER_ID}, {"$setOnInsert": {"seq": highest}}, upsert=True
            )
        except PyMongoError as exc:
            logger.warning("Could not initialise traceId counter (%s).", exc)

    def next_trace_id(self) -> str:
        """Mint the next sequential trace ID (TRC-0001, TRC-0002, ...) atomically."""
        doc = self._counters.find_one_and_update(
            {"_id": TRACE_COUNTER_ID},
            {"$inc": {"seq": 1}},
            upsert=True,
            return_document=True,
        )
        return f"TRC-{int((doc or {}).get('seq', 1)):04d}"

    # ── Read ────────────────────────────────────────────────────────────────

    def read(self, trace_id: str) -> dict | None:
        return _strip_id(self._col.find_one({"traceId": trace_id}, {"_id": 0}))

    def list_all(self) -> list[dict]:
        return [
            _strip_id(d) for d in self._col.find({}, {"_id": 0}).sort("triggeredAt", DESCENDING)
        ]

    def list_by_claim(self, claim_id: str) -> list[dict]:
        """All traces for a claim, oldest first (chronological, as reported to the human)."""
        return [
            _strip_id(d)
            for d in self._col.find({"claimId": claim_id}, {"_id": 0}).sort(
                "triggeredAt", ASCENDING
            )
        ]

    def latest_by_claim(self, claim_id: str, undecided_only: bool = False) -> dict | None:
        """The most recent trace for a claim; optionally only one still awaiting a verdict."""
        query: dict[str, Any] = {"claimId": claim_id}
        if undecided_only:
            query["humanDecision"] = None
        return _strip_id(self._col.find_one(query, {"_id": 0}, sort=[("triggeredAt", DESCENDING)]))

    # ── Write ───────────────────────────────────────────────────────────────

    def write(self, trace: DecisionTrace) -> dict:
        """Insert a new assessment trace.

        Dumps without `exclude_none` so unset fields persist as explicit nulls — an audit
        record should say "no batch" and "not yet decided" rather than omit the keys.
        """
        now = datetime.now(UTC)
        doc = trace.model_dump(by_alias=True)
        if doc.get("triggeredAt") is None:
            doc["triggeredAt"] = now
        if doc.get("createdAt") is None:
            doc["createdAt"] = now
        self._col.insert_one(doc)
        return _strip_id(doc)  # type: ignore[return-value]

    def set_human_decision(
        self,
        trace_id: str,
        decision: str,
        decided_by: str,
        decided_at: datetime | None = None,
        reasoning: str | None = None,
        siu_referred: bool = False,
    ) -> dict | None:
        """Merge the analyst's verdict into an existing assessment trace.

        `decision` is the canonical vocabulary: CONFIRMED_FRAUD or DISMISSED.
        """
        now = decided_at or datetime.now(UTC)
        human = HumanDecision(
            decision=decision,
            decidedBy=decided_by,
            decidedAt=now,
            reasoning=reasoning,
            siuReferred=siu_referred,
        ).model_dump(by_alias=True)
        result = self._col.find_one_and_update(
            {"traceId": trace_id},
            {
                "$set": {
                    "humanDecision": human,
                    "outcome.finalDecision": decision,
                    "outcome.decidedAt": now,
                }
            },
            return_document=True,
            projection={"_id": 0},
        )
        return _strip_id(result)


# =============================================================================
# Seed helper — loads JSON fixtures into MongoDB on startup (idempotent)
# =============================================================================


def _seed_collection(col, docs: list[dict], key_field: str) -> None:
    if not docs:
        return
    ops = [
        UpdateOne({key_field: doc[key_field]}, {"$setOnInsert": doc}, upsert=True)
        for doc in docs
        if key_field in doc
    ]
    if not ops:
        return
    try:
        result = col.bulk_write(ops, ordered=False)
        logger.info(
            "Seeded %s — upserted: %d, matched: %d",
            col.name,
            result.upserted_count,
            result.matched_count,
        )
    except BulkWriteError as bwe:
        logger.warning("Seed bulk write partial error for %s: %s", col.name, bwe.details)


# =============================================================================
# Store registry — single MongoClient shared across all stores
# =============================================================================


class FraudStoreRegistry:
    """Holds one MongoClient and exposes all collection stores."""

    def __init__(
        self,
        mongodb_uri: str,
        database: str = "insurance_fraud_agent",
        seed: bool = True,
    ) -> None:
        self._client = MongoClient(mongodb_uri, serverSelectionTimeoutMS=5000)
        self._database = database
        self._db = self._client[database]

        self.customers = CustomerStore(self._client, database)
        self.policies = PolicyStore(self._client, database)
        self.claims = ClaimStore(self._client, database)
        self.fraud_patterns = FraudPatternStore(self._client, database)
        self.decision_traces = DecisionTraceStore(self._client, database)

        if seed:
            self.seed_from_json()

    def seed_from_json(self, data_dir: Path | None = None) -> None:
        """Load all JSON seed files into MongoDB using idempotent upserts."""
        base = Path(data_dir) if data_dir else _DATA_DIR
        for collection_name, (filename, key_field) in _SEED_MAP.items():
            path = base / filename
            if not path.exists():
                logger.warning("Seed file not found, skipping: %s", path)
                continue
            try:
                raw = path.read_text(encoding="utf-8")
                docs = json_util.loads(raw)
                if not isinstance(docs, list):
                    docs = [docs]
                _seed_collection(self._db[collection_name], docs, key_field)
            except Exception as exc:  # noqa: BLE001
                logger.error("Failed to seed %s from %s: %s", collection_name, path, exc)


# =============================================================================
# Factory — called from main.py at startup
# =============================================================================


def create_store_registry(
    mongodb_uri: str,
    database: str = "insurance_fraud_agent",
    seed: bool = True,
) -> FraudStoreRegistry | None:
    """Create FraudStoreRegistry if MongoDB is configured; return None otherwise."""
    logger.info("Creating FraudStoreRegistry: database=%s", database)
    if not mongodb_uri:
        logger.warning("MONGODB_URI not set — store registry unavailable.")
        return None
    try:
        return FraudStoreRegistry(mongodb_uri, database, seed=seed)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to create FraudStoreRegistry: %s", exc)
        return None
