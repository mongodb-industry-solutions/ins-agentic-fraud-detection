"""FastAPI application: factory, lifespan, exception handlers, router registration.

No business logic lives here — see services/ for rules and repositories/ for queries.
"""

import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.db import create_connector
from core.exceptions import DomainError
from routers.audit import router as audit_router
from routers.chat import router as chat_router
from routers.claims import router as claims_router
from routers.customers import router as customers_router
from routers.embeddings import router as embeddings_router
from routers.fraud import router as fraud_router
from routers.fraud_assessment import router as fraud_assessment_router
from routers.patterns import router as patterns_router
from routers.policies import router as policies_router

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create the one MongoDBConnector for the process and close it on shutdown."""
    connector = create_connector()
    app.state.db = connector
    logger.info("Connected to database '%s'", connector.database_name)
    try:
        yield
    finally:
        connector.client.close()
        logger.info("MongoDB connection closed")


def create_app() -> FastAPI:
    app = FastAPI(
        title="Agentic Fraud Detection API",
        version="0.2.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(DomainError)
    async def domain_error_handler(request: Request, exc: DomainError) -> JSONResponse:
        """Single mapping from domain errors to HTTP responses."""
        logger.info("%s on %s: %s", exc.error_code, request.url.path, exc.message)
        return JSONResponse(
            status_code=exc.status_code,
            content={"error": exc.error_code, "message": exc.message, "details": exc.details},
        )

    @app.get("/", tags=["health"])
    def read_root() -> dict[str, str]:
        return {"message": "Server is running"}

    @app.get("/health", tags=["health"])
    def health(request: Request) -> dict[str, str]:
        """Confirms the process can actually reach MongoDB, not just that it booted."""
        connector = request.app.state.db
        connector.client.admin.command("ping")
        return {"status": "ok", "database": connector.database_name}

    app.include_router(claims_router, prefix="/api")
    app.include_router(audit_router, prefix="/api")
    app.include_router(customers_router, prefix="/api")
    app.include_router(policies_router, prefix="/api")
    app.include_router(patterns_router, prefix="/api")
    app.include_router(fraud_router, prefix="/api")
    app.include_router(chat_router, prefix="/api")
    app.include_router(fraud_assessment_router, prefix="/api")
    app.include_router(embeddings_router, prefix="/api")

    return app


app = create_app()
