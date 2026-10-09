"""FastAPI dependency wiring: connector -> repositories -> services."""

from typing import Annotated

from fastapi import Depends

from core.config import Settings, get_settings
from core.db import DbDep
from repositories.claims_repo import ClaimsRepository
from repositories.customers_repo import CustomersRepository
from repositories.embeddings_repo import EmbeddingsRepository
from repositories.patterns_repo import PatternsRepository
from repositories.policies_repo import PoliciesRepository
from repositories.reviews_repo import ReviewsRepository
from services.agent_chat_service import AgentChatService
from services.claims_service import ClaimsService
from services.directory_service import DirectoryService
from services.embeddings_service import EmbeddingsService
from services.fraud_analytics_service import FraudAnalyticsService
from services.fraud_assessment_service import FraudAssessmentService
from services.patterns_service import PatternsService


def get_claims_repo(db: DbDep) -> ClaimsRepository:
    return ClaimsRepository(db)


def get_patterns_repo(db: DbDep) -> PatternsRepository:
    return PatternsRepository(db)


def get_embeddings_repo(db: DbDep) -> EmbeddingsRepository:
    return EmbeddingsRepository(db)


def get_reviews_repo(db: DbDep) -> ReviewsRepository:
    return ReviewsRepository(db)


def get_customers_repo(db: DbDep) -> CustomersRepository:
    return CustomersRepository(db)


def get_policies_repo(db: DbDep) -> PoliciesRepository:
    return PoliciesRepository(db)


def get_claims_service(
    claims_repo: Annotated[ClaimsRepository, Depends(get_claims_repo)],
    reviews_repo: Annotated[ReviewsRepository, Depends(get_reviews_repo)],
) -> ClaimsService:
    return ClaimsService(claims_repo, reviews_repo)


def get_directory_service(
    customers_repo: Annotated[CustomersRepository, Depends(get_customers_repo)],
    policies_repo: Annotated[PoliciesRepository, Depends(get_policies_repo)],
) -> DirectoryService:
    return DirectoryService(customers_repo, policies_repo)


def get_patterns_service(
    patterns_repo: Annotated[PatternsRepository, Depends(get_patterns_repo)],
    claims_repo: Annotated[ClaimsRepository, Depends(get_claims_repo)],
) -> PatternsService:
    return PatternsService(patterns_repo, claims_repo)


def get_agent_chat_service(
    settings: Annotated[Settings, Depends(get_settings)],
) -> AgentChatService:
    """Stateless and credential-only, so it needs no database handle."""
    return AgentChatService(settings)


def get_fraud_assessment_service(
    claims_repo: Annotated[ClaimsRepository, Depends(get_claims_repo)],
    agent: Annotated[AgentChatService, Depends(get_agent_chat_service)],
) -> FraudAssessmentService:
    return FraudAssessmentService(claims_repo, agent)


def get_fraud_analytics_service(
    claims_repo: Annotated[ClaimsRepository, Depends(get_claims_repo)],
    reviews_repo: Annotated[ReviewsRepository, Depends(get_reviews_repo)],
    patterns_repo: Annotated[PatternsRepository, Depends(get_patterns_repo)],
) -> FraudAnalyticsService:
    return FraudAnalyticsService(claims_repo, reviews_repo, patterns_repo)


def get_embeddings_service(
    embeddings_repo: Annotated[EmbeddingsRepository, Depends(get_embeddings_repo)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> EmbeddingsService:
    return EmbeddingsService(embeddings_repo, settings)


ClaimsServiceDep = Annotated[ClaimsService, Depends(get_claims_service)]
DirectoryServiceDep = Annotated[DirectoryService, Depends(get_directory_service)]
PatternsServiceDep = Annotated[PatternsService, Depends(get_patterns_service)]
FraudAnalyticsServiceDep = Annotated[FraudAnalyticsService, Depends(get_fraud_analytics_service)]
AgentChatServiceDep = Annotated[AgentChatService, Depends(get_agent_chat_service)]
FraudAssessmentServiceDep = Annotated[FraudAssessmentService, Depends(get_fraud_assessment_service)]
EmbeddingsServiceDep = Annotated[EmbeddingsService, Depends(get_embeddings_service)]
