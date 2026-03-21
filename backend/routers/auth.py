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
from math import asin, cos, radians, sin, sqrt
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from config import settings
from deps import get_current_user
from services.supabase import (
    auth_create_user,
    auth_refresh,
    auth_sign_in,
    auth_update_user,
    db_insert,
    db_delete,
    db_select,
    db_upsert,
)

router = APIRouter(prefix="/auth", tags=["Auth"])

# ─────────────────────────────────────────────────────────────────────────────
# Request / Response models
# ─────────────────────────────────────────────────────────────────────────────

_PHONE_RE = re.compile(r"^\+?[0-9]{9,15}$")


def _normalise_ethiopian_mobile(v: str) -> str:
    digits = re.sub(r"[^0-9]", "", v)
    if digits.startswith("0") and len(digits) == 10:
        digits = "251" + digits[1:]
    elif len(digits) == 9 and digits.startswith("9"):
        digits = "251" + digits

    if len(digits) != 12 or not digits.startswith("2519"):
        raise ValueError("Phone must be Ethiopian mobile format: +2519XXXXXXXX")
    return "+" + digits


class RegisterRequest(BaseModel):
    email: str = Field(..., description="Phone-based pseudo-email or real email")
    password: str = Field(..., min_length=6, max_length=72, description="Min 6 characters")
    full_name: str = Field(..., min_length=1, max_length=100)
    phone: str = Field(..., min_length=9, max_length=16)
    role: Literal["patient", "ambulance", "driver"] = "patient"
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)

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
    hospital_id: str | None = None
    message: str



class RegisterStaffRequest(BaseModel):
    phone: str = Field(..., min_length=9, max_length=16, description="Unique phone number for admin/hospital account")
    password: str = Field(..., min_length=6, max_length=72)
    full_name: str = Field(..., min_length=1, max_length=100)
    role: Literal["admin", "hospital"]
    hospital_id: str | None = Field(default=None, description="Optional hospital link")

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
        return _normalise_ethiopian_mobile(v)

class LoginRequest(BaseModel):
    email: str
    password: str = Field(..., min_length=1)


class PhoneLoginRequest(BaseModel):
    phone: str = Field(..., min_length=9, max_length=16)
    password: str = Field(..., min_length=1)

    @field_validator("phone")
    @classmethod
    def normalise_phone(cls, v: str) -> str:
        return _normalise_ethiopian_mobile(v)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    token_type: str = "bearer"


class PhoneTokenResponse(TokenResponse):
    user_id: str
    role: Literal["patient", "ambulance", "driver", "admin", "hospital"] | None = None
    full_name: str | None = None
    phone: str | None = None
    hospital_id: str | None = None


class RefreshRequest(BaseModel):
    refresh_token: str


