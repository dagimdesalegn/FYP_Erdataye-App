"""
First Aid Chatbot router — powered by DeepSeek AI.

The AI endpoint is intentionally public (no JWT required) because access to
emergency first aid guidance must not be gated behind authentication.
Message storage endpoints require authentication.
"""

import json
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from openai import OpenAI, OpenAIError
from pydantic import BaseModel, Field

from config import settings
from deps import get_current_user
from services.supabase import db_insert, db_select, db_delete

router = APIRouter(prefix="/chat", tags=["Chatbot"])

# ─────────────────────────────────────────────────────────────────────────────
# DeepSeek client (OpenAI-compatible SDK)
# The API key never reaches the mobile client.
# ─────────────────────────────────────────────────────────────────────────────

_deepseek = OpenAI(
    api_key=settings.deepseek_api_key,
    base_url="https://api.deepseek.com",
)

# ─────────────────────────────────────────────────────────────────────────────
# System prompt — WHO first aid domain + Ethiopian context
# ─────────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a First Aid Assistant in the Erdataye Ambulance App (Ethiopia).

RULES:
- Keep answers SHORT (3-5 sentences max). Be concise and direct.
- Do NOT use any markdown formatting. No asterisks, no bold, no headers.
- Use plain text only. Use numbered lists for steps.
- For emergencies, tell users to call 911 first.
- Never diagnose. Only give first aid guidance.
- Ethiopian context: Black Lion Hospital (+251 111 239 720), St. Paul's Hospital (+251 111 241 845).
- If asked about non-health topics, say: I can only help with first aid and emergency guidance.
- After your answer, on a new line write:
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
    messages: list[dict] = [{"role": "system", "content": SYSTEM_PROMPT}]

    # Keep last 20 history entries to bound token usage
    for entry in req.history[-20:]:
        messages.append({"role": entry.role, "content": entry.content})

    messages.append({"role": "user", "content": req.message.strip()})

    try:
        completion = _deepseek.chat.completions.create(
            model="deepseek-chat",
            messages=messages,
            temperature=0.35,  # lower = more factual / consistent for medical guidance
            max_tokens=1024,
        )
    except OpenAIError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"DeepSeek API error: {exc}",
        ) from exc

    raw: str = completion.choices[0].message.content or ""

    # Strip any markdown asterisks the model may produce
    raw = raw.replace("**", "").replace("*", "")

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
async def get_messages(current_user: dict = Depends(get_current_user)) -> MessagesResponse:
    uid = current_user["sub"]
    data, code = await db_select(
        "chatbot_messages",
        {"user_id": uid},
        columns="id,user_id,role,message,created_at",
    )
    if code not in (200,):
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to load messages")
    # Sort by created_at ascending
    data.sort(key=lambda r: r.get("created_at", ""))
    return MessagesResponse(messages=[MessageRow(**r) for r in data])


@router.delete(
    "/messages",
    response_model=DeleteResponse,
    summary="Delete all chatbot messages for the current user",
)
async def delete_messages(current_user: dict = Depends(get_current_user)) -> DeleteResponse:
    uid = current_user["sub"]
    await db_delete("chatbot_messages", {"user_id": uid})
    return DeleteResponse(success=True)
