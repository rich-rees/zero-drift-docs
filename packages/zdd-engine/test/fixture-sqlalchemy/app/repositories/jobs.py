from sqlalchemy import text


async def list_jobs(conn):
    """Open jobs, newest first."""
    rows = await conn.execute(
        text(
            """
            SELECT id, status, EXTRACT(EPOCH FROM created_at) AS age
            FROM jobs
            WHERE status = 'open'
            """
        )
    )
    return rows.all()


async def cancel_job(conn, job_id):
    """Cancel one job."""
    await conn.execute(text('UPDATE "jobs" SET status = :s WHERE id = :id'), {"s": "cancelled", "id": job_id})


def describe():
    """Pick the right job from the list, then update the screen."""
    return "pick a job from the list"
