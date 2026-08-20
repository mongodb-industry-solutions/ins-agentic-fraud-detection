"""Pydantic response models for the portfolio-level fraud analytics router."""

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field


class TrendBucket(str, Enum):
    week = "week"
    month = "month"


class GraphScope(str, Enum):
    ALL = "ALL"
    FLAGGED = "FLAGGED"
    PENDING = "PENDING"


# ------------------------------------------------------------ portfolio stats

class TrendPoint(BaseModel):
    bucket: datetime
    flagged: int = 0
    cleared: int = 0
    pending: int = 0
    unprocessed: int = 0


class ScoreBucket(BaseModel):
    range: str
    count: int = 0


class PortfolioStatsResponse(BaseModel):
    trend: list[TrendPoint]
    scoreDistribution: list[ScoreBucket]
    overallConfirmedFraudRate: float
    dateFrom: datetime
    dateTo: datetime
    bucket: str


# ------------------------------------------------------------ recent activity

class ActivityEvent(BaseModel):
    type: str
    timestamp: datetime | None = None
    claimId: str | None = None
    computedScore: float | None = None
    reviewedBy: str | None = None


class RecentActivityResponse(BaseModel):
    events: list[ActivityEvent]
    total: int


# --------------------------------------------------------- relationship graph

class GraphNode(BaseModel):
    claimId: str
    customerId: str | None = None
    computedScore: float | None = None
    fraudFlag: bool | None = None


class GraphEdge(BaseModel):
    source: str
    target: str
    type: str
    patternId: str | None = None
    patternType: str | None = None


class RelationshipGraphResponse(BaseModel):
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    scope: str
