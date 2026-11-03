# Jobs router — prefix-aware: every path below hangs off /jobs.
from fastapi import APIRouter

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.get("/{id}")
async def read_job(id: str):
    """Fetch one job by id."""
    return supabase.table("jobs").select("*").eq("id", id).single().execute()


@router.delete("/{id}")
async def delete_job(id: str):
    return supabase.table("jobs").delete().eq("id", id).execute()
