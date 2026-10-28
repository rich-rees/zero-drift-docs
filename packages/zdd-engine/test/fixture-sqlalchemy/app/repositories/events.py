from sqlalchemy import text


async def record_event(conn, job_id, kind):
    """Write the audit event in the caller's transaction."""
    await conn.execute(text("INSERT INTO public.job_events (job_id, kind) VALUES (:j, :k)"), {"j": job_id, "k": kind})
