"""Fraud-pattern catalogue routes (the reliability leaderboard and its drill-down)."""

from fastapi import APIRouter, Path, Query, status

from core.dependencies import PatternsServiceDep
from repositories.patterns_repo import DEFAULT_PATTERN_SORT
from schemas.patterns import (
    FraudPatternCreateRequest,
    FraudPatternCreateResponse,
    FraudPatternDetailResponse,
    FraudPatternListResponse,
    FraudPatternUpdateRequest,
    FraudPatternWriteResponse,
    PatternLeaderboardResponse,
    PatternTypeFilter,
    WhyEffectiveRegenerateResponse,
)

router = APIRouter(prefix="/fraud-patterns", tags=["fraud-patterns"])

PatternIdPath = Path(..., description="Business pattern id, e.g. FP-005")


@router.get("", response_model=FraudPatternListResponse, summary="The full fraud-pattern catalogue")
def list_fraud_patterns(
    service: PatternsServiceDep,
    patternType: PatternTypeFilter = Query(PatternTypeFilter.ALL),
    active: bool | None = Query(None, description="Omit for both active and retired patterns"),
    sort: str = Query(DEFAULT_PATTERN_SORT, description="Field name, prefix with '-' for descending"),
) -> FraudPatternListResponse:
    """Unpaginated on purpose: the catalogue is a small, hand-authored set.

    Every pattern carries a `whyEffective` sentence describing how much a match
    by it is actually worth. It is read from storage where it has been generated
    and composed on the fly otherwise, so it is never null — see
    POST /fraud-patterns/why-effective/regenerate.
    """
    return service.list_patterns(pattern_type=patternType.value, active=active, sort=sort)


@router.post(
    "/why-effective/regenerate",
    response_model=WhyEffectiveRegenerateResponse,
    summary="Regenerate the stored reliability blurbs from current stats",
)
def regenerate_why_effective(
    service: PatternsServiceDep,
    patternId: str | None = Query(None, description="Omit to regenerate the whole catalogue"),
) -> WhyEffectiveRegenerateResponse:
    """Meant to be run periodically, or after a batch of decisions has moved
    `confirmedFraudRate`. The text is a pure function of the pattern's stats, so
    running it twice with no decisions in between changes nothing and reports
    `patternsChanged: 0`."""
    return service.regenerate_why_effective(patternId)


@router.get(
    "/leaderboard",
    response_model=PatternLeaderboardResponse,
    summary="The most-triggered active patterns, with their reliability blurb",
)
def get_top_patterns_leaderboard(
    service: PatternsServiceDep,
    limit: int = Query(5, ge=1, le=25, description="Rows returned, ranked by trigger volume"),
) -> PatternLeaderboardResponse:
    """Ranked strictly by `stats.timesTriggered`, descending, over active
    patterns only. `totalActivePatternCount` is the catalogue size behind the
    ranking, so the client can say "top 5 of 19" without a second request.

    Declared above `/{pattern_id}`: FastAPI matches routes in declaration order,
    and the reverse order would resolve this path as a pattern whose id is
    literally "leaderboard" and answer 404.
    """
    return service.get_leaderboard(limit=limit)


@router.post(
    "",
    response_model=FraudPatternCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a pattern to the catalogue",
)
def create_fraud_pattern(
    payload: FraudPatternCreateRequest,
    service: PatternsServiceDep,
) -> FraudPatternCreateResponse:
    """The id, the zeroed stats and the timestamps are assigned by the service.
    A similarity pattern is created without an embedding and is therefore inert
    until the embedding procedure runs — the response flags that."""
    return service.create_pattern(payload.model_dump(mode="json"))


@router.get(
    "/{pattern_id}",
    response_model=FraudPatternDetailResponse,
    summary="A pattern with the claims it actually fired on",
)
def get_fraud_pattern_detail(
    service: PatternsServiceDep,
    pattern_id: str = PatternIdPath,
) -> FraudPatternDetailResponse:
    return service.get_pattern_detail(pattern_id)


@router.patch(
    "/{pattern_id}",
    response_model=FraudPatternWriteResponse,
    summary="Partial update of a pattern's editable configuration",
)
def update_fraud_pattern(
    payload: FraudPatternUpdateRequest,
    service: PatternsServiceDep,
    pattern_id: str = PatternIdPath,
) -> FraudPatternWriteResponse:
    """Activation, weight, severity and prose. What a pattern *matches* is not
    editable here — see FraudPatternUpdateRequest."""
    return service.update_pattern(pattern_id, payload.changed_fields())
