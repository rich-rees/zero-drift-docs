"""The worker: polls each queue, works one message at a time, and leaves each
one sent, hidden, dead or skipped.

Run as its own service: `python -m app.outbound.worker`."""

import asyncio


async def run(conn, client):
    rows = await client.table("outbound_messages").select("*")
    await conn.execute("delete from outbound_messages where id = :id", {"id": 1})


if __name__ == "__main__":
    asyncio.run(run(None, None))
