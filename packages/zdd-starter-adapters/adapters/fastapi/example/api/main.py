"""An example API: one router, two routes."""
from fastapi import APIRouter, FastAPI

app = FastAPI()
router = APIRouter(prefix="/orders")


@router.get("/{id}")
def get_order(id: str):
    """Read one order."""
    return {"id": id}


@router.post("")
def create_order(payload: dict):
    """Create an order."""
    return payload


app.include_router(router)
