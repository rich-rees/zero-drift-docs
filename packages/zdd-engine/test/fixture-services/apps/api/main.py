"""The API."""
import os
from fastapi import FastAPI
from app import monitoring

app = FastAPI()
monitoring.configure(os.environ.get("SENTRY_DSN", ""))


@app.get("/health")
async def health():
    """Liveness; says whether the error monitor is on."""
    return {"monitor": bool(os.environ.get("SENTRY_DSN"))}
