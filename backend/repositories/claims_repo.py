"""Every `claims` collection query lives here as a named method.

Phase 4's agent tools are expected to call these same methods (notably
`get_by_id`) rather than growing a second copy of the same $lookup.
"""

from datetime import datetime, timezone
from typing import Any

from pymongo import ASCENDING, DESCENDING

from core.config import get_settings
from db.mdb import MongoDBConnector

# Status filter -> the Mongo predicate that defines it. PENDING_REVIEW means
# the agent has scored the claim but no human has decided yet.
# Mutually exclusive by construction, in the same precedence the stats facet and
# the frontend's toStatusKey use: a fraud flag wins over an unprocessed flag.
# Without the extra clauses these overlapped, so filtering by "not yet analyzed"
# returned claims the stat card counted as flagged.
STATUS_MATCHES: dict[str, dict] = {
    "UNPROCESSED": {"fraud.fraudFlag": {"$ne": True}, "fraud.processed": {"$ne": True}},
    "PENDING_REVIEW": {"fraud.processed": True, "fraud.fraudFlag": None},
    "FLAGGED": {"fraud.fraudFlag": True},
    "CLEARED": {"fraud.processed": True, "fraud.fraudFlag": False},
    "ALL": {},
}

LIST_PROJECTION = {
    "_id": 0,
    "claimId": 1,
    "claimType": 1,
    "coverageType": 1,
    "claimDate": 1,
    "claimAmount": 1,
    "claimStatus": 1,
    "complexity": 1,
    "customerName": {"$concat": ["$customer.firstName", " ", "$customer.lastName"]},
    "processed": "$fraud.processed",
    "computedScore": "$fraud.computedScore",
    "fraudFlag": "$fraud.fraudFlag",
}


# The pending queue needs the two fields the list projection deliberately omits
# to stay lean: when it was scored, and which patterns matched.
PENDING_PROJECTION = {
    "_id": 0,
    "claimId": 1,
    "coverageType": 1,
    "customerName": {"$concat": ["$customer.firstName", " ", "$customer.lastName"]},
    "computedScore": "$fraud.computedScore",
    "scoredAt": "$fraud.scoredAt",
    "matchedPatterns": "$fraud.matchedPatterns",
    # Lets the caller tell the two kinds of pending work apart: an unanalysed
    # claim needs an assessment, a scored one needs a decision.
    "processed": "$fraud.processed",
    "claimDate": 1,
}

# Everything waiting on a human, which is two different states:
#
#   * never analysed        — needs the agent run
#   * scored, no decision   — needs a confirm/dismiss
#
# Both are "pending your review" in the sense that matters: nobody has finished
# with them. Restricting the queue to the second state left it permanently empty,
# because an assessment and its decision happen in one sitting in the analysis
# modal — a claim almost never rests in "scored but undecided".
PENDING_MATCH = {
    "$or": [
        {"fraud.processed": {"$ne": True}},
        {"fraud.processed": True, "fraud.fraudFlag": None},
    ]
}

# Everything a human has actually ruled on, either way. `fraudFlag` is tri-state
# (true / false / null-meaning-undecided), so "decided" is the absence of null
# rather than a truthiness test — `{"$ne": None}` would also be wrong here if it
# were spelled as `{"$exists": True}`, since the seed data stores an explicit null.
DECIDED_MATCH = {"fraud.fraudFlag": {"$in": [True, False]}}

# The single definition of which bucket a claim falls into, as a $switch that can
# be dropped into any pipeline. Extracted from `list_with_stats` so the fraud-rate
# breakdown cannot drift from the stat cards: both classify a claim exactly once,
# in the same precedence the frontend's claimsPresenter.toStatusKey uses.
STATUS_BUCKET_SWITCH = {
    "$switch": {
        "branches": [
            {"case": {"$eq": ["$fraud.fraudFlag", True]}, "then": "flagged"},
            {"case": {"$ne": ["$fraud.processed", True]}, "then": "unprocessed"},
            {"case": {"$eq": ["$fraud.fraudFlag", False]}, "then": "cleared"},
        ],
        "default": "pending",
    }
}

