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

import base64
import hashlib
import json
import re
import secrets
import time
from datetime import datetime, timezone
from math import asin, cos, radians, sin, sqrt
from threading import Lock
from typing import Any, Literal
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
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
    national_id: str | None = Field(default=None, min_length=16, max_length=16, pattern=r"^\d{16}$", description="Fayda FAN number (16 digits, optional)")
    role: Literal["patient", "ambulance", "driver"] = "patient"
    hospital_id: str | None = Field(default=None, description="Optional selected hospital for ambulance/driver")
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


class PublicHospitalOption(BaseModel):
    id: str
    name: str
    address: str | None = None
    phone: str | None = None
    is_accepting_emergencies: bool = True


_FAYDA_STATE_TTL_SECONDS = 600
_fayda_state_store: dict[str, dict[str, Any]] = {}
_fayda_state_lock = Lock()
_fayda_discovery_cache: dict[str, Any] = {
    "expires_at": 0.0,
    "data": None,
}
_fayda_jwks_cache: dict[str, Any] = {
    "expires_at": 0.0,
    "uri": "",
    "keys": [],
}


class FaydaAuthorizeResponse(BaseModel):
    authorization_url: str
    state: str
    expires_in: int
    redirect_uri: str


class FaydaExchangeRequest(BaseModel):
    code: str = Field(..., min_length=8)
    state: str = Field(..., min_length=16)
    redirect_uri: str = Field(..., min_length=1, max_length=512)


class FaydaMatchedProfile(BaseModel):
    exists: bool = False
    user_id: str | None = None
    role: Literal["patient", "ambulance", "driver", "admin", "hospital"] | None = None
    full_name: str | None = None
    phone: str | None = None


class FaydaExchangeResponse(BaseModel):
    verified: bool
    purpose: Literal["login", "register"]
    individual_id: str | None = None
    full_name: str | None = None
    given_name: str | None = None
    family_name: str | None = None
    phone_number: str | None = None
    email: str | None = None
    birthdate: str | None = None
    gender: str | None = None
    matched_profile: FaydaMatchedProfile


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64decode_padded(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.b64decode(value + padding)


def _pkce_code_challenge(code_verifier: str) -> str:
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    return _b64url(digest)


def _cleanup_fayda_state_store(now_ts: float) -> None:
    expired = [
        state
        for state, payload in _fayda_state_store.items()
        if float(payload.get("expires_at", 0)) <= now_ts
    ]
    for state in expired:
        _fayda_state_store.pop(state, None)


def _store_fayda_state(
    state: str,
    *,
    code_verifier: str,
    nonce: str,
    redirect_uri: str,
    purpose: Literal["login", "register"],
) -> None:
    now_ts = time.time()
    with _fayda_state_lock:
        _cleanup_fayda_state_store(now_ts)
        _fayda_state_store[state] = {
            "code_verifier": code_verifier,
            "nonce": nonce,
            "redirect_uri": redirect_uri,
            "purpose": purpose,
            "expires_at": now_ts + _FAYDA_STATE_TTL_SECONDS,
        }


def _consume_fayda_state(state: str) -> dict[str, Any] | None:
    now_ts = time.time()
    with _fayda_state_lock:
        _cleanup_fayda_state_store(now_ts)
        payload = _fayda_state_store.pop(state, None)
    if not payload:
        return None
    if float(payload.get("expires_at", 0)) <= now_ts:
        return None
    return payload


def _ensure_fayda_enabled() -> None:
    if not settings.fayda_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Fayda OAuth is disabled on this deployment.",
        )
    if not (settings.fayda_client_id or "").strip():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Fayda OAuth is not configured (missing FAYDA_CLIENT_ID).",
        )
    if not (settings.fayda_private_jwk_b64 or "").strip():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Fayda OAuth is not configured (missing FAYDA_PRIVATE_JWK_B64).",
        )


