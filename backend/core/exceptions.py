"""Domain exceptions.

Services raise these; main.py maps them to HTTP responses in one place, so no
handler has to hand-roll an HTTPException.
"""


class DomainError(Exception):
    """Base class for errors that map to a specific HTTP status."""

    status_code = 500
    error_code = "internal_error"

    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class NotFoundError(DomainError):
    """A referenced resource does not exist."""

    status_code = 404
    error_code = "not_found"

    def __init__(self, resource: str, identifier: str | None = None, details: dict | None = None):
        message = f"{resource} '{identifier}' not found" if identifier else f"{resource} not found"
        super().__init__(message, details)
        self.resource = resource
        self.identifier = identifier


class ConflictError(DomainError):
    """The request is valid but conflicts with the resource's current state."""

    status_code = 409
    error_code = "conflict"


class ValidationError(DomainError):
    """The request body violates a business rule (as opposed to a schema rule)."""

    status_code = 400
    error_code = "validation_error"
