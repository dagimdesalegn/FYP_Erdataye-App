"""
Erdataye Backend — FastAPI application entry point.

Architecture:
  /auth/*      — Registration, login, token refresh (public)
  /profiles/*  — User & medical profile CRUD (JWT-protected)
  /chat        — First aid DeepSeek chatbot (public)
  /health      — Liveness probe (public)

Run (development):
  cd backend
  pip install -r requirements.txt
  uvicorn main:app --host 0.0.0.0 --port 8000 --reload

Run (production):
  uvicorn main:app --host 0.0.0.0 --port 8000 --workers 4
"""

from contextlib import asynccontextmanager
import time
from collections import defaultdict
from threading import Lock

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware

from config import settings
from routers import auth, chat, ops, profiles
from services.supabase import close_client
from services.sentry import init_sentry


# ─────────────────────────────────────────────────────────────────────────────
# Lifespan — handles startup / shutdown of shared async resources
# ─────────────────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: initialise error tracking
    init_sentry()
    yield
    # Shutdown: gracefully drain the connection pool
    await close_client()


# ─────────────────────────────────────────────────────────────────────────────
# FastAPI application
# ─────────────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Erdataye Backend API",
    description=(
        "Secure Python backend for the Erdataye Ambulance App. "
        "Handles authentication, user profiles, and the AI first aid chatbot."
    ),
    version="2.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ── Rate-limiting middleware ────────────────────────────────────────────

# Simple in-memory token-bucket rate limiter.
# Keyed by (client_ip, route_group).  Limits:
#   /ops/patient/emergencies  → 3 req/min  (prevent spam emergency)
#   all other routes           → 60 req/min

_RATE_BUCKETS: dict[str, list] = defaultdict(lambda: [0.0, 0])  # [window_start, count]
_RATE_WINDOW = 60.0  # seconds
_RATE_LOCK = Lock()

# Per-path limits (exact match).  Everything else → _DEFAULT_LIMIT per path.
_ROUTE_LIMITS: dict[str, int] = {
    "/ops/patient/emergencies": 3,   # prevent spam emergency creation
}
_DEFAULT_LIMIT = 200   # generous per-path budget for polling endpoints


def _client_ip(request: Request) -> str:
    forwarded_for = request.headers.get("x-forwarded-for", "").strip()
    if forwarded_for:
        return forwarded_for.split(",", 1)[0].strip() or "unknown"
    return request.client.host if request.client else "unknown"


def _cors_origin_regex() -> str:
    if any(origin.startswith("exp://") for origin in settings.origins_list):
        return r"exp://.*"
    return ""


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.method == "OPTIONS":
            return await call_next(request)

        client_ip = _client_ip(request)
        path = request.url.path

        limit = _ROUTE_LIMITS.get(path, _DEFAULT_LIMIT)
        # Key per path so one polling endpoint can't starve others
        key = f"{client_ip}:{path}"

        now = time.monotonic()
        with _RATE_LOCK:
            bucket = _RATE_BUCKETS[key]
            if now - bucket[0] > _RATE_WINDOW:
                bucket[0] = now
                bucket[1] = 0
            bucket[1] += 1
            count = bucket[1]

        if count > limit:
            return Response(
                content='{"detail":"Too many requests. Please try again later."}',
                status_code=429,
                media_type="application/json",
            )

        return await call_next(request)


app.add_middleware(RateLimitMiddleware)

# ── CORS middleware ───────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_origin_regex=_cors_origin_regex() or None,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=600,
)

# ── Routers ───────────────────────────────────────────────────────────────────

app.include_router(auth.router)
app.include_router(profiles.router)
app.include_router(chat.router)
app.include_router(ops.router)


# ── Health probe ─────────────────────────────────────────────────────────────


@app.get("/health", tags=["Health"], summary="Liveness probe")
async def health() -> dict:
    return {"status": "ok", "service": "erdataye-backend", "version": "2.0.0"}
