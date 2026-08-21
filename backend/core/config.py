"""Application settings, read from .env exactly once at import time."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Environment-backed configuration."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    MONGODB_URI: str
    DATABASE_NAME: str
    APP_NAME: str = "ins-agentic-fraud-detection"

    # Collection names, kept here so a rename is a one-line change.
    CLAIMS_COLLECTION: str = "claims"
    CUSTOMERS_COLLECTION: str = "customers"
    POLICIES_COLLECTION: str = "policies"
    PATTERNS_COLLECTION: str = "fraud_patterns"
    REVIEWS_COLLECTION: str = "claim_fraud_reviews"

    # --- fraud assessment agent (MongoDB Agentic Platform) --------------------
    # Optional so the API still boots without them: every other route works
    # without an agent, and /api/chat answers 503 instead of crashing at import.
    FRAUD_AGENT_API_KEY: str | None = None
    FRAUD_AGENT_PROJECT_ID: str | None = None
    FRAUD_AGENT_WORKSPACE_ID: str | None = None
    # Read from the environment with no default: the platform host is not
    # hardcoded anywhere, so pointing the demo at staging is an .env change.
    # Expected to already include the platform's version prefix.
    AGENT_BASE_URL: str | None = None


@lru_cache
def get_settings() -> Settings:
    """Return the singleton Settings instance."""
    return Settings()
