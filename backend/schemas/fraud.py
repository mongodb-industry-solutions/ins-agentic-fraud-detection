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
    """One exact score, not a range: the histogram draws a bar per score."""

    score: int
    count: int = 0
    # LOW / REVIEW / HIGH, assigned by SCORE_BANDS server-side. Clients colour
    # bars from this rather than re-deriving thresholds of their own.
    band: str


class PortfolioStatsResponse(BaseModel):
    trend: list[TrendPoint]
    scoreDistribution: list[ScoreBucket]
    overallConfirmedFraudRate: float
    # None when no claim has been scored yet — distinct from 0.0, which would
    # mean every scored claim scored zero.
    avgComputedScore: float | None = None
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


# ------------------------------------------------------------- pending queue

class PendingQueueItem(BaseModel):
    claimId: str
    customerName: str | None = None
    coverageType: str | None = None
    computedScore: float | None = None
    scoredAt: datetime | None = None
    # Pattern documents as stored on the claim; the client renders their names.
    matchedPatterns: list[dict] = Field(default_factory=list)
    # The queue holds two kinds of work — never analysed, and scored but
    # undecided — and the client labels the row's action from this. Declared
    # explicitly because an undeclared field is dropped from the response, which
    # would make every row look like it was already scored.
    processed: bool | None = None
    # Ranks the unanalysed rows, which have no score to rank them by.
    claimDate: datetime | None = None


class PendingQueueResponse(BaseModel):
    items: list[PendingQueueItem]
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


# ------------------------------------------------------ similarity leaderboard

class SimilarityCluster(BaseModel):
    clusterId: str
    claimIds: list[str] = Field(default_factory=list)
    sharedReason: str
    # The graph edge type this cluster corresponds to, or MULTIPLE where several
    # kinds of link cover exactly the same claims.
    linkType: str
    avgScore: float = 0.0
    maxScore: float = 0.0
    claimCount: int = 0
    scoredCount: int = 0
    confirmedCount: int = 0
    priority: float = 0.0


class SimilarityLeaderboardResponse(BaseModel):
    clusters: list[SimilarityCluster] = Field(default_factory=list)
    # Clusters found in total, before `limit` truncated the list.
    total: int
    scope: str
    candidatesConsidered: int


# --------------------------------------------------------- fraud-rate breakdown

class BreakdownDimension(str, Enum):
    complexity = "complexity"
    coverageType = "coverageType"
    claimType = "claimType"
    claimAmountBucket = "claimAmountBucket"
    customerTenureBucket = "customerTenureBucket"


class BreakdownRow(BaseModel):
    value: str
    total: int = 0
    flagged: int = 0
    cleared: int = 0
    pending: int = 0
    unprocessed: int = 0
    # flagged / (flagged + cleared): undecided claims are excluded from the
    # denominator rather than counted as legitimate.
    confirmedFraudRate: float = 0.0
    decidedCount: int = 0


class FraudRateBreakdownResponse(BaseModel):
    dimension: str
    breakdown: list[BreakdownRow] = Field(default_factory=list)
    total: int = 0


# ------------------------------------------------------- pattern co-occurrence

class CooccurrencePair(BaseModel):
    patternIdA: str
    patternIdB: str
    patternNameA: str | None = None
    patternNameB: str | None = None
    cooccurrenceCount: int
    # None when neither pattern has a recorded trigger count to divide by —
    # distinct from 0.0, which would claim they never fire together.
    cooccurrenceRate: float | None = None
    # The same ratio over trigger counts observed in the analysed claims only.
    # Meaningful on datasets where stats.timesTriggered describes more history
    # than the collection currently holds.
    observedCooccurrenceRate: float | None = None


class PatternCooccurrenceResponse(BaseModel):
    pairs: list[CooccurrencePair] = Field(default_factory=list)
    total: int
    minCooccurrence: int
    claimsAnalyzed: int


# ------------------------------------------------------------ repeat entities

class RepeatEntityType(str, Enum):
    customer = "customer"
    repairShop = "repairShop"
    adjuster = "adjuster"


class RepeatEntity(BaseModel):
    entityValue: str
    claimCount: int
    confirmedCount: int
    # Confirmed over the group's whole claim count — a concentration measure,
    # not a verdict accuracy rate.
    confirmedRate: float = 0.0
    claimIds: list[str] = Field(default_factory=list)
    totalClaimAmount: float = 0.0


class RepeatEntityResponse(BaseModel):
    entityType: str
    entities: list[RepeatEntity] = Field(default_factory=list)
    total: int
    minAppearances: int


# ----------------------------------------------------------- financial impact

class FinancialImpactResponse(BaseModel):
    currentFinancialImpact: float
    fraudCostAvoided: float
    # Intentionally the sum of the two fields above, computed server-side so the
    # definition lives in exactly one place.
    potentialImpactWithoutTool: float
    avgClaimAmountFraud: float
    avgClaimAmountLegitimate: float
    fraudClaimCount: int = 0
    legitimateClaimCount: int = 0


# --------------------------------------------------------------- review queue

class BacklogSegment(BaseModel):
    complexity: str
    backlog: int
    awaitingDecision: int
    awaitingAssessment: int


class OldestPendingClaim(BaseModel):
    claimId: str
    complexity: str | None = None
    computedScore: float | None = None
    processedAt: datetime | None = None
    waitingSince: datetime | None = None
    # "processedAt" or "claimDate" — a never-assessed claim has been waiting
    # since it was filed, so the response names which clock was used.
    waitingSinceBasis: str | None = None
    daysWaiting: int | None = None


class ReviewQueueMetricsResponse(BaseModel):
    avgHoursToDecision: float = 0.0
    maxHoursToDecision: int | None = None
    decidedCount: int = 0
    # How many decided claims actually had both timestamps. The average above
    # describes these claims only.
    timeToDecisionSampleSize: int = 0
    timeToDecisionCoverage: float = 0.0
    backlogByComplexity: list[BacklogSegment] = Field(default_factory=list)
    totalBacklog: int = 0
    oldestPendingClaim: OldestPendingClaim | None = None


# ------------------------------------------------------------ reviewer activity

class ReviewerStats(BaseModel):
    reviewer: str
    totalDecided: int
    confirmedCount: int
    dismissedCount: int
    # Reflects the mix of claims a reviewer was handed as much as their calls on
    # them; not a quality score.
    confirmRate: float = 0.0
    lastDecisionAt: datetime | None = None


class ReviewerActivityResponse(BaseModel):
    reviewers: list[ReviewerStats] = Field(default_factory=list)
    total: int
    totalDecisions: int
