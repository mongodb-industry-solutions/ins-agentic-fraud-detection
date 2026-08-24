"""Portfolio-level fraud analytics: trend, score spread, activity feed, graph,
and the Phase 1 fraud-intelligence lenses built on top of them."""

import logging
from datetime import datetime, timedelta, timezone
from itertools import combinations
from typing import Any

from core.serialization import to_jsonable
from repositories.claims_repo import ClaimsRepository
from repositories.patterns_repo import PatternsRepository
from repositories.reviews_repo import ReviewsRepository

logger = logging.getLogger(__name__)

DEFAULT_TREND_DAYS = 90
RATE_PRECISION = 4

# computedScore is capped at 12 by the scoring step (the raw pre-cap score can
# run higher), so the histogram spans 0..12 inclusive.
MAX_SCORE = 12

# Review-band cutoffs on the 0..12 capped scale, as (inclusive minimum, label)
# in descending order.
#
# This is the server-side home for banding, and it exists so that a score is
# labelled in exactly one place. The frontend previously carried its own
# `SEVERE_SCORE_MIN` in claimsPresenter.js, documented there as explicitly NOT
# authoritative — which was honest but left the histogram with no authority to
# read from. Anything that needs to know what band a score falls into should now
# read it from a response rather than re-deriving it from a threshold of its own.
#
# Note this is still not the *agent's* banding: the agent reports a bandLabel
# from cutoffs held in its own instructions, outside this repo. Reconciling those
# two is a separate job; this constant is the authority for portfolio analytics.
SCORE_BANDS: tuple[tuple[int, str], ...] = (
    (9, "HIGH"),
    (6, "REVIEW"),
    (0, "LOW"),
)

# One enormous cluster — a pattern that fired on 40 claims — would otherwise
# produce ~800 edges and an unreadable graph, so each group is truncated
# before pairing.
MAX_GROUP_MEMBERS = 5

MONEY_PRECISION = 2

# The two dimensions that need a $bucket stage instead of a plain $group, and so
# come back keyed by a numeric lower bound that has to be relabelled.
BUCKETED_DIMENSIONS = frozenset({"claimAmountBucket", "customerTenureBucket"})

# How much of the portfolio the leaderboard clusters over. Larger than the
# graph's default because a flat ranked list stays readable at any length —
# it is the *graph* that becomes unreadable past a few dozen nodes, not the
# clustering itself.
CLUSTER_CANDIDATE_LIMIT = 200

# A cluster's priority is its members' average score plus one point for each
# member beyond the first pair. Deliberately a formula anyone can reproduce in
# their head from the row's own fields, rather than a tuned weighting: this list
# is read top-down as a work queue, so a manager needs to be able to see why one
# row outranks another.
CLUSTER_SIZE_BONUS = 1.0

# Human wording for each grouping key, and the edge type it corresponds to in
# the relationship graph — the two views describe the same connections.
CLUSTER_REASONS = {
    "SAME_CUSTOMER": "claims filed by customer {key}",
    "SAME_REPAIR_SHOP": "claims routed through repair shop {key}",
    "SHARED_PATTERN": "claims that all triggered pattern {key}",
}


