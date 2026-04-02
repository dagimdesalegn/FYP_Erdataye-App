"""
First Aid Chatbot router — powered by DeepSeek AI.

The AI endpoint is intentionally public (no JWT required) because access to
emergency first aid guidance must not be gated behind authentication.
Message storage endpoints require authentication.
"""

import json
import logging
import re
import time
from collections import defaultdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from openai import AsyncOpenAI, OpenAIError
from pydantic import BaseModel, Field

from config import settings
from deps import get_current_user
from services.supabase import db_insert, db_select, db_delete

router = APIRouter(prefix="/chat", tags=["Chatbot"])
logger = logging.getLogger("chat_router")

# ─────────────────────────────────────────────────────────────────────────────
# In-memory rate limiter — 20 requests per minute per IP
# ─────────────────────────────────────────────────────────────────────────────

_RATE_LIMIT = 20
_RATE_WINDOW = 60  # seconds
_rate_buckets: dict[str, list[float]] = defaultdict(list)


def _check_rate(ip: str) -> bool:
    """Return True if the request is within the rate limit."""
    now = time.time()
    bucket = _rate_buckets[ip]
    # Prune stale entries
    _rate_buckets[ip] = bucket = [t for t in bucket if now - t < _RATE_WINDOW]
    if len(bucket) >= _RATE_LIMIT:
        return False
    bucket.append(now)
    return True

# ─────────────────────────────────────────────────────────────────────────────
# DeepSeek client (OpenAI-compatible SDK) — async for non-blocking I/O
# The API key never reaches the mobile client.
# ─────────────────────────────────────────────────────────────────────────────

_deepseek = AsyncOpenAI(
    api_key=settings.deepseek_api_key,
    base_url="https://api.deepseek.com",
)

# Mutable model name — can be changed at runtime via admin settings endpoint
_MODEL = "deepseek-chat"

# ─────────────────────────────────────────────────────────────────────────────
# System prompt — WHO first aid domain + Ethiopian context
# ─────────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are the First Aid Assistant for the Erdataye Ambulance App, serving users in Ethiopia.
You provide WHO-based first aid guidance focused on immediate patient safety.

RESPONSE PRIORITY:
- First give clear first-aid actions the user can do right now.
- Do NOT start with phone numbers.
- Add contact numbers only at the end, and only when professional help is needed.

RESPONSE FORMAT (plain text only):
Condition: <short name>
Immediate first aid:
1) <action>
2) <action>
3) <action>
Warning signs to watch:
- <sign>
When to contact emergency help:
- <condition>
- Ethiopia numbers: 952 (ambulance), 911 (police/fire)
Reminder: This is first aid guidance, not a medical diagnosis.

RULES:
1) Be accurate, practical, and action-first. Keep steps short and specific.
2) Never diagnose diseases. Give first aid support until professionals take over.
3) Only include "When to contact emergency help" when truly needed by severity or risk signs.
4) For non-urgent/minor cases, focus on home first aid and monitoring; avoid unnecessary emergency-number instructions.
5) NEVER use markdown. No asterisks, bold, hashtags, or decorative symbols.
6) If the user asks about non-health topics, reply exactly: I can only help with first aid and emergency guidance.
7) Be calm and reassuring.
8) After your answer, on a new line write:
    FOLLOW_UPS: ["question 1", "question 2"]