async def _load_fayda_discovery() -> dict[str, Any]:
    override_auth = (settings.fayda_authorization_endpoint or "").strip()
    override_token = (settings.fayda_token_endpoint or "").strip()
    override_userinfo = (settings.fayda_userinfo_endpoint or "").strip()
    override_jwks = (settings.fayda_jwks_uri or "").strip()

    if override_auth and override_token and override_userinfo and override_jwks:
        return {
            "issuer": "https://esignet.ida.fayda.et",
            "authorization_endpoint": override_auth,
            "token_endpoint": override_token,
            "userinfo_endpoint": override_userinfo,
            "jwks_uri": override_jwks,
        }

    now_ts = time.time()
    cached = _fayda_discovery_cache.get("data")
    if cached and float(_fayda_discovery_cache.get("expires_at", 0)) > now_ts:
        return cached

    discovery_url = (settings.fayda_discovery_url or "").strip()
    if not discovery_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Fayda OAuth is not configured (missing discovery URL).",
        )

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=8.0)) as client:
            res = await client.get(discovery_url)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch Fayda discovery metadata: {exc}",
        ) from exc

    if not res.is_success:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch Fayda discovery metadata ({res.status_code}).",
        )

    parsed = res.json()
    data = parsed if isinstance(parsed, dict) else {}
    required = ["authorization_endpoint", "token_endpoint", "userinfo_endpoint", "jwks_uri"]
    missing = [k for k in required if not data.get(k)]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Invalid Fayda discovery metadata (missing: {', '.join(missing)}).",
        )

    _fayda_discovery_cache["data"] = data
    _fayda_discovery_cache["expires_at"] = now_ts + 3600
    return data


async def _load_fayda_jwks(jwks_uri: str) -> list[dict[str, Any]]:
    now_ts = time.time()
    if (
        _fayda_jwks_cache.get("uri") == jwks_uri
        and float(_fayda_jwks_cache.get("expires_at", 0)) > now_ts
    ):
        return list(_fayda_jwks_cache.get("keys") or [])

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=8.0)) as client:
            res = await client.get(jwks_uri)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch Fayda JWKS: {exc}",
        ) from exc

    if not res.is_success:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch Fayda JWKS ({res.status_code}).",
        )

    parsed = res.json()
    data = parsed if isinstance(parsed, dict) else {}
    keys = data.get("keys") if isinstance(data, dict) else None
    if not isinstance(keys, list):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Invalid Fayda JWKS payload.",
        )

    _fayda_jwks_cache["uri"] = jwks_uri
    _fayda_jwks_cache["keys"] = keys
    _fayda_jwks_cache["expires_at"] = now_ts + 3600
    return keys


def _load_private_jwk() -> dict[str, Any]:
    raw = (settings.fayda_private_jwk_b64 or "").strip()
    try:
        decoded = _b64decode_padded(raw).decode("utf-8")
        data = json.loads(decoded)
        if not isinstance(data, dict):
            raise ValueError("JWK must be an object")
        return data
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Invalid FAYDA_PRIVATE_JWK_B64 value: {exc}",
        ) from exc


def _build_private_key_jwt_assertion(token_endpoint: str) -> str:
    private_jwk = _load_private_jwk()
    key_obj = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(private_jwk))
    now_ts = int(time.time())
    headers = {"alg": "RS256", "typ": "JWT"}
    kid = private_jwk.get("kid")
    if isinstance(kid, str) and kid.strip():
        headers["kid"] = kid.strip()

    payload = {
        "iss": settings.fayda_client_id,
        "sub": settings.fayda_client_id,
        "aud": token_endpoint,
        "iat": now_ts,
        "exp": now_ts + 120,
        "jti": secrets.token_urlsafe(24),
    }
    return jwt.encode(payload, key_obj, algorithm="RS256", headers=headers)


