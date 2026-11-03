from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
async def health():
    """Liveness."""
    return {}


@app.get("/jobs")
async def list_jobs():
    """Every job the caller may see."""
    return []


@app.post("/jobs/{job_id}/route-search")
async def route_search(job_id: str):
    """Search fixed routes for a job."""
    return []


@app.post("/jobs/{job_id}/route")
async def choose_route(job_id: str):
    """Put a job on a fixed route."""
    return {}
