"""Writing Voyage embeddings onto documents: one at a time, or a whole collection.

Two workloads, deliberately shaped differently. Embedding a single document is a
request-path operation and answers synchronously. Backfilling a collection is a
maintenance job — minutes to hours on a real corpus — so it runs in the
background and reports progress through a job record.

Everything persisted here is embedded as input_type="document". Voyage embeddings
are asymmetric: the same text encoded as "document" and as "query" lands in
different places on purpose, because retrieval is better when the stored corpus
and the incoming search key each know their role. A "query" vector written into
the corpus would not error — it would quietly degrade every similarity score
against that document. So input_type is NOT a parameter on these endpoints; it
belongs on a search endpoint, whose whole job is to produce a "query" vector.
"""

import logging
import os
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from core.config import Settings
from core.exceptions import (
    ConflictError,
    EmbeddingsUnavailableError,
    NotFoundError,
    ValidationError,
)
from repositories.embeddings_repo import EMBEDDING_FIELD, EmbeddingsRepository
from voyage import get_embedding, get_embeddings

logger = logging.getLogger(__name__)

# Voyage takes a list per call; batching is roughly an order of magnitude fewer
# round trips than one call per document, and far kinder to the rate limit.
BATCH_SIZE = 64

# Voyage has a token limit per input. A blob far past it fails slowly and costs
# money doing it, so oversized text is refused up front rather than truncated —
# a silently truncated embedding is a wrong embedding that looks fine.
MAX_SOURCE_CHARS = 32_000


@dataclass(frozen=True)
class EmbeddingTarget:
    """What "embed this collection" means for one collection.

    Adapted from backfill_embeddings.PRESETS, plus the business id field (so a
    caller names documents the way the rest of the API does, CLM-3002 rather
    than an ObjectId) and the index the vectors are searched through.
    """

    name: str
    collection: str
    id_field: str
    source_field: str
    scope: dict[str, Any]
    index_name: str
    out_of_scope_reason: str


