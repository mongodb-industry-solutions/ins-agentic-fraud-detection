"""Demo administration: put the database back to its starting state."""

from fastapi import APIRouter

from core.dependencies import DemoResetServiceDep

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/reset-demo/status", summary="Which database a reset would wipe")
def reset_status(service: DemoResetServiceDep) -> dict:
    return service.status()


@router.post(
    "/reset-demo",
    summary="Empty the demo collections and reload the starting data (fraud patterns are left alone)",
)
def reset_demo(service: DemoResetServiceDep) -> dict:
    """409 while an assessment is in progress or a decision is being recorded."""
    rows = service.reset()
    return {
        "database": service.status()["database"],
        "collections": [
            {"collection": r["collection"], "deleted": r["deleted"], "inserted": r["inserted"]}
            for r in rows
        ],
    }
