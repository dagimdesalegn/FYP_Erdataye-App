"""
Auth router — user registration, login, and token refresh.

Security rationale:
  • The Supabase service-role key (SUPABASE_SERVICE_ROLE_KEY) is used here
    server-side ONLY — it never reaches the mobile client.
  • All passwords are handled by Supabase Auth (bcrypt hashing).
  • Phone numbers are validated with a regex before touching the DB.
  • Rate limiting / brute-force protection is handled by Supabase's built-in
    policies; the service-role key bypasses per-IP limits for the app server
    but credentials still need to be valid.
"""

import re
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from services.supabase import auth_create_user, auth_refresh, auth_sign_in, auth_update_user, db_upsert

router = APIRouter(prefix="/auth", tags=["Auth"])

# ─────────────────────────────────────────────────────────────────────────────
# Request / Response models
# ─────────────────────────────────────────────────────────────────────────────

_PHONE_RE = re.compile(r"^\+?[0-9]{9,15}$")


class RegisterRequest(BaseModel):
    email: str = Field(..., description="Phone-based pseudo-email or real email")
    password: str = Field(..., min_length=6, max_length=72, description="Min 6 characters")
    full_name: str = Field(..., min_length=1, max_length=100)
    phone: str = Field(..., min_length=9, max_length=16)
    role: Literal["patient", "driver"] = "patient"

    @field_validator("full_name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("full_name cannot be blank")
        return v

    @field_validator("phone")
    @classmethod
    def normalise_phone(cls, v: str) -> str:
        digits = re.sub(r"[^0-9]", "", v)
        if not (9 <= len(digits) <= 15):
            raise ValueError("Phone must be 9–15 digits")
        if digits.startswith("0") and len(digits) == 10:
            digits = "251" + digits[1:]
        if len(digits) == 9 and digits.startswith("9"):
            digits = "251" + digits
        return "+" + digits


class RegisterResponse(BaseModel):
    user_id: str
    message: str


class LoginRequest(BaseModel):
    email: str
    password: str = Field(..., min_length=1)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new patient or driver account",
)
async def register(req: RegisterRequest) -> RegisterResponse:
    """
    Securely creates a new account via the Supabase Auth Admin API (server-side).
    - Email is auto-confirmed (no confirmation email needed for phone-based auth)
    - Profile row is created in the `profiles` table
    - Service-role key never leaves this server
    """
    user_data, code = await auth_create_user(
        email=req.email,
        password=req.password,
        user_metadata={
            "full_name": req.full_name,
            "phone": req.phone,
            "role": req.role,
        },
    )

    if code not in (200, 201) or not user_data.get("id"):
        detail: str = (
            user_data.get("msg")
            or user_data.get("message")
            or user_data.get("error_description")
            or "Registration failed. Please try again."
        )
        if code == 422 or "already" in detail.lower() or "exists" in detail.lower():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this identifier already exists.",
            )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)

    user_id: str = user_data["id"]
    now = datetime.now(timezone.utc).isoformat()

    # Upsert profile row — non-fatal if it fails (auth user was created)
    await db_upsert(
        "profiles",
        {
            "id": user_id,
            "role": req.role,
            "full_name": req.full_name,
            "phone": req.phone,
            "updated_at": now,
        },
        on_conflict="id",
    )

    return RegisterResponse(
        user_id=user_id,
        message="Account created successfully. Please sign in.",
    )


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Authenticate with email/password and receive JWT tokens",
)
async def login(req: LoginRequest) -> TokenResponse:
    """
    Authenticates the user via Supabase GoTrue token endpoint.
    The service-role key is sent as the apikey header (server-side only) to
    bypass per-IP rate limiting, while actual credentials are still verified.
    Returns access + refresh tokens that the client sets on the Supabase JS client.
    """
    data, code = await auth_sign_in(req.email, req.password)

    if not data.get("access_token"):
        detail: str = (
            data.get("error_description")
            or data.get("msg")
            or data.get("error")
            or "Invalid email or password."
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=detail,
        )

    return TokenResponse(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        expires_in=int(data.get("expires_in", 3600)),
        token_type=data.get("token_type", "bearer"),
    )


@router.post(
    "/refresh",
    response_model=TokenResponse,
    summary="Exchange a refresh token for a new token pair",
)
async def refresh(req: RefreshRequest) -> TokenResponse:
    """Rotates the session — returns a fresh access token and rotated refresh token."""
    data, code = await auth_refresh(req.refresh_token)

    if not data.get("access_token"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Refresh token is invalid or has expired. Please sign in again.",
        )

    return TokenResponse(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        expires_in=int(data.get("expires_in", 3600)),
        token_type=data.get("token_type", "bearer"),
    )


# ─────────────────────────────────────────────────────────────────────────────
# Update auth login phone
# ─────────────────────────────────────────────────────────────────────────────


class UpdatePhoneRequest(BaseModel):
    user_id: str = Field(..., min_length=1)
    phone: str = Field(..., min_length=9, max_length=16)
    email: str = Field(..., description="New phone-based pseudo-email")

    @field_validator("phone")
    @classmethod
    def normalise_phone(cls, v: str) -> str:
        digits = re.sub(r"[^0-9]", "", v)
        if not (9 <= len(digits) <= 15):
            raise ValueError("Phone must be 9–15 digits")
        if digits.startswith("0") and len(digits) == 10:
            digits = "251" + digits[1:]
        if len(digits) == 9 and digits.startswith("9"):
            digits = "251" + digits
        return "+" + digits


class UpdatePhoneResponse(BaseModel):
    success: bool
    message: str


@router.post(
    "/update-phone",
    response_model=UpdatePhoneResponse,
    summary="Update a user's auth login phone (admin operation)",
)
async def update_phone(req: UpdatePhoneRequest) -> UpdatePhoneResponse:
    """
    Updates the auth email (phone-derived) and user_metadata.phone for a user
    via the Supabase Auth Admin API. Service-role key stays server-side.
    """
    data, code = await auth_update_user(
        req.user_id,
        {
            "email": req.email,
            "email_confirm": True,
            "user_metadata": {"phone": req.phone},
        },
    )

    if code not in (200, 201):
        detail = (
            data.get("msg")
            or data.get("message")
            or data.get("error_description")
            or "Failed to update auth phone"
        )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)

    return UpdatePhoneResponse(success=True, message="Auth phone updated")
