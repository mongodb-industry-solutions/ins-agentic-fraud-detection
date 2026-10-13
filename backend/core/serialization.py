"""Helpers for turning raw BSON documents into JSON-safe structures."""

from datetime import date, datetime
from typing import Any

from bson import ObjectId


def to_jsonable(value: Any) -> Any:
    """Recursively convert ObjectId/datetime values so FastAPI can serialize them.

    `_id` is dropped entirely: the API addresses documents by their business
    keys (claimId, patternId, ...), never by ObjectId.
    """
    if isinstance(value, dict):
        return {k: to_jsonable(v) for k, v in value.items() if k != "_id"}
    if isinstance(value, list):
        return [to_jsonable(v) for v in value]
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return value
