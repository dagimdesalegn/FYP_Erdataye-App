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

logger = logging.getLogger("sentry")

_SENTRY_DSN = os.getenv("SENTRY_DSN", "")
_initialised = False


def init_sentry() -> None:
    """
    Initialise Sentry SDK if SENTRY_DSN is set.
    Safe to call multiple times — only the first call takes effect.
    """
    global _initialised
    if _initialised or not _SENTRY_DSN:
        if not _SENTRY_DSN:
            logger.info("SENTRY_DSN not set — error tracking disabled")
        return

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration

        sentry_sdk.init(
            dsn=_SENTRY_DSN,
            traces_sample_rate=0.2,
            profiles_sample_rate=0.1,
            environment=os.getenv("RENDER_ENV", "development"),
            release=os.getenv("RENDER_GIT_COMMIT", "dev"),
            integrations=[
                FastApiIntegration(),
                StarletteIntegration(),
            ],
            send_default_pii=False,
        )
        _initialised = True
        logger.info("Sentry initialised (DSN=...%s)", _SENTRY_DSN[-12:])
    except ImportError:
        logger.info("sentry-sdk not installed — error tracking disabled")
    except Exception as exc:
        logger.warning("Sentry init failed: %s", exc)


def capture_exception(exc: Exception) -> None:
    """Report an exception to Sentry (no-op if Sentry is not initialised)."""
    if not _initialised:
        return
    try:
        import sentry_sdk
        sentry_sdk.capture_exception(exc)
    except Exception:
        pass


def capture_message(message: str, level: str = "info") -> None:
    """Send a message to Sentry (no-op if Sentry is not initialised)."""
    if not _initialised:
        return
    try:
        import sentry_sdk
        sentry_sdk.capture_message(message, level=level)
    except Exception:
        pass
