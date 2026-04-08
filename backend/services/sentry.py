"""
Sentry integration for the Erdataye backend.

Initialises Sentry error tracking when SENTRY_DSN is set in the
environment. Safe to import even when Sentry is not configured —
all calls become no-ops.

Usage:
  from services.sentry import init_sentry
  init_sentry()   # call once in main.py lifespan
"""

import logging
import os
from importlib import import_module

logger = logging.getLogger("sentry")

_SENTRY_DSN = os.getenv("SENTRY_DSN", "")
_initialised = False
_sentry_sdk = None


def _load_sentry_modules():
    try:
        sentry_sdk = import_module("sentry_sdk")
        fastapi_integration = import_module(
            "sentry_sdk.integrations.fastapi"
        ).FastApiIntegration
        starlette_integration = import_module(
            "sentry_sdk.integrations.starlette"
        ).StarletteIntegration
        return sentry_sdk, fastapi_integration, starlette_integration
    except Exception:
        return None, None, None


def init_sentry() -> None:
    """
    Initialise Sentry SDK if SENTRY_DSN is set.
    Safe to call multiple times — only the first call takes effect.
    """
    global _initialised, _sentry_sdk
    if _initialised or not _SENTRY_DSN:
        if not _SENTRY_DSN:
            logger.info("SENTRY_DSN not set — error tracking disabled")
        return

    try:
        sentry_sdk, fastapi_integration, starlette_integration = _load_sentry_modules()
        if not sentry_sdk or not fastapi_integration or not starlette_integration:
            logger.info("sentry-sdk not installed — error tracking disabled")
            return

        sentry_sdk.init(
            dsn=_SENTRY_DSN,
            traces_sample_rate=0.2,
            profiles_sample_rate=0.1,
            environment=os.getenv("RENDER_ENV", "development"),
            release=os.getenv("RENDER_GIT_COMMIT", "dev"),
            integrations=[
                fastapi_integration(),
                starlette_integration(),
            ],
            send_default_pii=False,
        )
        _sentry_sdk = sentry_sdk
        _initialised = True
        logger.info("Sentry initialised (DSN=...%s)", _SENTRY_DSN[-12:])
    except Exception as exc:
        logger.warning("Sentry init failed: %s", exc)


def capture_exception(exc: Exception) -> None:
    """Report an exception to Sentry (no-op if Sentry is not initialised)."""
    if not _initialised or _sentry_sdk is None:
        return
    try:
        _sentry_sdk.capture_exception(exc)
    except Exception:
        pass


def capture_message(message: str, level: str = "info") -> None:
    """Send a message to Sentry (no-op if Sentry is not initialised)."""
    if not _initialised or _sentry_sdk is None:
        return
    try:
        _sentry_sdk.capture_message(message, level=level)
    except Exception:
        pass
