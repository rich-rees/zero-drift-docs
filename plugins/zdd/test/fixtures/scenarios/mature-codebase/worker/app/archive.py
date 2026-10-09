"""Nightly: archives vehicles not seen for a year."""
import os
SENTRY_DSN = os.environ.get("SENTRY_DSN")
def run():
    conn.execute("update vehicles set archived = true where last_seen < now() - interval ' 1 year '")