class EmbeddingsService:
    """Generates and stores embeddings for the embeddable collections."""

    def __init__(self, repo: EmbeddingsRepository, settings: Settings):
        self.repo = repo
        self.settings = settings

    # ------------------------------------------------------------- targets

    def targets(self) -> dict[str, EmbeddingTarget]:
        """The allowlist. A caller can only ever name a key of this mapping, so
        no request can steer an update_many at an arbitrary collection."""
        settings = self.settings
        return {
            "claims": EmbeddingTarget(
                name="claims",
                collection=settings.CLAIMS_COLLECTION,
                id_field="claimId",
                source_field="description",
                # Every claim with a description belongs in the searchable
                # corpus, scored or not.
                scope={},
                index_name=settings.CLAIM_VECTOR_INDEX,
                out_of_scope_reason="",
            ),
            "fraud_patterns": EmbeddingTarget(
                name="fraud_patterns",
                collection=settings.PATTERNS_COLLECTION,
                id_field="patternId",
                source_field="embeddingText",
                # RULE patterns are matched by deterministic field comparisons
                # and have no narrative to embed. Embedding one would put a
                # vector on a document nothing will ever search by narrative.
                scope={"patternType": "HISTORICAL_SIMILARITY"},
                index_name=settings.PATTERN_VECTOR_INDEX,
                out_of_scope_reason=(
                    "Only HISTORICAL_SIMILARITY patterns are embedded — a RULE pattern is "
                    "matched by its conditions, not by narrative similarity."
                ),
            ),
        }

    def _api_key_present(self) -> bool:
        """Whether a Voyage key is reachable at all.

        Checked against both sources because they resolve differently: pydantic
        settings read `.env` relative to the process working directory, while
        voyage/getters.py calls load_dotenv() itself and reads os.environ at
        call time. Trusting only Settings would 503 on a key the embedding layer
        can actually see.
        """
        return bool(self.settings.VOYAGE_API_KEY or os.getenv("VOYAGE_API_KEY"))

    def target(self, name: str) -> EmbeddingTarget:
        target = self.targets().get(name)
        if target is None:
            raise NotFoundError("embedding target", name)
        return target

    # ------------------------------------------------- single document

    def embed_document(self, target_name: str, document_id: str, force: bool = False) -> dict:
        """Embed one document's source text and store the vector on it."""
        target = self.target(target_name)
        document = self.repo.find_document(
            target.collection, target.id_field, document_id, target.source_field
        )
        if document is None:
            raise NotFoundError(target_name, document_id)

        # The scope is a rule about what may be embedded, so it is enforced on
        # the single-document path too — otherwise this endpoint would be a way
        # around it.
        if not self._in_scope(target, document_id):
            raise ValidationError(target.out_of_scope_reason, details={"documentId": document_id})

        existing = document.get(EMBEDDING_FIELD)
        if existing and not force:
            return self._document_result(
                target, document_id, embedded=False, dimensions=len(existing),
                skipped="Already embedded — pass force=true to re-embed.",
            )

        text = (document.get(target.source_field) or "").strip()
        if not text:
            raise ValidationError(
                f"{document_id} has no text in '{target.source_field}' to embed.",
                details={"sourceField": target.source_field},
            )
        if len(text) > MAX_SOURCE_CHARS:
            raise ValidationError(
                f"'{target.source_field}' is {len(text)} characters; the limit is "
                f"{MAX_SOURCE_CHARS}.",
                details={"sourceField": target.source_field, "characters": len(text)},
            )

        vector = get_embedding(text, model_id=self.settings.VOYAGE_MODEL, input_type="document")
        if vector is None:
            raise EmbeddingsUnavailableError(
                "Voyage did not return an embedding. Check VOYAGE_API_KEY and Voyage's status."
            )

        self.repo.set_embedding(target.collection, document["_id"], vector)
        return self._document_result(
            target, document_id, embedded=True, dimensions=len(vector),
            characters=len(text),
            dimension_warning=self._dimension_warning(len(vector)),
        )

    def _in_scope(self, target: EmbeddingTarget, document_id: str) -> bool:
        if not target.scope:
            return True
        query = dict(target.scope)
        query[target.id_field] = document_id
        return self.repo.count_in_scope(target.collection, query) == 1

    def _document_result(
        self,
        target: EmbeddingTarget,
        document_id: str,
        embedded: bool,
        dimensions: int | None,
        skipped: str | None = None,
        characters: int | None = None,
        dimension_warning: str | None = None,
    ) -> dict:
        return {
            "target": target.name,
            "documentId": document_id,
            "embedded": embedded,
            "skipped": skipped,
            "dimensions": dimensions,
            "model": self.settings.VOYAGE_MODEL,
            "sourceField": target.source_field,
            "sourceCharacters": characters,
            "dimensionWarning": dimension_warning,
        }

    def _dimension_warning(self, dimensions: int) -> str | None:
        expected = self.settings.VOYAGE_VECTOR_DIMS
        if dimensions == expected:
            return None
        return (
            f"Stored {dimensions} dimensions but the Atlas index expects {expected}. "
            "VOYAGE_MODEL and the vector index must agree or vector search will fail."
        )

    # ------------------------------------------------------ collection

    def collection_status(self, target_name: str) -> dict:
        """Counts and index state for one target, without embedding anything."""
        target = self.target(target_name)
        in_scope = self.repo.count_in_scope(target.collection, target.scope)
        pending = self.repo.count_pending(target.collection, target.source_field, target.scope)
        return {
            "target": target.name,
            "collection": target.collection,
            "sourceField": target.source_field,
            "scope": target.scope,
            "documentsInScope": in_scope,
            "pending": pending,
            "embedded": in_scope - pending,
            "vectorIndex": target.index_name,
            "vectorIndexPresent": self.repo.has_search_index(
                target.collection, target.index_name
            ),
            "model": self.settings.VOYAGE_MODEL,
            "expectedDimensions": self.settings.VOYAGE_VECTOR_DIMS,
        }

    def start_backfill(self, target_name: str, force: bool = False) -> dict:
        """Register a backfill job and return it for a 202. Does no work yet."""
        target = self.target(target_name)

        if not self._api_key_present():
            # Refused here rather than inside the job: a 202 followed by a
            # failed job is a worse answer than an immediate 503.
            raise EmbeddingsUnavailableError(
                "VOYAGE_API_KEY is not configured — cannot run a backfill."
            )

        job = _register_job(target.name, force)
        return job

    def run_backfill(self, job_id: str) -> None:
        """The job body. Runs in a background thread, never in the request path."""
        job = _get_job(job_id)
        if job is None:
            logger.error("Backfill job %s vanished before it ran.", job_id)
            return

        target = self.target(job["target"])
        try:
            _update_job(job_id, status="running", startedAt=_now())

            if job["force"]:
                cleared = self.repo.clear_embeddings(target.collection, target.scope)
                _update_job(job_id, cleared=cleared)

            total = self.repo.count_pending(
                target.collection, target.source_field, target.scope
            )
            _update_job(job_id, totalPending=total)

            processed, failed = self._process_pending(job_id, target)

            dimensions = self.repo.sample_dimensions(target.collection, target.scope)
            _update_job(
                job_id,
                status="succeeded",
                finishedAt=_now(),
                processed=processed,
                failed=failed,
                remaining=self.repo.count_pending(
                    target.collection, target.source_field, target.scope
                ),
                dimensions=dimensions,
                dimensionWarning=(
                    self._dimension_warning(dimensions) if dimensions else None
                ),
            )
        except Exception as exc:  # noqa: BLE001 - a job records its failure
            logger.exception("Backfill job %s failed", job_id)
            _update_job(job_id, status="failed", finishedAt=_now(), error=str(exc))
        finally:
            _release_target(target.name)

    def _process_pending(self, job_id: str, target: EmbeddingTarget) -> tuple[int, int]:
        """Walk the unembedded set in `_id` order, one Voyage call per batch."""
        processed = 0
        failed = 0
        after_id = None

        while True:
            batch = self.repo.next_pending_batch(
                target.collection, target.source_field, target.scope, BATCH_SIZE, after_id
            )
            if not batch:
                break
            after_id = batch[-1]["_id"]

            usable = []
            for document in batch:
                text = (document.get(target.source_field) or "").strip()
                if not text or len(text) > MAX_SOURCE_CHARS:
                    # Counted, not silently dropped: the job's totals have to
                    # account for every document it looked at.
                    failed += 1
                    continue
                usable.append((document["_id"], text))

            if not usable:
                continue

            vectors = get_embeddings(
                [text for _, text in usable],
                model_id=self.settings.VOYAGE_MODEL,
                input_type="document",
            )
            if vectors is None:
                raise EmbeddingsUnavailableError(
                    "Voyage stopped returning embeddings partway through the backfill."
                )

            for (mongo_id, _), vector in zip(usable, vectors):
                self.repo.set_embedding(target.collection, mongo_id, vector)
                processed += 1

            _update_job(job_id, processed=processed, failed=failed)

        return processed, failed


