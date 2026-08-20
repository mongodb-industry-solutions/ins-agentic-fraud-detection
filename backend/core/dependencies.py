"""FastAPI dependency wiring: connector -> repositories -> services."""

from typing import Annotated

from fastapi import Depends

from core.db import DbDep
from repositories.claims_repo import ClaimsRepository
from repositories.patterns_repo import PatternsRepository
from repositories.reviews_repo import ReviewsRepository
from services.claims_service import ClaimsService
from services.fraud_decision_service import FraudDecisionService


def get_claims_repo(db: DbDep) -> ClaimsRepository:
    return ClaimsRepository(db)


def get_patterns_repo(db: DbDep) -> PatternsRepository:
    return PatternsRepository(db)


def get_reviews_repo(db: DbDep) -> ReviewsRepository:
    return ReviewsRepository(db)


def get_claims_service(
    claims_repo: Annotated[ClaimsRepository, Depends(get_claims_repo)],
    reviews_repo: Annotated[ReviewsRepository, Depends(get_reviews_repo)],
) -> ClaimsService:
    return ClaimsService(claims_repo, reviews_repo)


def get_fraud_decision_service(
    claims_repo: Annotated[ClaimsRepository, Depends(get_claims_repo)],
    patterns_repo: Annotated[PatternsRepository, Depends(get_patterns_repo)],
) -> FraudDecisionService:
    return FraudDecisionService(claims_repo, patterns_repo)


ClaimsServiceDep = Annotated[ClaimsService, Depends(get_claims_service)]
FraudDecisionServiceDep = Annotated[FraudDecisionService, Depends(get_fraud_decision_service)]