# Counts per bucket, for use inside a $group that has already $addFields'd
# `_bucket` from STATUS_BUCKET_SWITCH above.
BUCKET_COUNT_ACCUMULATORS = {
    name: {"$sum": {"$cond": [{"$eq": ["$_bucket", name]}, 1, 0]}}
    for name in ("flagged", "cleared", "pending", "unprocessed")
}

# Claim-level dimensions are a plain field path; the two bucketed dimensions need
# a $bucket stage and are handled separately in `bucketed_fraud_rate`.
BREAKDOWN_FIELDS = {
    "complexity": "$complexity",
    "coverageType": "$coverageType",
    "claimType": "$claimType",
}

# Fixed boundaries, deliberately hardcoded rather than parameterised: the whole
# point of a correlation table is that the same buckets are comparable across
# runs, and a caller-supplied boundary set would make two answers to the same
# question disagree. The top band is open-ended.
CLAIM_AMOUNT_BOUNDARIES = [0, 2500, 5000, 10000, 20000]
CUSTOMER_TENURE_BOUNDARIES = [0, 1, 3, 5, 10]

# Which claim field identifies each repeat-entity lens.
REPEAT_ENTITY_FIELDS = {
    "customer": "$customerId",
    "repairShop": "$repairShop",
    "adjuster": "$adjusterId",
}


def parse_sort(sort: str) -> tuple[str, int]:
    """Turn a `-field` / `field` sort token into a (field, direction) pair."""
    if sort.startswith("-"):
        return sort[1:], DESCENDING
    return sort.lstrip("+"), ASCENDING


