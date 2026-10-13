"""Embedding routes: one document, or a whole collection.

Handlers are sync `def` on purpose, and here it matters more than elsewhere:
voyageai.Client and pymongo.MongoClient both block. Declared `async def`, every
embedding call would block the event loop and stall the whole service under
concurrency. As plain `def`, FastAPI runs them in a threadpool.
"""

from fastapi import APIRouter, BackgroundTasks, Path, Query, status

from core.dependencies import EmbeddingsServiceDep
from schemas.embeddings import (
    BackfillJob,
    CollectionEmbeddingStatus,
    DocumentEmbeddingResponse,
    EmbeddingTargetName,
)
from services.embeddings_service import get_job

router = APIRouter(prefix="/embeddings", tags=["embeddings"])

TargetPath = Path(..., description="Which collection: claims or fraud_patterns")
DocumentIdPath = Path(..., description="Business id, e.g. CLM-3002 or FP-017")


@router.post(
    "/documents/{target}/{document_id}",
    response_model=DocumentEmbeddingResponse,
    summary="Embed one document's text and store the vector on it",
)
def embed_document(
    service: EmbeddingsServiceDep,
    target: EmbeddingTargetName = TargetPath,
    document_id: str = DocumentIdPath,
    force: bool = Query(False, description="Re-embed a document that already has a vector"),
) -> DocumentEmbeddingResponse:
    """One endpoint for both collections: `target` selects the collection, its
    business id field and which text field is the embedding source (claims ->
    description, fraud_patterns -> embeddingText).

    Always embedded as input_type="document". A stored vector is corpus, and a
    "query" vector in the corpus silently degrades every score against it.
    """
    return service.embed_document(target.value, document_id, force=force)


@router.get(
    "/collections/{target}",
    response_model=CollectionEmbeddingStatus,
    summary="How much of a collection is embedded, and whether its index exists",
)
def get_collection_status(
    service: EmbeddingsServiceDep,
    target: EmbeddingTargetName = TargetPath,
) -> CollectionEmbeddingStatus:
    """Embeds nothing. Worth calling before and after a backfill — including for
    `vectorIndexPresent`, since a missing vector index makes search return an
    empty list rather than an error."""
    return service.collection_status(target.value)


@router.post(
    "/collections/{target}",
    response_model=BackfillJob,
    status_code=status.HTTP_202_ACCEPTED,
    summary="Start a background backfill of a whole collection",
)
def start_backfill(
    service: EmbeddingsServiceDep,
    background_tasks: BackgroundTasks,
    target: EmbeddingTargetName = TargetPath,
    force: bool = Query(False, description="Clear existing vectors in scope first, re-embedding all"),
) -> BackfillJob:
    """202 with a job id, not a result: a real corpus is minutes to hours of
    work, which must not sit in a request. Poll /embeddings/jobs/{job_id}.

    Idempotent without `force` — it only embeds documents whose embedding is
    missing, empty or null, so re-running after a partial run costs nothing for
    the documents already done. One backfill per target at a time; a second
    concurrent request gets 409 rather than paying Voyage twice for the same
    documents.
    """
    job = service.start_backfill(target.value, force=force)
    background_tasks.add_task(service.run_backfill, job["jobId"])
    return job


@router.get(
    "/jobs/{job_id}",
    response_model=BackfillJob,
    summary="Progress of a backfill job",
)
def get_backfill_job(job_id: str = Path(..., description="jobId from the 202 response")) -> BackfillJob:
    """In-process and not persisted: a restart forgets its jobs, and under more
    than one worker a job is only visible to the worker that started it."""
    return get_job(job_id)
