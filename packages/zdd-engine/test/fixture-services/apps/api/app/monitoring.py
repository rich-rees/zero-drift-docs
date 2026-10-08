"""The error monitor: Sentry. The SDK is imported here and nowhere else."""
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration


def configure(dsn: str) -> None:
    if dsn:
        sentry_sdk.init(dsn=dsn, integrations=[FastApiIntegration()])
