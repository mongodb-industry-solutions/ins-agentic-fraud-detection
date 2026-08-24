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
