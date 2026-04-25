"""
Profiles router — read and update user and medical profiles.

All endpoints require a valid Supabase JWT (Authorization: Bearer <token>).
The user can only read/write their OWN profile (sub claim = user UUID).
"""

from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from deps import get_current_user
from services.supabase import db_select, db_update, db_upsert

router = APIRouter(prefix="/profiles", tags=["Profiles"])


# ─────────────────────────────────────────────────────────────────────────────
# Request / Response models
# ─────────────────────────────────────────────────────────────────────────────


class ProfileResponse(BaseModel):
    id: str
    full_name: Optional[str] = None
    phone: Optional[str] = None
    role: str
    hospital_id: Optional[str] = None
    national_id: Optional[str] = None
    vehicle_number: Optional[str] = None
    registration_number: Optional[str] = None
    ambulance_type: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ProfileUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=100)
    phone: Optional[str] = Field(None, min_length=9, max_length=15)


class MedicalProfileResponse(BaseModel):
    id: Optional[str] = None
    user_id: str
    blood_type: Optional[str] = None
    allergies: Optional[str] = None
    medical_conditions: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class MedicalProfileUpsert(BaseModel):
    blood_type: Optional[str] = Field(None, max_length=10)
    allergies: Optional[str] = Field(None, max_length=500)
    medical_conditions: Optional[str] = Field(None, max_length=500)
    emergency_contact_name: Optional[str] = Field(None, max_length=100)
    emergency_contact_phone: Optional[str] = Field(None, max_length=20)


# ─────────────────────────────────────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────────────────────────────────────


@router.get(
    "/me",
    response_model=ProfileResponse,
    summary="Get the authenticated user's profile",
)
async def get_my_profile(
    current_user: dict = Depends(get_current_user),
) -> ProfileResponse:
    user_id: str = current_user["sub"]
    rows: list = []
    code = 0
    for cols in (
        "id,full_name,phone,role,hospital_id,national_id,vehicle_number,"
        "registration_number,ambulance_type,created_at,updated_at",
        "id,full_name,phone,role,hospital_id,national_id,created_at,updated_at",
        "id,full_name,phone,role,hospital_id,created_at,updated_at",
    ):
        rows, code = await db_select("profiles", {"id": user_id}, columns=cols)
        if code in (200, 206) and rows:
            break
    if not rows:
        rows, code = await db_select("profiles", {"id": user_id})

    if code not in (200, 206) or not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Profile not found.",
        )
    return ProfileResponse(**rows[0])


@router.put(
    "/me",
    summary="Update the authenticated user's profile",
)
async def update_my_profile(
    body: ProfileUpdate,
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id: str = current_user["sub"]
    payload = {k: v for k, v in body.model_dump().items() if v is not None}

    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No fields provided for update.",
        )

    payload["updated_at"] = datetime.now(timezone.utc).isoformat()
    _, code = await db_update("profiles", {"id": user_id}, payload)

    if code not in (200, 204):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Profile update failed.",
        )
    return {"success": True}


@router.get(
    "/medical",
    response_model=Optional[MedicalProfileResponse],
    summary="Get the authenticated user's medical profile",
)
async def get_medical_profile(
    current_user: dict = Depends(get_current_user),
) -> Optional[MedicalProfileResponse]:
    user_id: str = current_user["sub"]
    rows, code = await db_select("medical_profiles", {"user_id": user_id})

    if code != 200:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Database error while fetching medical profile.",
        )
    if not rows:
        return None
    return MedicalProfileResponse(**rows[0])


@router.put(
    "/medical",
    summary="Create or update the authenticated user's medical profile",
)
async def upsert_medical_profile(
    body: MedicalProfileUpsert,
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id: str = current_user["sub"]
    now = datetime.now(timezone.utc).isoformat()

    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    payload["user_id"] = user_id
    payload["updated_at"] = now

    _, code = await db_upsert("medical_profiles", payload, on_conflict="user_id")

    if code not in (200, 201):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Medical profile update failed.",
        )
    return {"success": True}
