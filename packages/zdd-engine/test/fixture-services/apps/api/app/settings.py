"""Settings from the environment: names only, read once."""
import os


def load(e=os.environ):
    return {
        "resend_api_key": e.get("RESEND_API_KEY", ""),
        "email_from": e.get("EMAIL_FROM", ""),
        "sentry_dsn": e.get("SENTRY_DSN", ""),
        "database_url": e.get("DATABASE_URL", ""),
        "supabase_url": e.get("SUPABASE_URL", ""),
        "stripe_secret": e.get("STRIPE_SECRET", ""),
        "stripe_webhook": os.getenv("STRIPE_WEBHOOK_SECRET"),
        "port": e.get("PORT", "8000"),
    }
