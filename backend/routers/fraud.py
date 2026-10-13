"""Portfolio-level fraud analytics routes."""

from datetime import datetime

from fastapi import APIRouter, Query

from core.dependencies import FraudAnalyticsServiceDep
from schemas.fraud import (
    BreakdownDimension,
    FinancialImpactResponse,
    FraudRateBreakdownResponse,
    GraphScope,
    PatternCooccurrenceResponse,
    PendingQueueResponse,
    PortfolioStatsResponse,
    RecentActivityResponse,
    RelationshipGraphResponse,
    RepeatEntityResponse,
    RepeatEntityType,
    ReviewerActivityResponse,
    ReviewQueueMetricsResponse,
    SimilarityLeaderboardResponse,
    TrendBucket,
)

router = APIRouter(prefix="/fraud", tags=["fraud-analytics"])


@router.get(
    "/portfolio-stats",
    response_model=PortfolioStatsResponse,
    summary="Outcome trend, score distribution and portfolio confirmed-fraud rate",
)
def get_fraud_portfolio_stats(
    service: FraudAnalyticsServiceDep,
    dateFrom: datetime | None = Query(None, description="Defaults to 90 days before dateTo"),
    dateTo: datetime | None = Query(None, description="Defaults to now"),
    bucket: TrendBucket = Query(TrendBucket.week),
) -> PortfolioStatsResponse:
    return service.get_portfolio_stats(date_from=dateFrom, date_to=dateTo, bucket=bucket.value)


@router.get(
    "/recent-activity",
    response_model=RecentActivityResponse,
    summary="Merged agent/human/claim activity feed, newest first",
)
def get_recent_agent_activity(
    service: FraudAnalyticsServiceDep,
    limit: int = Query(20, ge=1, le=200),
    days: int | None = Query(None, ge=1, le=365, description="Only events newer than N days"),
    agentOnly: bool = Query(False, description="Agent actions only, excluding human decisions"),
) -> RecentActivityResponse:
    """Derived from existing collections — there is no activity-log collection.

    One review document is a full assessment cycle, so it is read twice: once
    for the score the agent produced, once for the human decision that followed.
    """
    return service.get_recent_activity(limit=limit, days=days, agent_only=agentOnly)


@router.get(
    "/pending-queue",
    response_model=PendingQueueResponse,
    summary="Scored claims awaiting a human confirm/dismiss decision",
)
def get_pending_queue(
    service: FraudAnalyticsServiceDep,
    limit: int = Query(10, ge=1, le=100),
) -> PendingQueueResponse:
    """`total` is the whole queue, not the page — the dashboard shows both."""
    return service.get_pending_queue(limit=limit)


@router.get(
    "/relationship-graph",
    response_model=RelationshipGraphResponse,
    summary="Claims linked by shared customer, repair shop or fraud pattern",
)
def get_claim_relationship_graph(
    service: FraudAnalyticsServiceDep,
    scope: GraphScope = Query(GraphScope.ALL),
    limit: int = Query(60, ge=2, le=200, description="Caps the candidate claim set"),
) -> RelationshipGraphResponse:
    return service.get_relationship_graph(scope=scope.value, limit=limit)


@router.get(
    "/similarity-leaderboard",
    response_model=SimilarityLeaderboardResponse,
    summary="Connected claim clusters as a ranked triage list",
)
def get_claim_similarity_leaderboard(
    service: FraudAnalyticsServiceDep,
    limit: int = Query(10, ge=1, le=100, description="Clusters returned, not claims"),
    scope: GraphScope = Query(GraphScope.ALL),
) -> SimilarityLeaderboardResponse:
    """The same connections as /relationship-graph, ranked instead of drawn.

    `limit` caps the returned clusters; `total` reports how many were found, so a
    truncated list still says how much it left out.
    """
    return service.get_similarity_leaderboard(limit=limit, scope=scope.value)


@router.get(
    "/rate-breakdown",
    response_model=FraudRateBreakdownResponse,
    summary="Confirmed-fraud rate correlated against one claim dimension",
)
def get_fraud_rate_breakdown(
    service: FraudAnalyticsServiceDep,
    dimension: BreakdownDimension = Query(..., description="Field or bucketed range to group by"),
) -> FraudRateBreakdownResponse:
    """Bucket boundaries are fixed server-side, not caller-supplied: the table is
    only useful if the same question returns comparable buckets every time."""
    return service.get_fraud_rate_breakdown(dimension.value)


@router.get(
    "/pattern-cooccurrence",
    response_model=PatternCooccurrenceResponse,
    summary="Which fraud patterns fire together, and how redundantly",
)
def get_pattern_cooccurrence_matrix(
    service: FraudAnalyticsServiceDep,
    minCooccurrence: int = Query(2, ge=1, le=100, description="Filters out one-off pairings"),
) -> PatternCooccurrenceResponse:
    """A rate near 1.0 means that whenever the rarer of the two patterns fires,
    the other almost always fires as well — the signature of two rules that are
    really one rule."""
    return service.get_pattern_cooccurrence_matrix(min_cooccurrence=minCooccurrence)


@router.get(
    "/repeat-entities",
    response_model=RepeatEntityResponse,
    summary="Customers, repair shops or adjusters recurring across open claims",
)
def get_repeat_entity_analysis(
    service: FraudAnalyticsServiceDep,
    entityType: RepeatEntityType = Query(...),
    minAppearances: int = Query(2, ge=2, le=100),
) -> RepeatEntityResponse:
    """Independent of the pattern catalogue on purpose: an entity can surface
    here well before there is enough evidence to write a pattern for it."""
    return service.get_repeat_entity_analysis(
        entity_type=entityType.value, min_appearances=minAppearances
    )


@router.get(
    "/financial-impact",
    response_model=FinancialImpactResponse,
    summary="Paid-out cost, cost avoided, and the two together",
)
def get_fraud_financial_impact(
    service: FraudAnalyticsServiceDep,
) -> FinancialImpactResponse:
    """Decided claims only — an open claim is neither a cost nor a saving yet."""
    return service.get_financial_impact()


@router.get(
    "/review-queue-metrics",
    response_model=ReviewQueueMetricsResponse,
    summary="Turnaround, backlog per complexity, and the longest-waiting claim",
)
def get_review_queue_metrics(
    service: FraudAnalyticsServiceDep,
) -> ReviewQueueMetricsResponse:
    """Turnaround needs `fraud.processedAt`, which postdates the seed fixtures —
    `timeToDecisionCoverage` reports what fraction of decided claims the average
    actually describes. Run `scripts/backfill_processed_at.py` to raise it."""
    return service.get_review_queue_metrics()


@router.get(
    "/reviewer-activity",
    response_model=ReviewerActivityResponse,
    summary="Confirm/dismiss split per reviewer",
)
def get_reviewer_activity_stats(
    service: FraudAnalyticsServiceDep,
) -> ReviewerActivityResponse:
    return service.get_reviewer_activity_stats()
