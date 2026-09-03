# Fixture FastAPI app: one bare app-level route plus an included router.
from fastapi import FastAPI
from api.routes import jobs

app = FastAPI()
app.include_router(jobs.router)


@app.post("/offers")
async def create_offer(payload: dict):
    """Create an offer against a job."""
    return supabase.table("offers").insert(payload).execute()
