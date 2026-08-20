"""Single MongoDBConnector instance, owned by the app lifespan.

The connector is created once at startup and attached to `app.state.db`;
`get_db` is the FastAPI dependency that hands it to repositories. Nothing in
the request path constructs a MongoClient.
"""

from typing import Annotated

from fastapi import Depends, Request

from core.config import get_settings
from db.mdb import MongoDBConnector


def create_connector() -> MongoDBConnector:
    """Build the process-wide connector from settings."""
    settings = get_settings()
    return MongoDBConnector(
        uri=settings.MONGODB_URI,
        database_name=settings.DATABASE_NAME,
        appname=settings.APP_NAME,
    )


def get_db(request: Request) -> MongoDBConnector:
    """FastAPI dependency: the connector created during lifespan startup."""
    return request.app.state.db


DbDep = Annotated[MongoDBConnector, Depends(get_db)]