# --------------------------------------------------------------- job store

# In-process, because this is the simplest thing that is honest about what it is:
# one dict guarded by a lock, holding jobs for the lifetime of the process. It
# does NOT survive a restart and is NOT shared between workers — running the API
# under more than one worker means a job started on one is invisible to the
# others, and the concurrency guard below only guards its own process. Moving to
# a real queue means replacing this block and nothing else.
_JOBS: dict[str, dict] = {}
_ACTIVE_TARGETS: set[str] = set()
_LOCK = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _register_job(target_name: str, force: bool) -> dict:
    """Claim the target and create its job, or refuse if one is already running.

    Two overlapping backfills on the same collection would pay Voyage twice for
    the same documents, so the target is claimed under the same lock that
    creates the job.
    """
    with _LOCK:
        if target_name in _ACTIVE_TARGETS:
            raise ConflictError(
                f"A backfill for '{target_name}' is already running.",
                details={"target": target_name},
            )
        _ACTIVE_TARGETS.add(target_name)

        job = {
            "jobId": uuid.uuid4().hex,
            "target": target_name,
            "force": force,
            "status": "queued",
            "createdAt": _now(),
            "startedAt": None,
            "finishedAt": None,
            "totalPending": None,
            "processed": 0,
            "failed": 0,
            "remaining": None,
            "cleared": None,
            "dimensions": None,
            "dimensionWarning": None,
            "error": None,
        }
        _JOBS[job["jobId"]] = job
        return dict(job)


def _release_target(target_name: str) -> None:
    with _LOCK:
        _ACTIVE_TARGETS.discard(target_name)


def _update_job(job_id: str, **fields) -> None:
    with _LOCK:
        job = _JOBS.get(job_id)
        if job is not None:
            job.update(fields)


def _get_job(job_id: str) -> dict | None:
    with _LOCK:
        job = _JOBS.get(job_id)
        return dict(job) if job else None


def get_job(job_id: str) -> dict:
    """A job's current state, for the status endpoint."""
    job = _get_job(job_id)
    if job is None:
        raise NotFoundError("embedding job", job_id)
    return job