async def _decode_signed_jwt(
    token: str,
    *,
    issuer: str,
    jwks_uri: str,
    verify_aud: bool,
) -> dict[str, Any]:
    try:
        unverified_header = jwt.get_unverified_header(token)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid Fayda JWT header: {exc}",
        ) from exc

    kid = str(unverified_header.get("kid") or "")
    keys = await _load_fayda_jwks(jwks_uri)
    candidate_keys = [k for k in keys if not kid or str(k.get("kid") or "") == kid]
    if not candidate_keys:
        candidate_keys = keys

    last_error: Exception | None = None
    for key_data in candidate_keys:
        try:
            key_obj = jwt.algorithms.RSAAlgorithm.from_jwk(json.dumps(key_data))
            decode_kwargs: dict[str, Any] = {
                "key": key_obj,
                "algorithms": ["RS256"],
                "issuer": issuer,
                "options": {"verify_aud": verify_aud},
            }
            if verify_aud:
                decode_kwargs["audience"] = settings.fayda_client_id
            payload = jwt.decode(token, **decode_kwargs)
            if isinstance(payload, dict):
                return payload
        except Exception as exc:
            last_error = exc

    if last_error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to verify Fayda token: {last_error}",
        )
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to verify Fayda token.")


def _fallback_decode_without_verification(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, options={"verify_signature": False})
        return payload if isinstance(payload, dict) else {}
    except Exception:
        return {}


def _pick_claim(claims: dict[str, Any], key: str) -> str | None:
    direct = claims.get(key)
    if isinstance(direct, str) and direct.strip():
        return direct.strip()

    prefix = f"{key}#"
    for claim_key, claim_value in claims.items():
        if isinstance(claim_key, str) and claim_key.startswith(prefix):
            if isinstance(claim_value, str) and claim_value.strip():
                return claim_value.strip()

    return None


def _first_claim(claims: dict[str, Any], keys: list[str]) -> str | None:
    for key in keys:
        value = _pick_claim(claims, key)
        if value:
            return value
    return None


def _normalize_phone_candidates(phone: str) -> list[str]:
    digits = re.sub(r"[^0-9]", "", phone or "")
    if not digits:
        return []
    if digits.startswith("0") and len(digits) == 10:
        digits = "251" + digits[1:]
    if len(digits) == 9 and digits.startswith("9"):
        digits = "251" + digits
    if not digits.startswith("251") and len(digits) >= 9:
        digits = digits[-12:]

    plus_phone = f"+{digits}" if digits else ""
    local = f"0{digits[3:]}" if digits.startswith("251") and len(digits) == 12 else ""
    compact = digits
    no_zero_local = local[1:] if local.startswith("0") else ""
    return [value for value in dict.fromkeys([plus_phone, compact, local, no_zero_local]) if value]


async def _match_profile(individual_id: str | None, phone_number: str | None) -> FaydaMatchedProfile:
    if individual_id:
        rows, code = await db_select(
            "profiles",
            {"national_id": individual_id},
            columns="id,full_name,phone,role",
        )
        if code in (200, 206) and rows:
            row = rows[0]
            return FaydaMatchedProfile(
                exists=True,
                user_id=str(row.get("id") or "") or None,
                role=(str(row.get("role") or "") or None),
                full_name=(str(row.get("full_name") or "") or None),
                phone=(str(row.get("phone") or "") or None),
            )

    for candidate in _normalize_phone_candidates(phone_number or ""):
        rows, code = await db_select(
            "profiles",
            {"phone": candidate},
            columns="id,full_name,phone,role",
        )
        if code in (200, 206) and rows:
            row = rows[0]
            return FaydaMatchedProfile(
                exists=True,
                user_id=str(row.get("id") or "") or None,
                role=(str(row.get("role") or "") or None),
                full_name=(str(row.get("full_name") or "") or None),
                phone=(str(row.get("phone") or "") or None),
            )

    return FaydaMatchedProfile(exists=False)


def _default_fayda_claims() -> dict[str, Any]:
    return {
        "userinfo": {
            "name": {"essential": True},
            "given_name": {"essential": False},
            "family_name": {"essential": False},
            "email": {"essential": False},
            "phone_number": {"essential": False},
            "birthdate": {"essential": False},
            "gender": {"essential": False},
            "individual_id": {"essential": True},
        },
        "id_token": {
            "nonce": {"essential": True},
            "individual_id": {"essential": False},
        },
    }



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
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    is_accepting_emergencies: bool = True
    max_concurrent_emergencies: int | None = Field(default=None, ge=1, le=500)
    trauma_capable: bool = False
    icu_beds_available: int | None = Field(default=None, ge=0, le=1000)
    average_handover_minutes: int | None = Field(default=None, ge=1, le=240)
    dispatch_weight: float | None = Field(default=None, ge=0.1, le=5.0)

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
    national_id: str | None = None,
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
        raw_detail: str = (
            user_data.get("msg")
            or user_data.get("message")
            or user_data.get("error_description")
            or ""
        ).lower()
        if code == 422 or "already" in raw_detail or "exists" in raw_detail:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="An account with this identifier already exists.",
            )
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Registration failed. Please try again.")

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
        if national_id:
            profile_payload["national_id"] = national_id

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


