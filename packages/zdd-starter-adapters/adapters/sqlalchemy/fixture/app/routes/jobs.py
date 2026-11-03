from fastapi import APIRouter
from sqlalchemy import text
from app.repositories import jobs as jobs_repo
from app.repositories.events import (
    record_event,
)
import util

router = APIRouter()


@router.get("/")
async def list_jobs(conn):
    """List the open jobs."""
    return await jobs_repo.list_jobs(conn)


@router.post("/{id}/cancel")
async def cancel(id: str, conn):
    """Cancel a job and record why."""
    await jobs_repo.cancel_job(conn, id)
    await record_event(conn, id, "cancelled")
    return _ok()


@router.get("/count")
async def count_offers(conn):
    """How many offers there are."""
    return await conn.execute(text("SELECT count(*) FROM offers"))


@router.get("/stats")
async def stats(conn):
    """Ambiguous helper module: util.py exists twice."""
    return util.summarise(conn)


def _ok():
    # SELECT * FROM jobs  — a comment, not SQL anyone runs
    return {"ok": True}