"""


# ─────────────────────────────────────────────────────────────────────────────
# Models
# ─────────────────────────────────────────────────────────────────────────────


class HistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(..., max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: list[HistoryMessage] = Field(default_factory=list, max_length=20)
    lang: str = Field(default="en", pattern="^(en|am|om)$")


class ChatResponse(BaseModel):
    reply: str
    follow_ups: list[str]


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────────────────────


@router.post("", response_model=ChatResponse, summary="Ask the first aid chatbot")
async def chat(req: ChatRequest, request: Request) -> ChatResponse:
    """
    Send a user message and optional conversation history.
    Returns an AI-generated WHO-grounded first aid response plus follow-up suggestions.
    """
    client_ip = request.client.host if request.client else "unknown"
    if not _check_rate(client_ip):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Rate limit exceeded. Please wait a moment before sending another message.",
        )
    lang_instruction = {
        "en": "Respond in English.",
        "am": "Respond in Amharic (አማርኛ).",
        "om": "Respond in Afaan Oromoo.",
    }.get(req.lang, "Respond in English.")
    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT + "\n" + lang_instruction}]

    # Keep last 20 history entries to bound token usage
    for entry in req.history[-20:]:
        messages.append({"role": entry.role, "content": entry.content})

    messages.append({"role": "user", "content": req.message.strip()})

    try:
        completion = await _deepseek.chat.completions.create(
            model=_MODEL,
            messages=messages,
            temperature=0.35,  # lower = more factual / consistent for medical guidance
            max_tokens=1024,
        )
    except OpenAIError:
        logger.exception("DeepSeek API call failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI service is temporarily unavailable. Please try again shortly.",
        )

    raw: str = completion.choices[0].message.content or ""

    # Strip any markdown formatting the model may produce
    raw = raw.replace("**", "").replace("*", "")
    # Remove markdown headers (# ## ### etc.)
    raw = re.sub(r"^#{1,6}\s*", "", raw, flags=re.MULTILINE)

    # Parse optional FOLLOW_UPS block appended by the model
    reply = raw
    follow_ups: list[str] = []

    if "FOLLOW_UPS:" in raw:
        parts = raw.split("FOLLOW_UPS:", 1)
        reply = parts[0].rstrip()
        try:
            parsed = json.loads(parts[1].strip())
            if isinstance(parsed, list):
                follow_ups = [str(x) for x in parsed[:3]]
        except (json.JSONDecodeError, ValueError):
            follow_ups = []

    return ChatResponse(reply=reply, follow_ups=follow_ups)


# ─────────────────────────────────────────────────────────────────────────────
# Message CRUD (authenticated — routes through service-role for RLS bypass)
# ─────────────────────────────────────────────────────────────────────────────


class AddMessageRequest(BaseModel):
    role: Literal["user", "bot"]
    message: str = Field(..., min_length=1, max_length=8000)


class MessageRow(BaseModel):
    id: str
    user_id: str
    role: str
    message: str
    created_at: str


class MessagesResponse(BaseModel):
    messages: list[MessageRow]


class DeleteResponse(BaseModel):
    success: bool


@router.post(
    "/messages",
    response_model=MessageRow,
    status_code=status.HTTP_201_CREATED,
    summary="Store a chatbot message",
)
async def add_message(
    req: AddMessageRequest,
    current_user: dict = Depends(get_current_user),
) -> MessageRow:
    uid = current_user["sub"]
    data, code = await db_insert(
        "chatbot_messages",
        {"user_id": uid, "role": req.role, "message": req.message},
    )
    if code not in (200, 201):
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to store message")
    row = data[0] if isinstance(data, list) else data
    return MessageRow(**row)


@router.get(
    "/messages",
    response_model=MessagesResponse,
    summary="Get chatbot history for the current user",
)
async def get_messages(
    current_user: dict = Depends(get_current_user),
    limit: int = Query(default=200, ge=1, le=1000, description="Max messages to return"),
    offset: int = Query(default=0, ge=0, description="Number of messages to skip"),
) -> MessagesResponse:
    uid = current_user["sub"]
    data, code = await db_select(
        "chatbot_messages",
        {"user_id": uid},
        columns="id,user_id,role,message,created_at",
    )
    if code not in (200,):
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to load messages")
    # Sort by created_at ascending, then paginate
    data.sort(key=lambda r: r.get("created_at", ""))
    page = data[offset : offset + limit]
    return MessagesResponse(messages=[MessageRow(**r) for r in page])


@router.delete(
    "/messages",
    response_model=DeleteResponse,
    summary="Delete all chatbot messages for the current user",
)
async def delete_messages(current_user: dict = Depends(get_current_user)) -> DeleteResponse:
    uid = current_user["sub"]
    await db_delete("chatbot_messages", {"user_id": uid})
    return DeleteResponse(success=True)
