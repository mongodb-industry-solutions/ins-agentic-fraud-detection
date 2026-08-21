"""Portfolio-level fraud analytics routes."""

from datetime import datetime

from fastapi import APIRouter, Query

from core.dependencies import FraudAnalyticsServiceDep
from schemas.fraud import (
    GraphScope,
    PendingQueueResponse,
    PortfolioStatsResponse,
    RecentActivityResponse,
    RelationshipGraphResponse,
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
