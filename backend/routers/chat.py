"""
First Aid Chatbot router — powered by DeepSeek AI.

The AI endpoint is intentionally public (no JWT required) because access to
emergency first aid guidance must not be gated behind authentication.
Message storage endpoints require authentication.
"""

import json
import logging
import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from openai import AsyncOpenAI, OpenAIError
from pydantic import BaseModel, Field

from config import settings
from deps import get_current_user
from services.supabase import db_insert, db_select, db_delete

router = APIRouter(prefix="/chat", tags=["Chatbot"])
logger = logging.getLogger("chat_router")

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
You provide real, WHO-based first aid guidance grounded in current medical best practices.

RULES:
1) Give accurate, evidence-based first aid instructions. Be specific with steps.
2) Keep answers 3 to 6 sentences. Use numbered steps for procedures.
3) NEVER use markdown. No asterisks, no bold, no hashtags, no headers, no bullet symbols. Plain text only.
4) For life-threatening emergencies, always tell users to call Ethiopian emergency number 939 or 911 first.
5) Never diagnose conditions. Only provide first aid guidance until professional help arrives.
6) Know Ethiopian context: Black Lion Hospital (+251 111 239 720), St. Paul Hospital (+251 111 241 845), Ethiopian Red Cross (+251 111 515 375).
7) If the user asks about non-health topics, politely reply: I can only help with first aid and emergency guidance.
8) Be warm, calm, and reassuring. People asking may be in distress.
9) After your answer, on a new line write:
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
async def chat(req: ChatRequest) -> ChatResponse:
    """
    Send a user message and optional conversation history.
    Returns an AI-generated WHO-grounded first aid response plus follow-up suggestions.
    """
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