def _parse_point_wkt(value) -> tuple[float, float] | None:
    if not value:
        return None
    # Handle GeoJSON dict (PostgREST may return geometry as GeoJSON)
    if isinstance(value, dict):
        coords = value.get("coordinates")
        if isinstance(coords, (list, tuple)) and len(coords) >= 2:
            try:
                return float(coords[1]), float(coords[0])  # (lat, lon)
            except (ValueError, TypeError):
                return None
        return None
    if not isinstance(value, str):
        return None
    try:
        point_part = value.split(";")[-1]
        inside = point_part[point_part.find("(") + 1 : point_part.rfind(")")]
        lon_str, lat_str = inside.strip().split()
        return float(lat_str), float(lon_str)
    except Exception:
        return None


def _to_point_wkt(latitude: float, longitude: float) -> str:
    return f"SRID=4326;POINT({longitude} {latitude})"


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


@router.get(
    "/fayda/authorize-url",
    response_model=FaydaAuthorizeResponse,
    summary="Create Fayda OIDC authorization URL (PKCE)",
)
async def fayda_authorize_url(
    purpose: Literal["login", "register"] = Query(default="login"),
    redirect_uri: str = Query(..., min_length=1, max_length=512),
    scope: str | None = Query(default=None),
    acr_values: str | None = Query(default=None),
    claims_locales: str | None = Query(default=None),
) -> FaydaAuthorizeResponse:
    _ensure_fayda_enabled()
    discovery = await _load_fayda_discovery()

    code_verifier = _b64url(secrets.token_bytes(48))
    code_challenge = _pkce_code_challenge(code_verifier)
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(24)

    resolved_scope = (scope or settings.fayda_default_scope or "openid profile").strip()
    resolved_acr = (acr_values or settings.fayda_default_acr_values or "").strip()
    resolved_locales = (claims_locales or settings.fayda_claims_locales or "").strip()

    query_params: dict[str, str] = {
        "client_id": settings.fayda_client_id,
        "response_type": "code",
        "scope": resolved_scope,
        "redirect_uri": redirect_uri,
        "state": state,
        "nonce": nonce,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        "claims": json.dumps(_default_fayda_claims(), separators=(",", ":")),
    }
    if resolved_acr:
        query_params["acr_values"] = resolved_acr
    if resolved_locales:
        query_params["claims_locales"] = resolved_locales

    _store_fayda_state(
        state,
        code_verifier=code_verifier,
        nonce=nonce,
        redirect_uri=redirect_uri,
        purpose=purpose,
    )

    authorization_url = f"{discovery['authorization_endpoint']}?{urlencode(query_params)}"
    return FaydaAuthorizeResponse(
        authorization_url=authorization_url,
        state=state,
        expires_in=_FAYDA_STATE_TTL_SECONDS,
        redirect_uri=redirect_uri,
    )