class ProvisionHospitalRequest(BaseModel):
    phone: str = Field(..., min_length=9, max_length=16)
    password: str = Field(..., min_length=6, max_length=72)
    hospital_name: str = Field(..., min_length=1, max_length=120)
    address: str = Field(default="Not set", min_length=1, max_length=200)

    @field_validator("hospital_name")
    @classmethod
    def strip_hospital_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("hospital_name cannot be blank")
        return v

    @field_validator("address")
    @classmethod
    def strip_address(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("address cannot be blank")
        return v

    @field_validator("phone")
    @classmethod
    def normalise_phone(cls, v: str) -> str:
        return _normalise_ethiopian_mobile(v)


async def _create_user_with_profile(
    *,
    email: str,
    password: str,
    full_name: str,
    phone: str,
    role: Literal["patient", "ambulance", "driver", "admin", "hospital"],
    hospital_id: str | None = None,
    persist_profile: bool = True,
) -> RegisterResponse:
    canonical_role = "ambulance" if role == "driver" else role

    user_metadata = {
        "full_name": full_name,
        "phone": phone,
        "role": canonical_role,
    }
    if hospital_id:
        user_metadata["hospital_id"] = hospital_id

    user_data, code = await auth_create_user(
        email=email,
        password=password,
        user_metadata=user_metadata,
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

    if persist_profile:
        profile_payload = {
            "id": user_id,
            "role": canonical_role,
            "full_name": full_name,
            "phone": phone,
            "updated_at": now,
        }
        if hospital_id:
            profile_payload["hospital_id"] = hospital_id

        await db_upsert("profiles", profile_payload, on_conflict="id")
    else:
        # Some deployments auto-create `profiles` rows from auth hooks.
        # Remove hospital profile rows to keep hospital identity in `hospitals` only.
        await db_delete("profiles", {"id": user_id})

    return RegisterResponse(
        user_id=user_id,
        hospital_id=hospital_id,
        message="Account created successfully. Please sign in.",
    )


def _parse_point_wkt(value: str | None) -> tuple[float, float] | None:
    if not value:
        return None
    try:
        point_part = value.split(";")[-1]
        inside = point_part[point_part.find("(") + 1 : point_part.rfind(")")]
        lon_str, lat_str = inside.strip().split()
        return float(lat_str), float(lon_str)
    except Exception:
        return None


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    d_lat = radians(lat2 - lat1)
    d_lon = radians(lon2 - lon1)
    a = (
        sin(d_lat / 2) ** 2
        + cos(radians(lat1)) * cos(radians(lat2)) * sin(d_lon / 2) ** 2
    )
    c = 2 * asin(sqrt(a))
    return r * c


async def _find_nearest_hospital_id(latitude: float, longitude: float) -> str | None:
    rows, code = await db_select(
        "hospitals",
        {},
        columns="id,location,is_accepting_emergencies",
    )
    if code not in (200, 206) or not rows:
        return None

    best_id: str | None = None
    best_dist = float("inf")
    for row in rows:
        if row.get("is_accepting_emergencies") is False:
            continue
        parsed = _parse_point_wkt(row.get("location"))
        if not parsed:
            continue
        h_lat, h_lon = parsed
        dist = _distance_km(latitude, longitude, h_lat, h_lon)
        if dist < best_dist:
            best_dist = dist
            best_id = str(row.get("id") or "") or None

    return best_id


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.post(
    "/register",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new patient or ambulance account",
)
async def register(req: RegisterRequest) -> RegisterResponse:
    """
    Securely creates a new account via the Supabase Auth Admin API (server-side).
    - Email is auto-confirmed (no confirmation email needed for phone-based auth)
    - Profile row is created in the `profiles` table
    - Service-role key never leaves this server
    """
    resolved_hospital_id: str | None = None
    if (
        req.role in ("patient", "ambulance", "driver")
        and req.latitude is not None
        and req.longitude is not None
    ):
        resolved_hospital_id = await _find_nearest_hospital_id(req.latitude, req.longitude)

    return await _create_user_with_profile(
        email=req.email,
        password=req.password,
        full_name=req.full_name,
        phone=req.phone,
        role=req.role,
        hospital_id=resolved_hospital_id,
    )


@router.post(
    "/register-staff",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create admin or hospital account (secured provisioning endpoint)",
)
async def register_staff(
    req: RegisterStaffRequest,
    x_setup_key: str | None = Header(default=None, alias="X-Setup-Key"),
) -> RegisterResponse:
    expected_key = settings.staff_provisioning_key or settings.supabase_service_role_key

    if not x_setup_key or x_setup_key != expected_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid setup key.",
        )

    # Generate pseudo-email using the same domain pattern as mobile sign-in
    # (`toAuthEmail` in utils/auth.ts), so staff can log in with phone.
    digits = re.sub(r"[^0-9]", "", req.phone)
    pseudo_email = f"{digits}@phone.erdataya.app"

    hospital_id = req.hospital_id
    persist_profile = req.role != "hospital"

    if req.role == "hospital":
        # Hospital staff is represented in `hospitals` + auth metadata, not `profiles`.
        if hospital_id:
            rows, code = await db_select("hospitals", {"id": hospital_id}, columns="id")
            if code not in (200, 206) or not rows:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Provided hospital_id does not exist.",
                )
        else:
            existing_rows, existing_code = await db_select(
                "hospitals",
                {"phone": req.phone},
                columns="id,name,phone",
            )
            if existing_code in (200, 206) and existing_rows:
                hospital_id = str(existing_rows[0].get("id"))
            else:
                inserted, insert_code = await db_insert(
                    "hospitals",
                    {
                        "name": req.full_name,
                        "address": "Not set",
                        "phone": req.phone,
                    },
                )
                if insert_code not in (200, 201) or not inserted:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Failed to create hospital record for hospital staff.",
                    )
                created_row = inserted[0] if isinstance(inserted, list) else inserted
                hospital_id = str(created_row.get("id") or "")

        if not hospital_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Hospital account requires a valid hospital record.",
            )

    return await _create_user_with_profile(
        email=pseudo_email,
        password=req.password,
        full_name=req.full_name,
        phone=req.phone,
        role=req.role,
        hospital_id=hospital_id,
        persist_profile=persist_profile,
    )


