# Administration routes.
from fastapi import APIRouter

router = APIRouter()


@router.get("/users")
async def users():
    """Every user."""
    return []


@router.post("/users/invite")
async def invite(payload: dict):
    """Invite a user."""
    return {}


@router.get("/tenants")
async def tenants():
    """Every tenant."""
    return []
