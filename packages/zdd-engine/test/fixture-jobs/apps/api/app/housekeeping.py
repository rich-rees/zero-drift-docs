"""Housekeeping: the sweep that completes a Scheduled job once its deliver-by
date has passed, because no outside system reports a delivery.

Run as its own Railway service on an hourly cron: `python -m app.housekeeping`."""

import asyncio
from sqlalchemy import text


async def sweep(conn):
    due = await conn.execute(text("select id from jobs where status = 'scheduled' and deliver_by < now()"))
    for row in due:
        await conn.execute(text("update jobs set status = 'completed' where id = :id"), {"id": row.id})
        await conn.execute(text("insert into audit_events (job_id, kind) values (:id, 'completed')"), {"id": row.id})


if __name__ == "__main__":
    asyncio.run(sweep(None))