@router.post(
    "/provision-hospital",
    response_model=RegisterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a hospital dashboard account from admin workflow",
)
async def provision_hospital(
    req: ProvisionHospitalRequest,
    current_user: dict = Depends(get_current_user),
) -> RegisterResponse:
    requester_id = str(current_user.get("sub") or "")
    requester_rows, requester_code = await db_select(
        "profiles",
        {"id": requester_id},
        columns="id,role",
    )
    requester_role = ""
    if requester_code in (200, 206) and requester_rows:
        requester_role = str(requester_rows[0].get("role") or "").lower()
    else:
        requester_role = str((current_user.get("user_metadata") or {}).get("role") or "").lower()

    if requester_role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can create hospital accounts")

    existing_rows, existing_code = await db_select(
        "hospitals",
        {"phone": req.phone},
        columns="id,name,phone",
    )
    if existing_code in (200, 206) and existing_rows:
        hospital_id = str(existing_rows[0].get("id"))
    else:
        inserted, insert_code = await db_insert(
            "hospitals",
            {
                "name": req.hospital_name,
                "address": req.address,
                "phone": req.phone,
            },
        )
        if insert_code not in (200, 201) or not inserted:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create hospital record")
        created = inserted[0] if isinstance(inserted, list) else inserted
        hospital_id = str(created.get("id") or "")

    if not hospital_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to resolve hospital_id")

    digits = re.sub(r"[^0-9]", "", req.phone)
    pseudo_email = f"{digits}@phone.erdataya.app"

    return await _create_user_with_profile(
        email=pseudo_email,
        password=req.password,
        full_name=req.hospital_name,
        phone=req.phone,
        role="hospital",
        hospital_id=hospital_id,
        persist_profile=False,
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
    "/login-phone",
    response_model=PhoneTokenResponse,
    summary="Authenticate with phone/password and return role-aware session tokens",
)
async def login_phone(req: PhoneLoginRequest) -> PhoneTokenResponse:
    digits = re.sub(r"[^0-9]", "", req.phone)
    pseudo_email = f"{digits}@phone.erdataya.app"

    data, code = await auth_sign_in(pseudo_email, req.password)
    if not data.get("access_token"):
        detail: str = (
            data.get("error_description")
            or data.get("msg")
            or data.get("error")
            or "Invalid phone or password."
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)

    user_obj = data.get("user") or {}
    metadata = user_obj.get("user_metadata") or {}
    user_id = str(user_obj.get("id") or "")

    # Hard guarantee: hospital identities live in hospitals table, not profiles.
    hospital_id = metadata.get("hospital_id")
    role = str(metadata.get("role") or "").lower()
    if role == "hospital":
        phone = str(metadata.get("phone") or req.phone)
        full_name = str(metadata.get("full_name") or "Hospital")

        resolved_hospital_id: str | None = None
        if hospital_id:
            rows, code = await db_select("hospitals", {"id": str(hospital_id)}, columns="id")
            if code in (200, 206) and rows:
                resolved_hospital_id = str(rows[0].get("id") or "")

        if not resolved_hospital_id:
            by_phone, by_phone_code = await db_select(
                "hospitals",
                {"phone": phone},
                columns="id,name,phone",
            )
            if by_phone_code in (200, 206) and by_phone:
                resolved_hospital_id = str(by_phone[0].get("id") or "")

        if not resolved_hospital_id:
            inserted, insert_code = await db_insert(
                "hospitals",
                {"name": full_name, "address": "Not set", "phone": phone},
            )
            if insert_code in (200, 201) and inserted:
                row = inserted[0] if isinstance(inserted, list) else inserted
                resolved_hospital_id = str(row.get("id") or "")

        # Remove hospital row from profiles if it exists.
        if user_id:
            await db_delete("profiles", {"id": user_id})

        if resolved_hospital_id:
            metadata = {
                **metadata,
                "role": "hospital",
                "phone": phone,
                "full_name": full_name,
                "hospital_id": resolved_hospital_id,
            }
            hospital_id = resolved_hospital_id
            await auth_update_user(
                user_id,
                {
                    "user_metadata": metadata,
                    "email_confirm": True,
                },
            )

    return PhoneTokenResponse(
        access_token=data["access_token"],
        refresh_token=data["refresh_token"],
        expires_in=int(data.get("expires_in", 3600)),
        token_type=data.get("token_type", "bearer"),
        user_id=user_id,
        role=metadata.get("role"),
        full_name=metadata.get("full_name"),
        phone=metadata.get("phone"),
        hospital_id=hospital_id or metadata.get("hospital_id"),
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
