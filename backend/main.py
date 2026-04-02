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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from routers import auth, chat, ops, profiles
from services.supabase import close_client, _client


# ─────────────────────────────────────────────────────────────────────────────
# Lifespan — handles startup / shutdown of shared async resources
# ─────────────────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: eagerly create the httpx connection pool so the first request
    # doesn't pay the TCP/TLS handshake cost.
    _client()
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

# ── CORS middleware ───────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_origin_regex=r"exp://.*|http://localhost:\d+",
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=86400,
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