@router.post(
    "/fayda/exchange",
    response_model=FaydaExchangeResponse,
    summary="Exchange Fayda authorization code and return verified profile claims",
)
async def fayda_exchange(req: FaydaExchangeRequest) -> FaydaExchangeResponse:
    _ensure_fayda_enabled()

    state_payload = _consume_fayda_state(req.state)
    if not state_payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired Fayda state. Start the flow again.",
        )

    expected_redirect = str(state_payload.get("redirect_uri") or "")
    if expected_redirect != req.redirect_uri:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="redirect_uri mismatch for Fayda exchange.",
        )

    discovery = await _load_fayda_discovery()
    issuer = str(discovery.get("issuer") or "https://esignet.ida.fayda.et")
    token_endpoint = str(discovery.get("token_endpoint") or "")
    userinfo_endpoint = str(discovery.get("userinfo_endpoint") or "")
    jwks_uri = str(discovery.get("jwks_uri") or "")

    if not token_endpoint or not userinfo_endpoint or not jwks_uri:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Incomplete Fayda discovery metadata.",
        )

    token_form = {
        "grant_type": "authorization_code",
        "code": req.code,
        "redirect_uri": req.redirect_uri,
        "client_id": settings.fayda_client_id,
        "code_verifier": str(state_payload.get("code_verifier") or ""),
        "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        "client_assertion": _build_private_key_jwt_assertion(token_endpoint),
    }

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=10.0)) as client:
            token_res = await client.post(
                token_endpoint,
                data=token_form,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to exchange Fayda authorization code: {exc}",
        ) from exc

    if not token_res.is_success:
        detail_text = token_res.text.strip()[:400]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Fayda token exchange failed ({token_res.status_code}): {detail_text}",
        )

    token_parsed = token_res.json()
    token_payload = token_parsed if isinstance(token_parsed, dict) else {}
    access_token = str(token_payload.get("access_token") or "")
    id_token = str(token_payload.get("id_token") or "")

    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Fayda token response did not include access_token.",
        )

    id_claims: dict[str, Any] = {}
    if id_token:
        try:
            id_claims = await _decode_signed_jwt(
                id_token,
                issuer=issuer,
                jwks_uri=jwks_uri,
                verify_aud=True,
            )
        except HTTPException:
            id_claims = _fallback_decode_without_verification(id_token)

    expected_nonce = str(state_payload.get("nonce") or "")
    token_nonce = str(id_claims.get("nonce") or "")
    if expected_nonce and token_nonce and expected_nonce != token_nonce:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Fayda nonce validation failed.",
        )

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=10.0)) as client:
            userinfo_res = await client.get(
                userinfo_endpoint,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/json, application/jwt, text/plain",
                },
            )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Failed to fetch Fayda userinfo: {exc}",
        ) from exc

    if not userinfo_res.is_success:
        detail_text = userinfo_res.text.strip()[:400]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Fayda userinfo request failed ({userinfo_res.status_code}): {detail_text}",
        )

    userinfo_claims: dict[str, Any] = {}
    content_type = str(userinfo_res.headers.get("content-type") or "").lower()
    if "application/json" in content_type:
        body = userinfo_res.json()
        if isinstance(body, dict):
            userinfo_claims = body
        elif isinstance(body, str):
            try:
                userinfo_claims = await _decode_signed_jwt(
                    body,
                    issuer=issuer,
                    jwks_uri=jwks_uri,
                    verify_aud=False,
                )
            except HTTPException:
                userinfo_claims = _fallback_decode_without_verification(body)
    else:
        raw_userinfo = userinfo_res.text.strip()
        if raw_userinfo.startswith("{"):
            try:
                parsed = json.loads(raw_userinfo)
                if isinstance(parsed, dict):
                    userinfo_claims = parsed
            except Exception:
                userinfo_claims = {}
        elif raw_userinfo:
            try:
                userinfo_claims = await _decode_signed_jwt(
                    raw_userinfo,
                    issuer=issuer,
                    jwks_uri=jwks_uri,
                    verify_aud=False,
                )
            except HTTPException:
                userinfo_claims = _fallback_decode_without_verification(raw_userinfo)

    claims: dict[str, Any] = {**id_claims, **userinfo_claims}
    if not claims:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Fayda response did not contain user claims.",
        )

    individual_id = _first_claim(claims, ["individual_id", "national_id", "uin", "sub"])
    full_name = _first_claim(claims, ["name", "full_name"])
    given_name = _first_claim(claims, ["given_name"])
    family_name = _first_claim(claims, ["family_name"])
    phone_number = _first_claim(claims, ["phone_number", "phone"])
    email = _first_claim(claims, ["email"])
    birthdate = _first_claim(claims, ["birthdate", "date_of_birth"])
    gender = _first_claim(claims, ["gender", "sex"])

    matched_profile = await _match_profile(individual_id, phone_number)

    purpose_value = state_payload.get("purpose")
    if purpose_value not in ("login", "register"):
        purpose_value = "login"

    return FaydaExchangeResponse(
        verified=True,
        purpose=purpose_value,
        individual_id=individual_id,
        full_name=full_name,
        given_name=given_name,
        family_name=family_name,
        phone_number=phone_number,
        email=email,
        birthdate=birthdate,
        gender=gender,
        matched_profile=matched_profile,
    )


