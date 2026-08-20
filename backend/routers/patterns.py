"""Fraud-pattern catalogue routes (the reliability leaderboard and its drill-down)."""

from fastapi import APIRouter, Path, Query

from core.dependencies import PatternsServiceDep
from repositories.patterns_repo import DEFAULT_PATTERN_SORT
from schemas.patterns import (
    FraudPatternDetailResponse,
    FraudPatternListResponse,
    PatternTypeFilter,
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
    """Unpaginated on purpose: the catalogue is a small, hand-authored set."""
    return service.list_patterns(pattern_type=patternType.value, active=active, sort=sort)


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
