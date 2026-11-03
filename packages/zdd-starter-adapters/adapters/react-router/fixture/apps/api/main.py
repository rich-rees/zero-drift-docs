# Fixture API: what the web app's screens call.
from fastapi import FastAPI
from routes import admin

app = FastAPI()
app.include_router(admin.router)


@app.get("/me")
async def me():
    """Who is signed in."""
    return {}


@app.get("/activity")
async def activity():
    """The audit trail, newest first."""
    return []
