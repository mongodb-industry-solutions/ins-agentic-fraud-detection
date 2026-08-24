"""Pydantic models for the embeddings router."""

from enum import Enum
from typing import Any

from pydantic import BaseModel


class EmbeddingTargetName(str, Enum):
    """The allowlist, as an enum so an unknown collection is rejected by the
    schema instead of reaching a service that could update_many it."""

    CLAIMS = "claims"
    FRAUD_PATTERNS = "fraud_patterns"


class DocumentEmbeddingResponse(BaseModel):
    target: str
    documentId: str
    # False with a `skipped` reason when the document already had a vector and
    # force was not set — not an error, just nothing to do.
    embedded: bool
    skipped: str | None = None
    dimensions: int | None = None
    model: str
    sourceField: str
    sourceCharacters: int | None = None
    # Set when what was stored does not match the index's numDimensions.
    dimensionWarning: str | None = None


class CollectionEmbeddingStatus(BaseModel):
    target: str
    collection: str
    sourceField: str
    scope: dict[str, Any]
    documentsInScope: int
    pending: int
    embedded: int
    vectorIndex: str
    # None means the deployment would not say — not that the index is absent.
    vectorIndexPresent: bool | None = None
    model: str
    expectedDimensions: int


class BackfillJob(BaseModel):
    jobId: str
    target: str
    force: bool
    status: str  # queued | running | succeeded | failed
    createdAt: str
    startedAt: str | None = None
    finishedAt: str | None = None
    totalPending: int | None = None
    processed: int = 0
    # Documents skipped because their source text was empty or oversized.
    failed: int = 0
    remaining: int | None = None
    cleared: int | None = None
    dimensions: int | None = None
    dimensionWarning: str | None = None
    error: str | None = None
