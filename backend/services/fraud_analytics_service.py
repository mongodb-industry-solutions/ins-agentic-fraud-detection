"""Portfolio-level fraud analytics: trend, score spread, activity feed, graph."""

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
# run higher), so the histogram spans 0..12 and 13 is the exclusive top edge.
SCORE_BOUNDARIES = [0, 3, 6, 9, 12, 13]

# One enormous cluster — a pattern that fired on 40 claims — would otherwise
# produce ~800 edges and an unreadable graph, so each group is truncated
# before pairing.
MAX_GROUP_MEMBERS = 5


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
        date_to = date_to or datetime.now(timezone.utc)
        date_from = date_from or (date_to - timedelta(days=DEFAULT_TREND_DAYS))

        trend = self.claims.trend_by_bucket(date_from, date_to, unit=bucket)
        distribution = self._label_distribution(
            self.claims.score_distribution(SCORE_BOUNDARIES)
        )

        # Deliberately unfiltered by date: this is a portfolio-level
        # reliability figure, not a point on the trend line.
        counts = self.claims.overall_decision_counts()
        decided = counts["flagged"] + counts["cleared"]
        rate = round(counts["flagged"] / decided, RATE_PRECISION) if decided else 0.0

        return {
            "trend": to_jsonable(trend),
            "scoreDistribution": distribution,
            "overallConfirmedFraudRate": rate,
            "dateFrom": date_from,
            "dateTo": date_to,
            "bucket": bucket,
        }

    @staticmethod
    def _label_distribution(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Turn `_id` lower-bounds into human ranges ("0-2", "3-5", ...).

        $bucket omits ranges that caught nothing; they are filled back in with
        a zero so the histogram always has the same bars in the same order.
        """
        counts = {row["_id"]: row.get("count", 0) for row in rows}
        edges = SCORE_BOUNDARIES

        distribution = [
            {
                "range": str(low) if high - low == 1 else f"{low}-{high - 1}",
                "count": counts.pop(low, 0),
            }
            for low, high in zip(edges, edges[1:])
        ]
        # Anything outside the boundaries lands in $bucket's "other" default.
        if counts.get("other"):
            distribution.append({"range": "other", "count": counts["other"]})
        return distribution

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