class ClaimsRepository:
    """Data access for the claims collection."""

    def __init__(self, db: MongoDBConnector):
        self.db = db
        self.collection_name = get_settings().CLAIMS_COLLECTION
        self.collection = db.get_collection(self.collection_name)

    # ---------------------------------------------------------------- reads

    def list_with_stats(
        self,
        complexity: str = "ALL",
        status: str = "ALL",
        page: int = 1,
        limit: int = 25,
        sort: str = "-claimDate",
    ) -> dict[str, Any]:
        """One $facet: segment-wide stats, the filtered page, and its count.

        `stats` is deliberately computed over the segment only (before the
        status filter) so the stat cards keep showing the whole segment while
        the table below is filtered.
        """
        segment_match = {} if complexity == "ALL" else {"complexity": complexity}
        status_match = STATUS_MATCHES[status]
        sort_field, sort_dir = parse_sort(sort)

        pipeline = [
            {"$match": segment_match},
            {"$facet": {
                # Each claim is classified into exactly one bucket, then
                # counted — rather than four independent $sum conditions, which
                # double-counted any claim whose flags disagreed (a claim with
                # processed=false and fraudFlag=true landed in both
                # `unprocessed` and `flagged`, so the buckets summed to more
                # than `total` and the dashboard donut overflowed its circle).
                # The branch order mirrors the frontend's per-row precedence in
                # claimsPresenter.toStatusKey, so a status card can never
                # disagree with the rows in the table beneath it.
                "stats": [
                    {"$project": {"bucket": STATUS_BUCKET_SWITCH}},
                    {"$group": {"_id": "$bucket", "n": {"$sum": 1}}},
                ],
                "rows": [
                    {"$match": status_match},
                    {"$sort": {sort_field: sort_dir}},
                    {"$skip": (page - 1) * limit},
                    {"$limit": limit},
                    {"$lookup": {
                        "from": get_settings().CUSTOMERS_COLLECTION,
                        "localField": "customerId",
                        "foreignField": "customerId",
                        "as": "customer",
                    }},
                    {"$unwind": "$customer"},
                    {"$project": LIST_PROJECTION},
                ],
                "count": [{"$match": status_match}, {"$count": "n"}],
            }},
        ]

        facet = next(iter(self.collection.aggregate(pipeline)), {})
        # One row per non-empty bucket; absent buckets are legitimately zero.
        counts = {row["_id"]: row["n"] for row in (facet.get("stats") or [])}
        return {
            "stats": {
                # Summed from the buckets rather than counted separately, so
                # `total` and the four parts cannot contradict each other.
                "total": sum(counts.values()),
                "unprocessed": counts.get("unprocessed", 0),
                # The shared $switch names this bucket "pending"; the response key
                # stays "pendingReview" because the frontend reads that name.
                "pendingReview": counts.get("pending", 0),
                "flagged": counts.get("flagged", 0),
                "cleared": counts.get("cleared", 0),
            },
            "rows": facet.get("rows", []),
            "count": (facet.get("count") or [{}])[0].get("n", 0),
        }

    def find_pending_review(self, limit: int = 10) -> tuple[list[dict[str, Any]], int]:
        """Everything still waiting on a human, worst-first, plus the queue count.

        Scored claims come before unanalysed ones and are ordered by score: the
        queue is meant to be worked top-down, and a claim the agent has already
        called a 10 is more urgent than one nobody has looked at. Within the
        unanalysed group the newest claim leads, since there is no score to rank
        them by and recency is the only signal available.

        `$ifNull` is what puts the two groups in that order — an unscored claim
        sorts as -1 rather than as null, which MongoDB would otherwise order
        above 0.
        """
        pipeline = [
            {"$match": PENDING_MATCH},
            {"$addFields": {"_sortScore": {"$ifNull": ["$fraud.computedScore", -1]}}},
            {"$sort": {"_sortScore": -1, "claimDate": -1}},
            {"$limit": limit},
            {"$lookup": {
                "from": get_settings().CUSTOMERS_COLLECTION,
                "localField": "customerId",
                "foreignField": "customerId",
                "as": "customer",
            }},
            # preserveNull so a claim with a missing customer still appears —
            # dropping it would understate the queue.
            {"$unwind": {"path": "$customer", "preserveNullAndEmptyArrays": True}},
            {"$project": PENDING_PROJECTION},
        ]
        rows = list(self.collection.aggregate(pipeline))
        total = self.collection.count_documents(PENDING_MATCH)
        return rows, total

    def get_by_id(self, claim_id: str) -> dict[str, Any] | None:
        """A claim merged with its policy and customer, or None."""
        settings = get_settings()
        pipeline = [
            {"$match": {"claimId": claim_id}},
            {"$lookup": {
                "from": settings.POLICIES_COLLECTION,
                "localField": "policyId",
                "foreignField": "policyId",
                "as": "policy",
            }},
            {"$unwind": {"path": "$policy", "preserveNullAndEmptyArrays": True}},
            {"$lookup": {
                "from": settings.CUSTOMERS_COLLECTION,
                "localField": "customerId",
                "foreignField": "customerId",
                "as": "customer",
            }},
            {"$unwind": {"path": "$customer", "preserveNullAndEmptyArrays": True}},
        ]
        return next(iter(self.collection.aggregate(pipeline)), None)

    def get_raw(self, claim_id: str) -> dict[str, Any] | None:
        """The claim document alone, no joins — for business-rule checks."""
        return self.collection.find_one({"claimId": claim_id})

    def find_linked(self, claim: dict[str, Any], limit: int = 10) -> list[dict[str, Any]]:
        """Other claims sharing a customer, a repair shop, or a fraud pattern."""
        matched_ids = [
            p["patternId"]
            for p in (claim.get("fraud") or {}).get("matchedPatterns", [])
            if p.get("patternId")
        ]

        or_clauses: list[dict] = [{"customerId": claim["customerId"]}]
        if claim.get("repairShop"):
            or_clauses.append({"repairShop": claim["repairShop"]})
        if matched_ids:
            or_clauses.append({"fraud.matchedPatterns.patternId": {"$in": matched_ids}})

        pipeline = [
            {"$match": {"$and": [
                {"claimId": {"$ne": claim["claimId"]}},
                {"$or": or_clauses},
            ]}},
            {"$limit": limit},
            {"$lookup": {
                "from": get_settings().CUSTOMERS_COLLECTION,
                "localField": "customerId",
                "foreignField": "customerId",
                "as": "customer",
            }},
            {"$unwind": {"path": "$customer", "preserveNullAndEmptyArrays": True}},
            {"$project": {
                "_id": 0,
                "claimId": 1,
                "claimDate": 1,
                "customerId": 1,
                "repairShop": 1,
                "customerName": {"$concat": ["$customer.firstName", " ", "$customer.lastName"]},
                "computedScore": "$fraud.computedScore",
                "fraudFlag": "$fraud.fraudFlag",
                "matchedPatterns": "$fraud.matchedPatterns",
            }},
        ]
        return list(self.collection.aggregate(pipeline))

    def find_for_batch(self, claim_ids: list[str]) -> dict[str, dict[str, Any]]:
        """Fetch only the fields batch validation needs, keyed by claimId."""
        cursor = self.collection.find(
            {"claimId": {"$in": claim_ids}},
            {"_id": 0, "claimId": 1, "complexity": 1, "fraud.processed": 1},
        )
        return {doc["claimId"]: doc for doc in cursor}

    def find_by_pattern(self, pattern_id: str, limit: int = 200) -> list[dict[str, Any]]:
        """Claims whose fraud assessment matched a given pattern, worst first."""
        pipeline = [
            {"$match": {"fraud.matchedPatterns.patternId": pattern_id}},
            {"$sort": {"fraud.computedScore": DESCENDING}},
            {"$limit": limit},
            {"$lookup": {
                "from": get_settings().CUSTOMERS_COLLECTION,
                "localField": "customerId",
                "foreignField": "customerId",
                "as": "customer",
            }},
            {"$unwind": {"path": "$customer", "preserveNullAndEmptyArrays": True}},
            {"$project": {
                "_id": 0,
                "claimId": 1,
                "claimDate": 1,
                "customerName": {"$concat": ["$customer.firstName", " ", "$customer.lastName"]},
                "computedScore": "$fraud.computedScore",
                "fraudFlag": "$fraud.fraudFlag",
            }},
        ]
        return list(self.collection.aggregate(pipeline))

    # ------------------------------------------------------------ portfolio

    def trend_by_bucket(
        self,
        date_from: datetime,
        date_to: datetime,
        unit: str = "week",
    ) -> list[dict[str, Any]]:
        """Claim outcomes per time bucket, oldest bucket first."""
        pipeline = [
            {"$match": {"claimDate": {"$gte": date_from, "$lte": date_to}}},
            {"$group": {
                "_id": {"$dateTrunc": {"date": "$claimDate", "unit": unit}},
                "flagged": {"$sum": {"$cond": [{"$eq": ["$fraud.fraudFlag", True]}, 1, 0]}},
                "cleared": {"$sum": {"$cond": [{"$eq": ["$fraud.fraudFlag", False]}, 1, 0]}},
                "pending": {"$sum": {"$cond": [
                    {"$and": [
                        {"$eq": ["$fraud.processed", True]},
                        {"$eq": ["$fraud.fraudFlag", None]},
                    ]}, 1, 0]}},
                "unprocessed": {"$sum": {"$cond": [{"$eq": ["$fraud.processed", False]}, 1, 0]}},
            }},
            {"$sort": {"_id": ASCENDING}},
            {"$project": {
                "_id": 0,
                "bucket": "$_id",
                "flagged": 1,
                "cleared": 1,
                "pending": 1,
                "unprocessed": 1,
            }},
        ]
        return list(self.collection.aggregate(pipeline))

    def score_distribution(self, boundaries: list[int]) -> list[dict[str, Any]]:
        """Histogram of computedScore over scored claims only.

        Boundaries span 0..12 because computedScore is capped at 12 by the
        scoring step, even though the raw pre-cap score can run higher.
        """
        pipeline = [
            {"$match": {"fraud.processed": True, "fraud.computedScore": {"$ne": None}}},
            {"$bucket": {
                "groupBy": "$fraud.computedScore",
                "boundaries": boundaries,
                "default": "other",
                "output": {"count": {"$sum": 1}},
            }},
        ]
        return list(self.collection.aggregate(pipeline))

    def overall_decision_counts(self) -> dict[str, int]:
        """Flagged/cleared totals across the *whole* portfolio, undated."""
        pipeline = [
            {"$group": {
                "_id": None,
                "flagged": {"$sum": {"$cond": [{"$eq": ["$fraud.fraudFlag", True]}, 1, 0]}},
                "cleared": {"$sum": {"$cond": [{"$eq": ["$fraud.fraudFlag", False]}, 1, 0]}},
            }},
        ]
        row = next(iter(self.collection.aggregate(pipeline)), {})
        return {"flagged": row.get("flagged", 0), "cleared": row.get("cleared", 0)}

    # ---------------------------------------------------------------- graph

    def find_graph_candidates(self, scope: str = "ALL", limit: int = 60) -> list[dict[str, Any]]:
        """The bounded candidate set the relationship graph is built from.

        Only the fields the pairing logic needs are returned; the pairing
        itself is done in the service, in Python.
        """
        scope_matches = {
            "ALL": {},
            "FLAGGED": {"fraud.fraudFlag": True},
            "PENDING": {"fraud.processed": True, "fraud.fraudFlag": None},
        }
        pipeline = [
            {"$match": scope_matches[scope]},
            {"$sort": {"fraud.processed": DESCENDING, "updatedAt": DESCENDING}},
            {"$limit": limit},
            {"$project": {
                "_id": 0,
                "claimId": 1,
                "customerId": 1,
                "repairShop": 1,
                "computedScore": "$fraud.computedScore",
                "fraudFlag": "$fraud.fraudFlag",
                "matchedPatterns": {"$ifNull": ["$fraud.matchedPatterns", []]},
            }},
        ]
        return list(self.collection.aggregate(pipeline))

    # ---------------------------------------------------- fraud-rate breakdown

    def fraud_rate_breakdown(self, dimension: str) -> list[dict[str, Any]]:
        """Outcome counts grouped by one claim-level field, biggest group first.

        The confirmed-fraud rate is left to the service: it is the same
        flagged/(flagged+cleared) division used everywhere else, and computing it
        in one place keeps the zero-denominator rule in one place too.
        """
        pipeline = [
            {"$addFields": {"_bucket": STATUS_BUCKET_SWITCH}},
            {"$group": {
                "_id": BREAKDOWN_FIELDS[dimension],
                "total": {"$sum": 1},
                **BUCKET_COUNT_ACCUMULATORS,
            }},
            {"$sort": {"total": DESCENDING, "_id": ASCENDING}},
            {"$project": {"_id": 0, "value": {"$ifNull": ["$_id", "UNKNOWN"]},
                          "total": 1, "flagged": 1, "cleared": 1,
                          "pending": 1, "unprocessed": 1}},
        ]
        return list(self.collection.aggregate(pipeline))

    def bucketed_fraud_rate(self, dimension: str) -> list[dict[str, Any]]:
        """The same outcome counts, but over a numeric range instead of a field.

        Tenure is derived at query time from `customer.customerSince` rather than
        stored on the claim: a customer's tenure keeps growing after the claim is
        filed, so any denormalised copy would be wrong the day after it was
        written. `customerSince` is stored as a date *string*, hence the $toDate.
        """
        if dimension == "claimAmountBucket":
            stages: list[dict[str, Any]] = []
            group_by, boundaries, unit = "$claimAmount", CLAIM_AMOUNT_BOUNDARIES, None
        else:
            stages = [
                {"$lookup": {
                    "from": get_settings().CUSTOMERS_COLLECTION,
                    "localField": "customerId",
                    "foreignField": "customerId",
                    "as": "_customer",
                }},
                {"$unwind": {"path": "$_customer", "preserveNullAndEmptyArrays": True}},
                {"$addFields": {"_tenureYears": {"$cond": [
                    {"$eq": [{"$ifNull": ["$_customer.customerSince", None]}, None]},
                    None,
                    {"$dateDiff": {
                        "startDate": {"$toDate": "$_customer.customerSince"},
                        "endDate": "$$NOW",
                        "unit": "year",
                    }},
                ]}}},
                # A claim whose customer is missing has no tenure to bucket by and
                # would land in $bucket's "other" default alongside genuine
                # out-of-range values, conflating two different facts.
                {"$match": {"_tenureYears": {"$ne": None}}},
            ]
            group_by, boundaries, unit = "$_tenureYears", CUSTOMER_TENURE_BOUNDARIES, "years"

        pipeline = [
            *stages,
            {"$addFields": {"_bucket": STATUS_BUCKET_SWITCH}},
            {"$bucket": {
                "groupBy": group_by,
                # The open-ended top band: $bucket needs a finite upper edge, and
                # infinity is the only one that cannot silently drop a claim.
                "boundaries": [*boundaries, float("inf")],
                "default": "other",
                "output": {"total": {"$sum": 1}, **BUCKET_COUNT_ACCUMULATORS},
            }},
        ]
        rows = list(self.collection.aggregate(pipeline))
        return [{**row, "_unit": unit, "_boundaries": boundaries} for row in rows]

    # ------------------------------------------------------ pattern co-occurrence

    def matched_pattern_sets(self) -> list[list[str]]:
        """One de-duplicated pattern-id list per processed claim.

        Returns just the ids, not the claims: the co-occurrence count is built by
        pairing ids in the service, and pulling whole claim documents here would
        move a lot of bytes that nothing reads. De-duplicated with $setUnion so a
        pattern recorded twice on one claim cannot pair with itself.
        """
        pipeline = [
            {"$match": {"fraud.processed": True, "fraud.matchedPatterns.0": {"$exists": True}}},
            {"$project": {
                "_id": 0,
                "patternIds": {"$setUnion": [
                    {"$map": {
                        "input": "$fraud.matchedPatterns",
                        "as": "p",
                        "in": "$$p.patternId",
                    }},
                    [],
                ]},
            }},
        ]
        return [
            [pid for pid in row.get("patternIds") or [] if pid]
            for row in self.collection.aggregate(pipeline)
        ]

    # --------------------------------------------------------- repeat entities

    def repeat_entities(self, entity_type: str, min_appearances: int = 2) -> list[dict[str, Any]]:
        """Flagged-or-pending claims grouped by customer / repair shop / adjuster.

        Scoped to claims that are either flagged or still awaiting a decision:
        a cleared claim is a closed question, and including it would dilute the
        very rate this lens exists to surface.
        """
        pipeline = [
            {"$match": {"$or": [
                {"fraud.fraudFlag": True},
                {"fraud.processed": True, "fraud.fraudFlag": None},
                {"fraud.processed": {"$ne": True}, "fraud.fraudFlag": {"$ne": True}},
            ]}},
            # A null entity is not an entity: grouping on it would invent a
            # "shop" made of every claim with no repair shop recorded.
            {"$match": {REPEAT_ENTITY_FIELDS[entity_type].lstrip("$"): {"$nin": [None, ""]}}},
            {"$group": {
                "_id": REPEAT_ENTITY_FIELDS[entity_type],
                "claimCount": {"$sum": 1},
                "confirmedCount": {"$sum": {"$cond": [{"$eq": ["$fraud.fraudFlag", True]}, 1, 0]}},
                "claimIds": {"$push": "$claimId"},
                "totalClaimAmount": {"$sum": {"$ifNull": ["$claimAmount", 0]}},
            }},
            {"$match": {"claimCount": {"$gte": min_appearances}}},
            {"$sort": {"claimCount": DESCENDING, "confirmedCount": DESCENDING, "_id": ASCENDING}},
            {"$project": {"_id": 0, "entityValue": "$_id", "claimCount": 1,
                          "confirmedCount": 1, "claimIds": 1, "totalClaimAmount": 1}},
        ]
        return list(self.collection.aggregate(pipeline))

    # -------------------------------------------------------- financial impact

    def financial_impact(self) -> dict[str, Any]:
        """The four money figures, in one pass over the collection.

        Only decided claims contribute: an undecided claim is not yet a cost or a
        saving, and counting it as either would move the headline number every
        time someone opened a review without finishing it.
        """
        pipeline = [
            {"$match": DECIDED_MATCH},
            {"$group": {
                "_id": None,
                # What the book actually paid out on claims ruled legitimate.
                "currentFinancialImpact": {"$sum": {"$cond": [
                    {"$eq": ["$fraud.fraudFlag", False]},
                    {"$ifNull": ["$paidAmount", 0]},
                    0,
                ]}},
                # What was claimed but never paid because the claim was caught:
                # `claimAmount`, not `paidAmount`, since the avoided cost is the
                # amount that *would* have been paid.
                "fraudCostAvoided": {"$sum": {"$cond": [
                    {"$eq": ["$fraud.fraudFlag", True]},
                    {"$ifNull": ["$claimAmount", 0]},
                    0,
                ]}},
                "fraudClaimAmounts": {"$push": {"$cond": [
                    {"$eq": ["$fraud.fraudFlag", True]},
                    {"$ifNull": ["$claimAmount", 0]},
                    "$$REMOVE",
                ]}},
                "legitimateClaimAmounts": {"$push": {"$cond": [
                    {"$eq": ["$fraud.fraudFlag", False]},
                    {"$ifNull": ["$claimAmount", 0]},
                    "$$REMOVE",
                ]}},
            }},
            {"$project": {
                "_id": 0,
                "currentFinancialImpact": 1,
                "fraudCostAvoided": 1,
                # $avg over an empty array is null, which the service turns into
                # 0.0 — there is no meaningful average of no claims.
                "avgClaimAmountFraud": {"$avg": "$fraudClaimAmounts"},
                "avgClaimAmountLegitimate": {"$avg": "$legitimateClaimAmounts"},
                "fraudClaimCount": {"$size": "$fraudClaimAmounts"},
                "legitimateClaimCount": {"$size": "$legitimateClaimAmounts"},
            }},
        ]
        return next(iter(self.collection.aggregate(pipeline)), {})

    # ------------------------------------------------------------ review queue

    def decision_durations(self) -> dict[str, Any]:
        """Average decided-claim turnaround, in hours, plus its coverage.

        `coveredCount` versus `decidedCount` is not decoration: `fraud.processedAt`
        was added later than the seed fixtures, so a claim decided before the
        backfill has no start timestamp and cannot contribute a duration. Without
        the coverage figure an average over two of fourteen claims would read
        exactly like an average over all fourteen.
        """
        pipeline = [
            {"$match": DECIDED_MATCH},
            {"$group": {
                "_id": None,
                "decidedCount": {"$sum": 1},
                "durations": {"$push": {"$cond": [
                    {"$and": [
                        {"$ne": [{"$ifNull": ["$fraud.processedAt", None]}, None]},
                        {"$ne": [{"$ifNull": ["$fraud.reviewedAt", None]}, None]},
                    ]},
                    {"$dateDiff": {
                        "startDate": "$fraud.processedAt",
                        "endDate": "$fraud.reviewedAt",
                        "unit": "hour",
                    }},
                    "$$REMOVE",
                ]}},
            }},
            {"$project": {
                "_id": 0,
                "decidedCount": 1,
                "coveredCount": {"$size": "$durations"},
                "avgHoursToDecision": {"$avg": "$durations"},
                "maxHoursToDecision": {"$max": "$durations"},
            }},
        ]
        return next(iter(self.collection.aggregate(pipeline)), {})

    def backlog_by_complexity(self) -> list[dict[str, Any]]:
        """The pending queue split by complexity, and by kind of pending work.

        Uses the same PENDING_MATCH as `find_pending_review`, so the backlog
        total here can never disagree with the queue the dashboard renders.
        """
        pipeline = [
            {"$match": PENDING_MATCH},
            {"$group": {
                "_id": {"$ifNull": ["$complexity", "UNKNOWN"]},
                "backlog": {"$sum": 1},
                "awaitingDecision": {"$sum": {"$cond": [
                    {"$eq": ["$fraud.processed", True]}, 1, 0]}},
                "awaitingAssessment": {"$sum": {"$cond": [
                    {"$ne": ["$fraud.processed", True]}, 1, 0]}},
            }},
            {"$sort": {"backlog": DESCENDING, "_id": ASCENDING}},
            {"$project": {"_id": 0, "complexity": "$_id", "backlog": 1,
                          "awaitingDecision": 1, "awaitingAssessment": 1}},
        ]
        return list(self.collection.aggregate(pipeline))

    def oldest_pending_claim(self) -> dict[str, Any] | None:
        """The single longest-waiting item in the queue.

        Waiting is measured from `fraud.processedAt` where it exists and from
        `claimDate` otherwise, and the response says which was used — a claim
        that was never assessed has been waiting since it was filed, so falling
        back to `claimDate` is the honest reading rather than a missing value.
        """
        pipeline = [
            {"$match": PENDING_MATCH},
            {"$addFields": {
                "_waitingSince": {"$ifNull": ["$fraud.processedAt", "$claimDate"]},
                "_basis": {"$cond": [
                    {"$ne": [{"$ifNull": ["$fraud.processedAt", None]}, None]},
                    "processedAt",
                    "claimDate",
                ]},
            }},
            {"$match": {"_waitingSince": {"$ne": None}}},
            {"$sort": {"_waitingSince": ASCENDING}},
            {"$limit": 1},
            {"$project": {
                "_id": 0,
                "claimId": 1,
                "complexity": 1,
                "computedScore": "$fraud.computedScore",
                "processedAt": "$fraud.processedAt",
                "waitingSince": "$_waitingSince",
                "waitingSinceBasis": "$_basis",
                "daysWaiting": {"$dateDiff": {
                    "startDate": "$_waitingSince",
                    "endDate": "$$NOW",
                    "unit": "day",
                }},
            }},
        ]
        return next(iter(self.collection.aggregate(pipeline)), None)

    def reviewer_activity(self) -> list[dict[str, Any]]:
        """Decided claims grouped by whoever signed them off."""
        pipeline = [
            {"$match": {**DECIDED_MATCH, "fraud.reviewedBy": {"$nin": [None, ""]}}},
            {"$group": {
                "_id": "$fraud.reviewedBy",
                "totalDecided": {"$sum": 1},
                "confirmedCount": {"$sum": {"$cond": [
                    {"$eq": ["$fraud.fraudFlag", True]}, 1, 0]}},
                "dismissedCount": {"$sum": {"$cond": [
                    {"$eq": ["$fraud.fraudFlag", False]}, 1, 0]}},
                "lastDecisionAt": {"$max": "$fraud.reviewedAt"},
            }},
            {"$sort": {"totalDecided": DESCENDING, "_id": ASCENDING}},
            {"$project": {"_id": 0, "reviewer": "$_id", "totalDecided": 1,
                          "confirmedCount": 1, "dismissedCount": 1, "lastDecisionAt": 1}},
        ]
        return list(self.collection.aggregate(pipeline))

    # --------------------------------------------------------------- writes

    def backfill_processed_at(self) -> int:
        """Give every processed claim a `fraud.processedAt` if it lacks one.

        Uses `fraud.reviewedAt` as the stand-in, falling back to `claimDate`.
        This makes historical turnaround read as zero rather than as unknown,
        which is why `decision_durations` reports coverage separately and the
        backfill is a one-off script rather than something the API does lazily.
        """
        result = self.collection.update_many(
            {"fraud.processed": True, "fraud.processedAt": {"$exists": False}},
            [{"$set": {"fraud.processedAt": {"$ifNull": ["$fraud.reviewedAt", "$claimDate"]}}}],
        )
        return result.modified_count

    def update_fields(self, claim_id: str, fields: dict[str, Any]) -> int:
        """$set the given fields plus updatedAt. Returns matched count."""
        result = self.collection.update_one(
            {"claimId": claim_id},
            {"$set": {**fields, "updatedAt": datetime.now(timezone.utc)}},
        )
        return result.matched_count