@router.get(
    "/hospitals/available",
    response_model=list[PublicHospitalOption],
    summary="List hospitals available for ambulance registration",
)
async def list_available_hospitals() -> list[PublicHospitalOption]:
    rows, code = await db_select(
        "hospitals",
        {},
        columns="id,name,address,phone,is_accepting_emergencies",
    )
    if code not in (200, 206):
        raise HTTPException(status_code=502, detail="Failed to load hospitals")

    options: list[PublicHospitalOption] = []
    for row in rows or []:
        if row.get("is_accepting_emergencies") is False:
            continue
        hospital_id = str(row.get("id") or "").strip()
        name = str(row.get("name") or "").strip()
        if not hospital_id or not name:
            continue
        options.append(
            PublicHospitalOption(
                id=hospital_id,
                name=name,
                address=(str(row.get("address") or "").strip() or None),
                phone=(str(row.get("phone") or "").strip() or None),
                is_accepting_emergencies=bool(row.get("is_accepting_emergencies", True)),
            )
        )

    options.sort(key=lambda item: item.name.lower())
    return options


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
    if req.hospital_id:
        selected_rows, selected_code = await db_select("hospitals", {"id": req.hospital_id}, columns="id")
        if selected_code not in (200, 206) or not selected_rows:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected hospital was not found")
        resolved_hospital_id = req.hospital_id
    elif (
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
        national_id=req.national_id,
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
    expected_key = (settings.staff_provisioning_key or "").strip()

    if not expected_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Staff provisioning is disabled. Missing STAFF_PROVISIONING_KEY.",
        )

    service_role_key = (settings.supabase_service_role_key or "").strip()
    if service_role_key and secrets.compare_digest(expected_key, service_role_key):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Staff provisioning key must be dedicated and must not match service-role key.",
        )

    if not x_setup_key or not secrets.compare_digest(x_setup_key, expected_key):
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

    location_wkt = (
        _to_point_wkt(req.latitude, req.longitude)
        if req.latitude is not None and req.longitude is not None
        else None
    )

    hospital_payload: dict = {
        "name": req.hospital_name,
        "address": req.address,
        "phone": req.phone,
        "is_accepting_emergencies": req.is_accepting_emergencies,
        "trauma_capable": req.trauma_capable,
    }
    if req.max_concurrent_emergencies is not None:
        hospital_payload["max_concurrent_emergencies"] = req.max_concurrent_emergencies
    if req.icu_beds_available is not None:
        hospital_payload["icu_beds_available"] = req.icu_beds_available
    if req.average_handover_minutes is not None:
        hospital_payload["average_handover_minutes"] = req.average_handover_minutes
    if req.dispatch_weight is not None:
        hospital_payload["dispatch_weight"] = req.dispatch_weight
    if location_wkt:
        hospital_payload["location"] = location_wkt

    existing_rows, existing_code = await db_select(
        "hospitals",
        {"phone": req.phone},
        columns="id,name,phone",
    )
    if existing_code in (200, 206) and existing_rows:
        hospital_id = str(existing_rows[0].get("id"))
        _, update_code = await db_upsert(
            "hospitals",
            {"id": hospital_id, **hospital_payload},
            on_conflict="id",
        )
        if update_code not in (200, 201):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to update hospital details")
    else:
        inserted, insert_code = await db_insert(
            "hospitals",
            hospital_payload,
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
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password.",
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
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid phone or password.")

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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to update auth phone.")

    return UpdatePhoneResponse(success=True, message="Auth phone updated")