class FraudAnalyticsService:
    """Read-only aggregate views across the whole claims portfolio."""

    def __init__(
        self,
        claims_repo: ClaimsRepository,
        reviews_repo: ReviewsRepository,
        patterns_repo: PatternsRepository,
    ):
        self.claims = claims_repo
        self.reviews = reviews_repo
        self.patterns = patterns_repo

    # ------------------------------------------------------- portfolio stats

    def get_portfolio_stats(
        self,
        date_from: datetime | None = None,
        date_to: datetime | None = None,
        bucket: str = "week",
    ) -> dict[str, Any]:
        """Trend and score spread, computed as two separate aggregations.

        They are kept apart rather than forced into one $facet because the
        grouping logic differs: the trend is date-bucketed over every claim in
        the range, the histogram is score-bucketed over scored claims only.
        """
        # The trailing window is anchored to the newest claim in the portfolio,
        # not to the wall clock. On live data the two are the same thing. On the
        # seeded demo data they are eighteen months apart, and anchoring to
        # "now" returned an empty trend for every caller — the dashboard's
        # sparklines have been silently drawing nothing for exactly this reason.
        # An explicit dateTo still wins, so a caller can ask for any window.
        if date_to is None:
            latest = self.claims.latest_claim_date()
            date_to = latest or datetime.now(timezone.utc)
            # Stored timestamps are naive UTC; mixing in a tz-aware bound would
            # raise on the subtraction below and never compare in Mongo.
            if latest is not None and date_from is not None and date_from.tzinfo:
                date_from = date_from.replace(tzinfo=None)
        date_from = date_from or (date_to - timedelta(days=DEFAULT_TREND_DAYS))

        trend = self.claims.trend_by_bucket(date_from, date_to, unit=bucket)
        distribution = self._label_distribution(self.claims.score_distribution())

        # Deliberately unfiltered by date: this is a portfolio-level
        # reliability figure, not a point on the trend line.
        counts = self.claims.overall_decision_counts()
        decided = counts["flagged"] + counts["cleared"]
        rate = round(counts["flagged"] / decided, RATE_PRECISION) if decided else 0.0

        average = self.claims.average_computed_score()

        return {
            "trend": to_jsonable(trend),
            "scoreDistribution": distribution,
            "overallConfirmedFraudRate": rate,
            # None, not 0.0, when nothing has been scored: an unscored portfolio
            # has no average score, and 0.0 would read as "every claim scored 0".
            "avgComputedScore": round(average, 2) if average is not None else None,
            "dateFrom": date_from,
            "dateTo": date_to,
            "bucket": bucket,
        }

    @staticmethod
    def score_band(score: int) -> str:
        """The review band a score falls into. The one place this is decided."""
        return next(label for minimum, label in SCORE_BANDS if score >= minimum)

    @classmethod
    def _label_distribution(cls, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """One entry per score 0..12, each tagged with its band.

        Every score is present even when no claim landed on it: the histogram
        draws a bar per score, and omitting the empty ones would silently
        compress the x-axis so that neighbouring bars stopped being neighbouring
        scores. A gap in the distribution is information, so it is rendered as a
        zero rather than closed up.
        """
        counts = {row["score"]: row.get("count", 0) for row in rows}
        return [
            {"score": score, "count": counts.get(score, 0), "band": cls.score_band(score)}
            for score in range(0, MAX_SCORE + 1)
        ]

    # ------------------------------------------------------- recent activity

    def get_recent_activity(
        self,
        limit: int = 20,
        days: int | None = None,
        agent_only: bool = False,
    ) -> dict[str, Any]:
        """Newest activity first, optionally windowed and narrowed to the agent.

        `total` is the number of events returned, not a portfolio-wide count —
        with a window applied there is nothing else it could honestly mean.
        """
        since = None
        if days is not None:
            # Naive UTC: the stored timestamps carry no offset, and a
            # tz-aware bound would not compare against them in Mongo.
            since = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=days)

        events = to_jsonable(
            self.reviews.recent_activity(limit=limit, since=since, agent_only=agent_only)
        )
        return {"events": events, "total": len(events)}

    # --------------------------------------------------- relationship graph

    def get_pending_queue(self, limit: int = 10) -> dict[str, Any]:
        """Scored claims still awaiting a confirm/dismiss decision."""
        items, total = self.claims.find_pending_review(limit=limit)
        return {"items": items, "total": total}

    def get_relationship_graph(self, scope: str = "ALL", limit: int = 60) -> dict[str, Any]:
        """Pairwise claim relationships, built in Python over a capped candidate set.

        The pairing is application code on purpose: expressing "every pair
        within every group, for three different grouping keys" as a pipeline
        needs nested $lookup/$unwind/$group that is far harder to read — and
        to change — than the dictionaries below.
        """
        claims = self.claims.find_graph_candidates(scope=scope, limit=limit)

        by_customer: dict[str, list[str]] = {}
        by_shop: dict[str, list[str]] = {}
        by_pattern: dict[str, list[str]] = {}

        for claim in claims:
            claim_id = claim["claimId"]
            if claim.get("customerId"):
                by_customer.setdefault(claim["customerId"], []).append(claim_id)
            if claim.get("repairShop"):
                by_shop.setdefault(claim["repairShop"], []).append(claim_id)
            for pattern in claim.get("matchedPatterns") or []:
                if pattern.get("patternId"):
                    by_pattern.setdefault(pattern["patternId"], []).append(claim_id)

        edges: list[dict[str, Any]] = []
        edges += self._pair_groups(by_customer, "SAME_CUSTOMER")
        edges += self._pair_groups(by_shop, "SAME_REPAIR_SHOP")
        edges += self._pair_groups(by_pattern, "SHARED_PATTERN", tag_pattern=True)

        # The frontend draws RULE and HISTORICAL_SIMILARITY edges differently,
        # so each shared-pattern edge carries the pattern's type.
        pattern_types = self._pattern_types(by_pattern.keys())
        for edge in edges:
            if edge.get("patternId"):
                edge["patternType"] = pattern_types.get(edge["patternId"])

        # An unconnected claim is still a node: the absence of links is itself
        # a finding, so nothing is filtered out here.
        nodes = [
            {
                "claimId": c["claimId"],
                "customerId": c.get("customerId"),
                "computedScore": c.get("computedScore"),
                "fraudFlag": c.get("fraudFlag"),
            }
            for c in claims
        ]
        return {"nodes": nodes, "edges": edges, "scope": scope}

    @staticmethod
    def _pair_groups(
        groups: dict[str, list[str]],
        edge_type: str,
        tag_pattern: bool = False,
    ) -> list[dict[str, Any]]:
        """Every pair inside every group of 2+, each group capped first."""
        edges: list[dict[str, Any]] = []
        for key, members in groups.items():
            if len(members) < 2:
                continue
            for source, target in combinations(members[:MAX_GROUP_MEMBERS], 2):
                edge: dict[str, Any] = {"source": source, "target": target, "type": edge_type}
                if tag_pattern:
                    edge["patternId"] = key
                edges.append(edge)
        return edges

    def _pattern_types(self, pattern_ids) -> dict[str, str]:
        ids = list(pattern_ids)
        if not ids:
            return {}
        return {
            p["patternId"]: p.get("patternType")
            for p in self.patterns.get_many(ids)
        }

    # ------------------------------------------------------ similarity leaderboard

    def get_similarity_leaderboard(self, limit: int = 10, scope: str = "ALL") -> dict[str, Any]:
        """The same shared connections as the graph, ranked as a flat work queue.

        This is the triage-first complement to `get_relationship_graph`: identical
        candidate set and identical grouping keys, but returned as ordered rows
        rather than nodes and edges, because reading a ranking top-down and
        reading a network layout are different tasks.

        Unlike the graph, groups are *not* truncated to MAX_GROUP_MEMBERS: the
        cap exists to keep an edge count drawable, and a cluster that quietly
        dropped three of its eight members would misstate the very thing a
        manager is ranking on.
        """
        claims = self.claims.find_graph_candidates(scope=scope, limit=CLUSTER_CANDIDATE_LIMIT)
        scores = {c["claimId"]: c.get("computedScore") for c in claims}
        flags = {c["claimId"]: c.get("fraudFlag") for c in claims}

        groups: dict[tuple[str, str], list[str]] = {}
        for claim in claims:
            claim_id = claim["claimId"]
            if claim.get("customerId"):
                groups.setdefault(("SAME_CUSTOMER", claim["customerId"]), []).append(claim_id)
            if claim.get("repairShop"):
                groups.setdefault(("SAME_REPAIR_SHOP", claim["repairShop"]), []).append(claim_id)
            for pattern in claim.get("matchedPatterns") or []:
                if pattern.get("patternId"):
                    key = ("SHARED_PATTERN", pattern["patternId"])
                    groups.setdefault(key, []).append(claim_id)

        clusters = [
            self._build_cluster(kind, key, members, scores, flags)
            for (kind, key), members in groups.items()
            if len(members) >= 2
        ]
        clusters = self._merge_identical_clusters(clusters)
        clusters.sort(key=lambda c: (-c["priority"], -c["maxScore"], c["clusterId"]))

        return {
            "clusters": clusters[:limit],
            "total": len(clusters),
            "scope": scope,
            "candidatesConsidered": len(claims),
        }

    @staticmethod
    def _build_cluster(
        kind: str,
        key: str,
        members: list[str],
        scores: dict[str, Any],
        flags: dict[str, Any],
    ) -> dict[str, Any]:
        """One leaderboard row from one group of claims sharing a connection."""
        claim_ids = sorted(set(members))
        # An unscored claim contributes nothing to the average rather than
        # counting as a zero, which would drag a cluster of one 11 and one
        # unassessed claim below a cluster of two 6s and bury the real lead.
        known = [scores[cid] for cid in claim_ids if scores.get(cid) is not None]
        avg_score = round(sum(known) / len(known), 2) if known else 0.0
        max_score = max(known) if known else 0.0

        return {
            "clusterId": f"{kind}:{key}",
            "claimIds": claim_ids,
            "sharedReason": f"{len(claim_ids)} {CLUSTER_REASONS[kind].format(key=key)}",
            "linkType": kind,
            "avgScore": avg_score,
            "maxScore": max_score,
            "claimCount": len(claim_ids),
            "scoredCount": len(known),
            "confirmedCount": sum(1 for cid in claim_ids if flags.get(cid) is True),
            "priority": round(
                avg_score + CLUSTER_SIZE_BONUS * (len(claim_ids) - 2), RATE_PRECISION
            ),
        }

    @staticmethod
    def _merge_identical_clusters(clusters: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Collapse clusters covering exactly the same claims into one row.

        Two claims sharing both a customer and a repair shop produce two groups
        with identical membership. As a graph those are two distinct edges and
        worth drawing separately; as a triage list they are one thing to go and
        look at, listed twice — so the reasons are joined and the row appears
        once. Clusters that merely overlap are left alone: those genuinely are
        different sets of claims.
        """
        by_members: dict[frozenset[str], dict[str, Any]] = {}
        for cluster in clusters:
            members = frozenset(cluster["claimIds"])
            existing = by_members.get(members)
            if existing is None:
                by_members[members] = cluster
                continue
            existing["sharedReason"] += f"; also {cluster['sharedReason']}"
            existing["linkType"] = "MULTIPLE"
        return list(by_members.values())

    # -------------------------------------------------------- fraud-rate breakdown

    def get_fraud_rate_breakdown(self, dimension: str) -> dict[str, Any]:
        """The literal correlation table: outcome counts and rate per dimension value.

        Two code paths behind one response shape — a plain `$group` for
        claim-level fields, a `$bucket` for the numeric ranges — because a caller
        asking "does fraud correlate with claim size" wants the same table back
        as one asking "does it correlate with complexity".
        """
        if dimension in BUCKETED_DIMENSIONS:
            rows = [self._label_bucket_row(row) for row in self.claims.bucketed_fraud_rate(dimension)]
        else:
            rows = self.claims.fraud_rate_breakdown(dimension)

        breakdown = [
            {
                "value": row["value"],
                "total": row.get("total", 0),
                "flagged": row.get("flagged", 0),
                "cleared": row.get("cleared", 0),
                "pending": row.get("pending", 0),
                "unprocessed": row.get("unprocessed", 0),
                # Denominator is decided claims only. A group of 20 claims with
                # one confirmed fraud and nineteen still unreviewed has a rate of
                # 1.0, not 0.05 — the undecided claims are not evidence of
                # legitimacy, and dividing by `total` would quietly assume they are.
                "confirmedFraudRate": self._rate(row.get("flagged", 0), row.get("cleared", 0)),
                "decidedCount": row.get("flagged", 0) + row.get("cleared", 0),
            }
            for row in rows
        ]
        return {"dimension": dimension, "breakdown": breakdown, "total": sum(
            row["total"] for row in breakdown
        )}

    @staticmethod
    def _rate(flagged: int, cleared: int) -> float:
        """flagged / decided, or 0.0 when nothing has been decided yet."""
        decided = flagged + cleared
        return round(flagged / decided, RATE_PRECISION) if decided else 0.0

    @staticmethod
    def _label_bucket_row(row: dict[str, Any]) -> dict[str, Any]:
        """Turn a `$bucket` lower bound into the range label it stands for.

        `$bucket` keys each group by its lower edge, so the label has to be
        rebuilt from the boundary list the repository used — the top band gets
        an open-ended "20000+" because its real upper edge is infinity.
        """
        boundaries = row["_boundaries"]
        unit = row.get("_unit")
        suffix = f" {unit}" if unit else ""
        low = row["_id"]

        if low == "other":
            # Out-of-range values, e.g. a negative claim amount.
            label = "other"
        else:
            index = boundaries.index(low)
            is_top = index == len(boundaries) - 1
            label = (
                f"{low}+{suffix}" if is_top
                else f"{low}-{boundaries[index + 1] - 1}{suffix}"
            )
        return {**row, "value": label}

    # ------------------------------------------------------ pattern co-occurrence

    def get_pattern_cooccurrence_matrix(self, min_cooccurrence: int = 2) -> dict[str, Any]:
        """Which patterns fire together, and whether that means they are redundant.

        Built in application code for the same reason the relationship graph is:
        "every pair within every claim's matched-pattern array, counted across
        claims" is a handful of readable lines here and a nest of
        `$unwind`/`$group` stages as a pipeline.

        Two rates are returned, and the difference between them matters:

        * `cooccurrenceRate` is the specified figure — co-occurrences over
          `min(timesTriggeredA, timesTriggeredB)`, i.e. "when the rarer pattern
          fires, how often does the other fire too". Near 1.0 suggests two rules
          are genuinely redundant.
        * `observedCooccurrenceRate` uses the same division over trigger counts
          *within this sample* instead. It exists because `stats.timesTriggered`
          is maintained independently of the claims currently in the collection,
          so the specified rate reads as near-zero whenever the stats describe
          far more history than the collection holds — which is exactly the case
          on the seeded demo data. Prefer the specified rate in production and
          the observed one when reading the demo.
        """
        pattern_sets = self.claims.matched_pattern_sets()

        pair_counts: dict[tuple[str, str], int] = {}
        observed_triggers: dict[str, int] = {}
        for pattern_ids in pattern_sets:
            for pattern_id in pattern_ids:
                observed_triggers[pattern_id] = observed_triggers.get(pattern_id, 0) + 1
            # Sorted so (A, B) and (B, A) are the same key regardless of the
            # order the patterns happen to sit in on the claim.
            for pair in combinations(sorted(pattern_ids), 2):
                pair_counts[pair] = pair_counts.get(pair, 0) + 1

        stats = self._pattern_trigger_stats(observed_triggers.keys())
        pairs = [
            {
                "patternIdA": a,
                "patternIdB": b,
                "patternNameA": stats.get(a, {}).get("name"),
                "patternNameB": stats.get(b, {}).get("name"),
                "cooccurrenceCount": count,
                "cooccurrenceRate": self._ratio(
                    count,
                    min(
                        stats.get(a, {}).get("timesTriggered") or 0,
                        stats.get(b, {}).get("timesTriggered") or 0,
                    ),
                ),
                "observedCooccurrenceRate": self._ratio(
                    count, min(observed_triggers[a], observed_triggers[b])
                ),
            }
            for (a, b), count in pair_counts.items()
            if count >= min_cooccurrence
        ]
        pairs.sort(key=lambda p: (-p["cooccurrenceCount"], p["patternIdA"], p["patternIdB"]))

        return {
            "pairs": pairs,
            "total": len(pairs),
            "minCooccurrence": min_cooccurrence,
            "claimsAnalyzed": len(pattern_sets),
        }

    @staticmethod
    def _ratio(numerator: int, denominator: int) -> float | None:
        """A rate capped at 1.0, or None when there is no denominator to divide by.

        Capped because the two inputs come from different places: a pair can be
        observed co-occurring more often than `stats.timesTriggered` claims
        either pattern ever fired, and a rate above 1.0 would be reported as if
        it meant something. None rather than 0.0 for a zero denominator — "not
        computable" and "never co-occurs" are different answers.
        """
        if not denominator:
            return None
        return round(min(numerator / denominator, 1.0), RATE_PRECISION)

    def _pattern_trigger_stats(self, pattern_ids) -> dict[str, dict[str, Any]]:
        ids = list(pattern_ids)
        if not ids:
            return {}
        return {
            p["patternId"]: {
                "name": p.get("name"),
                "timesTriggered": (p.get("stats") or {}).get("timesTriggered"),
            }
            for p in self.patterns.get_many(ids)
        }

    # ---------------------------------------------------------- repeat entities

    def get_repeat_entity_analysis(
        self,
        entity_type: str,
        min_appearances: int = 2,
    ) -> dict[str, Any]:
        """Entities appearing across several open or flagged claims.

        Deliberately independent of the pattern catalogue: a repair shop can
        surface here long before there is enough evidence to justify writing a
        dedicated pattern for it, which is the whole point of the lens.
        """
        rows = self.claims.repeat_entities(entity_type, min_appearances=min_appearances)
        entities = [
            {
                "entityValue": row["entityValue"],
                "claimCount": row["claimCount"],
                "confirmedCount": row["confirmedCount"],
                # Over the group's whole claim count, not just its decided ones:
                # this is a concentration measure — "how much of what this shop
                # touches has been confirmed fraud" — not a verdict accuracy rate.
                "confirmedRate": round(
                    row["confirmedCount"] / row["claimCount"], RATE_PRECISION
                ) if row["claimCount"] else 0.0,
                "claimIds": row["claimIds"],
                "totalClaimAmount": round(row.get("totalClaimAmount") or 0, MONEY_PRECISION),
            }
            for row in rows
        ]
        entities.sort(key=lambda e: (-e["claimCount"], -e["confirmedRate"], e["entityValue"]))

        return {
            "entityType": entity_type,
            "entities": entities,
            "total": len(entities),
            "minAppearances": min_appearances,
        }

    # -------------------------------------------------------- financial impact

    def get_financial_impact(self) -> dict[str, Any]:
        """The money view, over decided claims only.

        `potentialImpactWithoutTool` is returned even though it is exactly the
        sum of the two figures above it. That redundancy is intentional: the
        definition of "what this would have cost" lives here, so the frontend
        never re-derives it and cannot drift out of step with a change to it.
        """
        row = self.claims.financial_impact()
        current = round(row.get("currentFinancialImpact") or 0, MONEY_PRECISION)
        avoided = round(row.get("fraudCostAvoided") or 0, MONEY_PRECISION)

        return {
            "currentFinancialImpact": current,
            "fraudCostAvoided": avoided,
            "potentialImpactWithoutTool": round(current + avoided, MONEY_PRECISION),
            "avgClaimAmountFraud": round(row.get("avgClaimAmountFraud") or 0, MONEY_PRECISION),
            "avgClaimAmountLegitimate": round(
                row.get("avgClaimAmountLegitimate") or 0, MONEY_PRECISION
            ),
            "fraudClaimCount": row.get("fraudClaimCount", 0),
            "legitimateClaimCount": row.get("legitimateClaimCount", 0),
        }

    # ------------------------------------------------------------ review queue

    def get_review_queue_metrics(self) -> dict[str, Any]:
        """Turnaround, backlog and the longest-waiting claim.

        `timeToDecisionCoverage` is part of the answer, not diagnostics:
        `fraud.processedAt` postdates the seed fixtures, so the average is over
        whichever claims have it. A coverage of 0.14 says "this average describes
        two of fourteen decisions" — without it the figure would read as though
        it described all of them.
        """
        durations = self.claims.decision_durations()
        decided = durations.get("decidedCount", 0)
        covered = durations.get("coveredCount", 0)

        backlog = self.claims.backlog_by_complexity()
        oldest = self.claims.oldest_pending_claim()

        return {
            "avgHoursToDecision": round(durations.get("avgHoursToDecision") or 0, MONEY_PRECISION),
            "maxHoursToDecision": durations.get("maxHoursToDecision"),
            "decidedCount": decided,
            "timeToDecisionSampleSize": covered,
            "timeToDecisionCoverage": round(covered / decided, RATE_PRECISION) if decided else 0.0,
            "backlogByComplexity": backlog,
            "totalBacklog": sum(row["backlog"] for row in backlog),
            "oldestPendingClaim": to_jsonable(oldest) if oldest else None,
        }

    def get_reviewer_activity_stats(self) -> dict[str, Any]:
        """Confirm/dismiss split per reviewer.

        `confirmRate` is not a quality score and should not be read as one: a
        reviewer handed only high-scoring claims will confirm most of them. It
        measures the mix of work someone was given as much as what they did
        with it.
        """
        reviewers = [
            {
                "reviewer": row["reviewer"],
                "totalDecided": row["totalDecided"],
                "confirmedCount": row["confirmedCount"],
                "dismissedCount": row["dismissedCount"],
                "confirmRate": round(
                    row["confirmedCount"] / row["totalDecided"], RATE_PRECISION
                ) if row["totalDecided"] else 0.0,
                "lastDecisionAt": row.get("lastDecisionAt"),
            }
            for row in self.claims.reviewer_activity()
        ]
        return {
            "reviewers": to_jsonable(reviewers),
            "total": len(reviewers),
            "totalDecisions": sum(r["totalDecided"] for r in reviewers),
        }
