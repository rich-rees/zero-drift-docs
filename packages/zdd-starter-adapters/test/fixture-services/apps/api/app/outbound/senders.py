"""Senders: the email provider over HTTP."""
import httpx
from app.settings import load


async def send(to: str) -> None:
    key = load()["resend_api_key"]
    async with httpx.AsyncClient() as client:
        await client.post("https://api.resend.com/emails", headers={"Authorization": f"Bearer {key}"})
