"""
Operations router ΓÇö non-breaking backend enhancements.

Provides:
  ΓÇó Dashboard-friendly operational summary metrics.
  ΓÇó A deterministic triage scoring endpoint for decision support demos.

These endpoints do not modify existing tables or flows.
"""

import logging
import struct
from datetime import datetime, timedelta, timezone
from math import asin, cos, radians, sin, sqrt
from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field, field_validator

from deps import get_current_user
from services.supabase import db_insert, db_query, db_select, db_update, db_upsert
from services.ambulance_approval import (
    get_ambulance_registration_request,
    list_ambulance_registration_requests,
    set_ambulance_registration_status,
)

router = APIRouter(prefix="/ops", tags=["Operations"])
logger = logging.getLogger("ops_router")


def _log_event(event: str, **metadata: Any) -> None:
    """Lightweight structured logging helper for dispatch visibility."""
    if not logger.isEnabledFor(logging.INFO):
        return

    if metadata:
        serialized = " ".join(f"{key}={metadata[key]}" for key in sorted(metadata))
        logger.info("%s | %s", event, serialized)
    else:
        logger.info("%s", event)

# Fast MVP stores for timeline/share contracts before DB migration.
# Eviction: max 1000 emergency timelines, 100 events each; max 5000 share links.
# Persisted to _share_data.json so data survives server restarts.
import json as _json
import os as _os
import threading as _threading

_DATA_FILE = _os.path.join(_os.path.dirname(__file__), "..", "_share_data.json")
_data_lock = _threading.Lock()


def _load_persisted() -> tuple[dict, dict]:
    """Load timelines and share links from disk."""
    try:
        with open(_DATA_FILE, "r", encoding="utf-8") as f:
            data = _json.load(f)
        return data.get("timelines", {}), data.get("share_links", {})
    except (FileNotFoundError, _json.JSONDecodeError, OSError):
        return {}, {}


def _save_persisted() -> None:
    """Best-effort persist to disk (non-blocking)."""
    try:
        with _data_lock:
            with open(_DATA_FILE, "w", encoding="utf-8") as f:
                _json.dump({"timelines": _TIMELINES, "share_links": _SHARE_LINKS}, f, default=str)
    except OSError:
        pass  # non-fatal ΓÇö in-memory copy is authoritative


_persisted_tl, _persisted_sl = _load_persisted()
_TIMELINES: dict[str, list[dict[str, Any]]] = _persisted_tl
_SHARE_LINKS: dict[str, dict[str, Any]] = _persisted_sl
_MAX_TIMELINE_EMERGENCIES = 1000
_MAX_TIMELINE_EVENTS_PER = 100
_MAX_SHARE_LINKS = 5000


def _parse_iso(ts: str | None) -> datetime | None:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        return None


class OpsSummary(BaseModel):
    window_days: int
    total_users: int
    total_drivers: int
    total_hospitals: int
    total_ambulances: int
    available_ambulances: int
    total_emergencies: int
    active_emergencies: int
    completed_emergencies: int
    cancelled_emergencies: int
    recent_emergencies: int
    avg_completion_minutes: float | None
    completion_rate_pct: float


class PublicImpactStatsResponse(BaseModel):
    total_users: int
    total_ambulances: int
    resolved_emergencies: int
    active_emergencies: int
    total_emergencies: int
    updated_at: str


class TriageInput(BaseModel):
    age: int | None = Field(default=None, ge=0, le=120)
    severity: Literal["low", "medium", "high", "critical"]
    conscious: bool = True
    breathing_difficulty: bool = False
    severe_bleeding: bool = False
    chest_pain: bool = False
    stroke_symptoms: bool = False
    trauma: bool = False
    fever_c: float | None = Field(default=None, ge=30, le=45)


class TriageOutput(BaseModel):
    score: int
    priority: Literal["P1", "P2", "P3", "P4"]
    recommended_dispatch_minutes: int
    recommendations: list[str]


class HospitalFleetInsight(BaseModel):
    hospital_id: str
    hospital_name: str
    hospital_phone: str | None
    total_ambulances: int
    available_ambulances: int
    busy_ambulances: int
    active_emergencies: int
    readiness_score: float


class FleetIntelligenceResponse(BaseModel):
    generated_at: str
    hospitals: list[HospitalFleetInsight]


class DispatchRecommendationResponse(BaseModel):
    ambulance_id: str | None
    hospital_id: str | None
    score: float | None
    distance_km: float | None
    reason: str


class EmergencyDispatchCreateRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    emergency_type: str = Field(default="medical", min_length=1, max_length=40)
    description: str | None = Field(default=None, max_length=1500)
    max_radius_km: float = Field(default=50.0, ge=1.0, le=200.0)
    national_id: str | None = Field(
        default=None,
        min_length=16,
        max_length=16,
        pattern=r"^\d{16}$",
        description="Fayda FAN number (16 digits, optional)",
    )

    @field_validator("national_id", mode="before")
    @classmethod
    def normalize_national_id(cls, value: str | None):
        if value is None:
            return None
        text = str(value).strip()
        if not text:
            return None
        if len(text) != 16 or not text.isdigit():
            return None
        return text


class EmergencyDispatchCreateResponse(BaseModel):
    emergency_id: str
    status: str
    hospital_id: str | None
    assigned_ambulance_id: str | None
    distance_to_ambulance_km: float | None
    distance_to_hospital_km: float | None
    eta_minutes: int | None
    route_to_patient_url: str | None
    route_to_hospital_url: str | None
    reason: str


class EmergencyDispatchRetryRequest(BaseModel):
    max_radius_km: float = Field(default=100.0, ge=1.0, le=250.0)


class EmergencyHospitalStatusResponse(BaseModel):
    emergency_id: str
    hospital_id: str | None
    hospital_name: str | None
    is_accepting_emergencies: bool | None
    active_emergencies: int
    max_concurrent_emergencies: int | None
    utilization: float | None
    distance_to_hospital_km: float | None
    eta_to_hospital_minutes: int | None
    hospital_latitude: float | None
    hospital_longitude: float | None
    source: str


# ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
# Role helpers
# ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ


async def _get_profile(user_id: str, current_user: dict | None = None) -> dict | None:
    rows, code = await db_select("profiles", {"id": user_id}, columns="id,role,hospital_id")
    metadata = (current_user or {}).get("user_metadata") or {}
    if code not in (200, 206) or not rows:
        metadata_role = str(metadata.get("role") or "").lower()
        if metadata_role in ("admin", "hospital", "driver", "ambulance", "patient"):
            return {
                "id": user_id,
                "role": metadata_role,
                "hospital_id": metadata.get("hospital_id"),
            }
        return None
    row = dict(rows[0])
    # Trigger-created `profiles` rows often omit hospital_id while JWT (staff signup) has it.
    if not str(row.get("hospital_id") or "").strip() and metadata.get("hospital_id"):
        row["hospital_id"] = metadata.get("hospital_id")
    if not str(row.get("role") or "").strip() and metadata.get("role"):
        row["role"] = metadata.get("role")
    return row


async def _require_role(user_id: str, current_user: dict, allowed: tuple[str, ...]) -> dict:
    profile = await _get_profile(user_id, current_user)
    if not profile:
        raise HTTPException(status_code=403, detail="Profile not found for requester.")
    role = str(profile.get("role") or "").lower()
    if role not in allowed:
        raise HTTPException(status_code=403, detail="Insufficient role for this action.")
    return profile


class PatientMedicalProfile(BaseModel):
    blood_type: str | None = None
    allergies: str | None = None
    medical_conditions: str | None = None
    emergency_contact_name: str | None = None
    emergency_contact_phone: str | None = None
    updated_at: str | None = None


class EmergencyPatientMedicalUpdate(BaseModel):
    medical_conditions: str | None = Field(default=None, max_length=500)


class PatientContextResponse(BaseModel):
    id: str
    full_name: str | None = None
    phone: str | None = None
    medical_profiles: list[PatientMedicalProfile] = []


class AdminDashboardResponse(BaseModel):
    users: list[dict]
    emergencies: list[dict]
    ambulances: list[dict]
    hospitals: list[dict]


class AdminHospitalDetailsResponse(BaseModel):
    hospital: dict
    linked_ambulances: list[dict]
    linked_driver_profiles: list[dict]
    total_emergencies: int
    active_emergencies: int
    completed_emergencies: int
    cancelled_emergencies: int


class AdminHospitalUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    address: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = Field(default=None, min_length=9, max_length=16)
    is_accepting_emergencies: bool | None = None
    max_concurrent_emergencies: int | None = Field(default=None, ge=1, le=500)
    dispatch_weight: float | None = Field(default=None, ge=0.1, le=5.0)
    trauma_capable: bool | None = None
    icu_beds_available: int | None = Field(default=None, ge=0, le=1000)
    average_handover_minutes: int | None = Field(default=None, ge=1, le=240)


class HospitalEmergency(BaseModel):
    id: str
    patient_id: str
    hospital_id: str | None = None
    status: str
    emergency_type: str
    description: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    created_at: str | None = None
    updated_at: str | None = None
    patient_profile: dict | None = None
    patient_medical: dict | None = None
    national_id: str | None = None
    ambulance_vehicle: str | None = None
    ambulance_latitude: float | None = None
    ambulance_longitude: float | None = None


# ΓöÇΓöÇΓöÇ Medical Notes models ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

class MedicalNoteInput(BaseModel):
    note_type: Literal[
        "initial_assessment", "transport_observation", "treatment", "discharge", "general"
    ]
    content: str = Field(min_length=1, max_length=2000)
    vitals: dict[str, Any] | None = Field(
        default=None,
        description="Optional vitals snapshot: blood_pressure, heart_rate, spo2, temperature, respiratory_rate",
    )

    @field_validator("vitals")
    @classmethod
    def validate_vitals(cls, v: dict | None) -> dict | None:
        if v is None:
            return v
        allowed = {"blood_pressure", "heart_rate", "spo2", "temperature", "respiratory_rate", "consciousness_level"}
        return {k: v[k] for k in v if k in allowed}


class MedicalNoteResponse(BaseModel):
    id: str
    emergency_id: str
    author_id: str
    author_role: str
    author_name: str | None = None
    note_type: str
    content: str
    vitals: dict[str, Any] | None = None
    created_at: str


class HospitalFleetResponse(BaseModel):
    hospital_id: str
    total_ambulances: int
    available_ambulances: int
    busy_ambulances: int
    ambulances: list[dict]

class HospitalFleetRepairResponse(BaseModel):
    hospital_id: str
    scanned_unlinked_ambulances: int
    repaired_ambulances: int
    repaired_driver_profiles: int
    repaired_ambulance_ids: list[str]


class HospitalProfileResponse(BaseModel):
    hospital_id: str
    name: str | None = None
    address: str | None = None
    phone: str | None = None
    is_accepting_emergencies: bool | None = None
    max_concurrent_emergencies: int | None = None
    dispatch_weight: float | None = None
    trauma_capable: bool | None = None
    icu_beds_available: int | None = None
    average_handover_minutes: int | None = None
    updated_at: str | None = None


class HospitalProfileUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    address: str | None = Field(default=None, min_length=1, max_length=200)
    phone: str | None = Field(default=None, min_length=9, max_length=16)
    is_accepting_emergencies: bool | None = None
    max_concurrent_emergencies: int | None = Field(default=None, ge=1, le=500)
    dispatch_weight: float | None = Field(default=None, ge=0.1, le=5.0)
    trauma_capable: bool | None = None
    icu_beds_available: int | None = Field(default=None, ge=0, le=1000)
    average_handover_minutes: int | None = Field(default=None, ge=1, le=240)


class HospitalBasicResponse(BaseModel):
    id: str
    name: str | None = None
    address: str | None = None
    phone: str | None = None
    is_accepting_emergencies: bool | None = None


class AmbulanceApprovalRequest(BaseModel):
    user_id: str
    hospital_id: str
    full_name: str | None = None
    phone: str | None = None
    vehicle_number: str | None = None
    registration_number: str | None = None
    ambulance_type: str | None = None
    status: Literal["pending", "approved", "rejected"]
    requested_at: str | None = None
    updated_at: str | None = None
    reviewed_at: str | None = None
    reviewed_by: str | None = None
    review_note: str | None = None


class AmbulanceApprovalDecision(BaseModel):
    decision: Literal["approved", "rejected"]
    note: str | None = Field(default=None, max_length=240)


def _parse_point_wkt(value: Any) -> tuple[float, float] | None:
    """Parse a PostGIS point from WKT, EWKB hex, or GeoJSON dict ΓåÆ (lat, lon)."""
    if value is None:
        return None

    # ΓöÇΓöÇ GeoJSON dict (Supabase REST returns this for geometry columns) ΓöÇΓöÇΓöÇ
    if isinstance(value, dict):
        if value.get("type") == "Point":
            coords = value.get("coordinates")
            if isinstance(coords, (list, tuple)) and len(coords) >= 2:
                try:
                    lon, lat = float(coords[0]), float(coords[1])
                    return (lat, lon)
                except (ValueError, TypeError):
                    pass
        return None

    text = str(value).strip()
    if not text:
        return None

    try:
        upper = text.upper()
        if "POINT" in upper:
            # Supports: SRID=4326;POINT(lon lat) and POINT(lon lat)
            point_part = text.split(";")[-1]
            inside = point_part[point_part.find("(") + 1 : point_part.rfind(")")]
            lon_str, lat_str = inside.strip().split()
            return float(lat_str), float(lon_str)
    except Exception:
        pass

    cleaned = text.lstrip("\\x").strip()
    if len(cleaned) < 32 or any(ch not in "0123456789abcdefABCDEF" for ch in cleaned):
        return None

    try:
        data = bytes.fromhex(cleaned)
    except ValueError:
        return None

    if not data:
        return None

    endian_flag = data[0]
    fmt = "<" if endian_flag == 1 else ">"
    try:
        geom_type = struct.unpack(f"{fmt}I", data[1:5])[0]
    except struct.error:
        return None

    offset = 5
    has_srid = bool(geom_type & 0x20000000)
    if has_srid:
        if len(data) < offset + 4:
            return None
        offset += 4
        geom_type = geom_type & 0xFFFF

    if geom_type != 1 or len(data) < offset + 16:
        return None

    try:
        x = struct.unpack(f"{fmt}d", data[offset : offset + 8])[0]
        y = struct.unpack(f"{fmt}d", data[offset + 8 : offset + 16])[0]
        return (y, x)
    except struct.error:
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


def _to_point_wkt(latitude: float, longitude: float) -> str:
    return f"SRID=4326;POINT({longitude} {latitude})"


def _fallback_hospital_coords_from_address(address: str | None) -> tuple[float, float] | None:
    # Coarse geocode fallback for environments where hospitals.location is missing.
    # Addis Ababa city center approx.
    text = (address or "").strip().lower()
    if not text:
        return None
    if "addis" in text or "addis ababa" in text:
        return (9.03, 38.74)
    return None


def _resolve_hospital_location(hospital: dict) -> tuple[float, float] | None:
    parsed = _parse_point_wkt(hospital.get("location"))
    if parsed:
        return parsed
    return _fallback_hospital_coords_from_address(str(hospital.get("address") or ""))


def _gmaps_route_url(start_lat: float, start_lng: float, end_lat: float, end_lng: float) -> str:
    return (
        "https://maps.google.com/maps?"
        f"saddr={start_lat},{start_lng}&daddr={end_lat},{end_lng}&dirflg=d&output=embed"
    )


async def _find_nearest_hospital(latitude: float, longitude: float) -> dict | None:
    hospitals, hosp_code = await db_select(
        "hospitals",
        {},
        columns="id,location,address,is_accepting_emergencies",
    )
    if hosp_code not in (200, 206):
        return None

    nearest: dict | None = None
    for hospital in hospitals or []:
        if hospital.get("is_accepting_emergencies") is False:
            continue
        parsed = _resolve_hospital_location(hospital)
        if not parsed:
            continue
        hosp_lat, hosp_lon = parsed
        dist = _distance_km(latitude, longitude, hosp_lat, hosp_lon)
        if nearest is None or dist < nearest["distance_km"]:
            nearest = {
                "hospital_id": str(hospital.get("id") or ""),
                "latitude": hosp_lat,
                "longitude": hosp_lon,
                "distance_km": round(dist, 2),
            }
    return nearest


async def _resolve_effective_hospital_id(
    profile: dict,
    current_user: dict,
    requested_hospital_id: str | None = None,
) -> str | None:
    role = str(profile.get("role") or "").lower()
    metadata = current_user.get("user_metadata") or {}
    effective_hospital_id = (
        requested_hospital_id if role == "admin" and requested_hospital_id else profile.get("hospital_id")
    )
    effective_hospital_id = str(effective_hospital_id or "").strip() or None
    meta_hid = str(metadata.get("hospital_id") or "").strip()
    if not effective_hospital_id and meta_hid:
        effective_hospital_id = meta_hid

    if role == "hospital" and not effective_hospital_id:
        phone = str(metadata.get("phone") or "").strip()
        name = str(metadata.get("full_name") or "").strip()

        if phone:
            by_phone_rows, by_phone_code = await db_select(
                "hospitals",
                {"phone": phone},
                columns="id,name,phone",
            )
            if by_phone_code in (200, 206) and by_phone_rows:
                effective_hospital_id = str(by_phone_rows[0].get("id") or "")

        if not effective_hospital_id and name:
            by_name_rows, by_name_code = await db_select(
                "hospitals",
                {"name": name},
                columns="id,name,phone",
            )
            if by_name_code in (200, 206) and by_name_rows:
                effective_hospital_id = str(by_name_rows[0].get("id") or "")

        # Persist recovered linkage to reduce future fallback lookups.
        if effective_hospital_id and not str(profile.get("hospital_id") or "").strip() and profile.get("id"):
            await db_update(
                "profiles",
                {"id": str(profile.get("id"))},
                {"hospital_id": str(effective_hospital_id)},
            )

    return str(effective_hospital_id) if effective_hospital_id else None


async def _compute_dispatch_recommendation(
    latitude: float,
    longitude: float,
    max_radius_km: float,
    preferred_hospital_id: str | None = None,
    exclude_ambulance_ids: set[str] | None = None,
) -> tuple[dict | None, str]:
    hospitals, hosp_code = await db_select(
        "hospitals",
        {},
        columns=(
            "id,is_accepting_emergencies,dispatch_weight,"
            "max_concurrent_emergencies,trauma_capable,icu_beds_available,location,address"
        ),
    )
    if hosp_code not in (200, 206):
        hospitals, hosp_code = await db_select("hospitals", {}, columns="id,location,address")

    ambulances, amb_code = await db_select(
        "ambulances",
        {},
        columns="id,hospital_id,is_available,last_known_location",
    )
    emergencies, eme_code = await db_select(
        "emergency_requests",
        {},
        columns="hospital_id,status,assigned_ambulance_id",
    )

    codes = [hosp_code, amb_code, eme_code]
    if any(code not in (200, 206) for code in codes):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not compute dispatch recommendation from database.",
        )

    # Build set of ambulance IDs that are already assigned to active emergencies.
    # This is a secondary safety net on top of the is_available flag to guarantee
    # each ambulance handles only ONE active emergency at a time.
    busy_ambulance_ids: set[str] = set()
    for em in emergencies or []:
        if em.get("status") not in ("completed", "cancelled", "pending"):
            amb_id = str(em.get("assigned_ambulance_id") or "")
            if amb_id:
                busy_ambulance_ids.add(amb_id)

    all_ambulances = ambulances or []
    hospitals_by_id = {str(h.get("id")): h for h in (hospitals or [])}
    excluded_ids = exclude_ambulance_ids or set()
    available = [
        a
        for a in all_ambulances
        if bool(a.get("is_available"))
        and str(a.get("id") or "") not in excluded_ids
        and str(a.get("id") or "") not in busy_ambulance_ids
    ]
    if not available:
        return None, "All ambulances are currently on active emergencies. Your request has been saved and an ambulance will be dispatched as soon as one becomes available."

    fleet_by_hospital: dict[str, int] = {}
    for amb in all_ambulances:
        h = str(amb.get("hospital_id") or "unassigned")
        fleet_by_hospital[h] = fleet_by_hospital.get(h, 0) + 1

    active_by_hospital: dict[str, int] = {}
    for em in emergencies or []:
        if em.get("status") in ("completed", "cancelled"):
            continue
        h = str(em.get("hospital_id") or "unassigned")
        active_by_hospital[h] = active_by_hospital.get(h, 0) + 1

    preferred_candidates: list[dict] = []
    if preferred_hospital_id:
        preferred_candidates = [
            a for a in available if str(a.get("hospital_id") or "") == preferred_hospital_id
        ]

    candidates = preferred_candidates if preferred_candidates else available

    best: dict | None = None
    fallback_without_location: list[dict] = []
    for amb in candidates:
        parsed = _parse_point_wkt(amb.get("last_known_location"))
        if not parsed:
            fallback_without_location.append(amb)
            continue
        amb_lat, amb_lon = parsed
        dist = _distance_km(latitude, longitude, amb_lat, amb_lon)
        if dist > max_radius_km:
            continue

        h = str(amb.get("hospital_id") or "unassigned")
        fleet = max(fleet_by_hospital.get(h, 1), 1)
        active = active_by_hospital.get(h, 0)

        hospital = hospitals_by_id.get(h)
        is_accepting = (
            bool(hospital.get("is_accepting_emergencies", True)) if hospital else True
        )
        if not is_accepting:
            continue

        dispatch_weight = float(hospital.get("dispatch_weight") or 1.0) if hospital else 1.0
        max_concurrent = int(hospital.get("max_concurrent_emergencies") or fleet) if hospital else fleet
        trauma_capable = bool(hospital.get("trauma_capable", False)) if hospital else False
        icu_beds = int(hospital.get("icu_beds_available") or 0) if hospital else 0
        hospital_loc = _resolve_hospital_location(hospital) if hospital else None

        distance_score = max(0.0, 100.0 - dist * 2.0)
        load_ratio = min(active / max(max_concurrent, 1), 2.0)
        load_score = max(0.0, 100.0 - load_ratio * 50.0)
        capacity_score = min(100.0, fleet * 10.0)
        capability_bonus = (6.0 if trauma_capable else 0.0) + min(icu_beds, 5) * 1.2
        # Distance is the dominant factor (0.70) so that same-severity
        # requests always dispatch the nearest available ambulance first.
        score = (
            distance_score * 0.70
            + load_score * 0.16
            + capacity_score * 0.06
            + min(dispatch_weight, 2.0) * 4.0
            + capability_bonus
        )

        if best is None or score > best["score"]:
            best = {
                "ambulance_id": str(amb.get("id")),
                "hospital_id": (str(amb.get("hospital_id")) if amb.get("hospital_id") else None),
                "score": round(score, 2),
                "distance_km": round(dist, 2),
                "ambulance_latitude": amb_lat,
                "ambulance_longitude": amb_lon,
                "hospital_latitude": hospital_loc[0] if hospital_loc else None,
                "hospital_longitude": hospital_loc[1] if hospital_loc else None,
            }

    # Resilience fallback: if no candidate had usable location data,
    # dispatch the first available ambulance instead of leaving emergency unassigned.
    if best is None and fallback_without_location:
        for amb in fallback_without_location:
            h = str(amb.get("hospital_id") or "unassigned")
            hospital = hospitals_by_id.get(h)
            is_accepting = (
                bool(hospital.get("is_accepting_emergencies", True)) if hospital else True
            )
            if not is_accepting:
                continue
            hospital_loc = _resolve_hospital_location(hospital) if hospital else None
            best = {
                "ambulance_id": str(amb.get("id")),
                "hospital_id": (str(amb.get("hospital_id")) if amb.get("hospital_id") else None),
                "score": 1.0,
                "distance_km": None,
                "ambulance_latitude": None,
                "ambulance_longitude": None,
                "hospital_latitude": hospital_loc[0] if hospital_loc else None,
                "hospital_longitude": hospital_loc[1] if hospital_loc else None,
            }
            break

    if best is None:
        return None, f"No ambulances found within {max_radius_km:.0f} km of your location. Your request has been saved and will be dispatched when an ambulance becomes available nearby."

    if best.get("distance_km") is None:
        return best, "Assigned by availability (ambulance live location unavailable)"

    return best, "Recommended by distance, hospital load, and fleet capacity"


async def _find_and_reserve_best_ambulance(
    *,
    latitude: float,
    longitude: float,
    max_radius_km: float,
    preferred_hospital_id: str | None,
    emergency_id: str,
) -> tuple[dict | None, str]:
    excluded: set[str] = set()
    reason = "No available ambulances found."

    _log_event(
        "dispatch_search_start",
        emergency_id=emergency_id,
        radius_km=f"{max_radius_km:.1f}",
        preferred_hospital=preferred_hospital_id or "auto",
    )

    # Try several candidates in order of recommendation while handling races.
    for attempt in range(12):
        best, reason = await _compute_dispatch_recommendation(
            latitude,
            longitude,
            max_radius_km,
            preferred_hospital_id=preferred_hospital_id,
            exclude_ambulance_ids=excluded,
        )
        if best is None:
            _log_event(
                "dispatch_search_no_candidates",
                emergency_id=emergency_id,
                attempt=attempt + 1,
                reason=reason,
            )
            return None, reason

        ambulance_id = str(best.get("ambulance_id") or "")
        if not ambulance_id:
            _log_event(
                "dispatch_search_bad_candidate",
                emergency_id=emergency_id,
                attempt=attempt + 1,
            )
            return None, reason

        now = datetime.now(timezone.utc).isoformat()
        updated_rows, update_code = await db_update(
            "ambulances",
            {"id": ambulance_id, "is_available": "true"},
            {"is_available": False, "updated_at": now},
        )

        # With `Prefer: return=representation`, PostgREST returns 200 with
        # the updated rows if any matched, or 200 with an empty list if the
        # WHERE clause matched nothing (ambulance was already taken).
        # A 204 means `return=minimal` or zero matches ΓÇö never a success.
        reserved = False
        if update_code in (200, 201):
            if isinstance(updated_rows, list) and len(updated_rows) > 0:
                reserved = True
            elif isinstance(updated_rows, dict) and updated_rows.get("id"):
                reserved = True

        if reserved:
            _log_event(
                "dispatch_reserve_success",
                emergency_id=emergency_id,
                ambulance_id=ambulance_id,
                attempt=attempt + 1,
            )
            return best, reason

        _log_event(
            "dispatch_reserve_conflict",
            emergency_id=emergency_id,
            ambulance_id=ambulance_id,
            attempt=attempt + 1,
        )
        excluded.add(ambulance_id)

    _log_event(
        "dispatch_search_exhausted",
        emergency_id=emergency_id,
        attempt=12,
        reason=reason,
    )
    return None, reason


async def _ensure_pending_assignment(
    *,
    emergency_id: str,
    ambulance_id: str,
    notes: str,
) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    _log_event(
        "assignment_record_attempt",
        emergency_id=emergency_id,
        ambulance_id=ambulance_id,
    )
    inserted, insert_code = await db_insert(
        "emergency_assignments",
        {
            "emergency_id": emergency_id,
            "ambulance_id": ambulance_id,
            "status": "pending",
            "assigned_at": now,
            "notes": notes,
        },
    )
    if insert_code in (200, 201):
        _log_event(
            "assignment_record_ready",
            emergency_id=emergency_id,
            ambulance_id=ambulance_id,
            mode="insert",
        )
        return True

    # Handle duplicate/conflict cases by reusing latest assignment row.
    existing_rows, existing_code = await db_query(
        "emergency_assignments",
        params={
            "emergency_id": f"eq.{emergency_id}",
            "order": "assigned_at.desc",
            "limit": "1",
        },
    )
    if existing_code not in (200, 206) or not existing_rows:
        _log_event(
            "assignment_record_conflict",
            emergency_id=emergency_id,
            ambulance_id=ambulance_id,
            detail="no_existing_row",
            code=str(existing_code),
        )
        return False

    assignment_id = str(existing_rows[0].get("id") or "")
    if not assignment_id:
        _log_event(
            "assignment_record_conflict",
            emergency_id=emergency_id,
            ambulance_id=ambulance_id,
            detail="missing_assignment_id",
        )
        return False

    _, update_code = await db_update(
        "emergency_assignments",
        {"id": assignment_id},
        {
            "ambulance_id": ambulance_id,
            "status": "pending",
            "assigned_at": now,
            "completed_at": None,
            "notes": notes,
        },
    )
    if update_code in (200, 204):
        _log_event(
            "assignment_record_ready",
            emergency_id=emergency_id,
            ambulance_id=ambulance_id,
            mode="reuse",
            assignment_id=assignment_id,
        )
        return True

    _log_event(
        "assignment_record_conflict",
        emergency_id=emergency_id,
        ambulance_id=ambulance_id,
        detail="update_failed",
        assignment_id=assignment_id,
        code=str(update_code),
    )
    return False


def _phone_candidates(phone: str | None) -> list[str]:
    raw = (phone or "").strip().replace(" ", "").replace("-", "")
    if not raw:
        return []

    digits = "".join(ch for ch in raw if ch.isdigit() or ch == "+")
    if digits.startswith("+251"):
        local = f"0{digits[4:]}"
    elif digits.startswith("251"):
        local = f"0{digits[3:]}"
    elif digits.startswith("0"):
        local = digits
    elif len(digits) == 9:
        local = f"0{digits}"
    else:
        local = digits
    intl = f"+251{local[1:]}" if local.startswith("0") else f"+{digits}"
    values = [raw, digits, local, local.lstrip("0"), intl]
    return [v for i, v in enumerate(values) if v and v not in values[:i]]


def _profile_fill_score(row: dict) -> int:
    def _filled(value: str | None) -> bool:
        text = (value or "").strip().lower()
        if not text:
            return False
        return text not in ("unknown", "not set", "none", "none reported", "not provided", "n/a")

    fields = (
        row.get("blood_type"),
        row.get("allergies"),
        row.get("medical_conditions"),
        row.get("emergency_contact_name"),
        row.get("emergency_contact_phone"),
    )
    return sum(1 for value in fields if _filled(str(value) if value is not None else None))


def _select_best_medical_profile(rows: list[dict]) -> list[dict]:
    if not rows:
        return []
    ranked = sorted(
        rows,
        key=lambda r: (
            _profile_fill_score(r),
            _parse_iso(r.get("updated_at")) or datetime.min.replace(tzinfo=timezone.utc),
        ),
        reverse=True,
    )
    return [ranked[0]]


@router.get(
    "/patient-context",
    response_model=PatientContextResponse,
    summary="Get patient profile + medical info for authorized emergency responders",
)
async def patient_context(
    patient_id: str = Query(..., description="Patient user UUID"),
    emergency_id: str | None = Query(
        default=None,
        description="Emergency UUID (required for ambulance/driver role)",
    ),
    current_user: dict = Depends(get_current_user),
) -> PatientContextResponse:
    user_id = str(current_user.get("sub") or "")
    me = await _require_role(user_id, current_user, ("admin", "hospital", "driver", "ambulance"))
    role = str(me.get("role") or "").lower()
    is_privileged = role in ("admin", "hospital")

    if not is_privileged:
        if role not in ("driver", "ambulance"):
            raise HTTPException(status_code=403, detail="Role not allowed for patient context.")
        if not emergency_id:
            raise HTTPException(
                status_code=400,
                detail="emergency_id is required for ambulance/driver access.",
            )

        emergency_rows, emergency_code = await db_select(
            "emergency_requests",
            {"id": emergency_id},
            columns="id,patient_id,assigned_ambulance_id",
        )
        if emergency_code not in (200, 206) or not emergency_rows:
            raise HTTPException(status_code=404, detail="Emergency not found.")

        emergency = emergency_rows[0]
        if str(emergency.get("patient_id") or "") != patient_id:
            raise HTTPException(status_code=403, detail="Patient not linked to this emergency.")

        my_ambulance_rows, my_amb_code = await db_select(
            "ambulances",
            {"current_driver_id": user_id},
            columns="id",
        )
        if my_amb_code not in (200, 206) or not my_ambulance_rows:
            raise HTTPException(status_code=403, detail="No ambulance linked to current user.")

        my_ambulance_id = str(my_ambulance_rows[0].get("id") or "")
        assigned_ambulance_id = str(emergency.get("assigned_ambulance_id") or "")

        if assigned_ambulance_id and assigned_ambulance_id == my_ambulance_id:
            pass
        else:
            # Fallback authorization path for legacy flows where emergency_requests
            # may not have assigned_ambulance_id populated but assignment row exists.
            assign_rows, assign_code = await db_select(
                "emergency_assignments",
                {"emergency_id": emergency_id},
                columns="ambulance_id,status",
            )
            if assign_code not in (200, 206) or not assign_rows:
                raise HTTPException(status_code=403, detail="Emergency is assigned to a different ambulance.")

            my_match = any(
                str(r.get("ambulance_id") or "") == my_ambulance_id
                and str(r.get("status") or "") in ("pending", "accepted")
                for r in assign_rows
            )
            if not my_match:
                raise HTTPException(status_code=403, detail="Emergency is assigned to a different ambulance.")

    patient_rows, patient_code = await db_select(
        "profiles",
        {"id": patient_id},
        columns="id,full_name,phone",
    )
    if patient_code not in (200, 206) or not patient_rows:
        raise HTTPException(status_code=404, detail="Patient profile not found.")
    patient = patient_rows[0]

    med_columns = (
        "blood_type,allergies,medical_conditions,"
        "emergency_contact_name,emergency_contact_phone,updated_at"
    )
    medical_profiles: list[dict] = []

    med_rows, med_code = await db_select(
        "medical_profiles",
        {"user_id": patient_id},
        columns=med_columns,
    )
    if med_code in (200, 206) and med_rows:
        medical_profiles = _select_best_medical_profile(med_rows)

    if not medical_profiles:
        med_by_id, med_by_id_code = await db_select(
            "medical_profiles",
            {"id": patient_id},
            columns=med_columns,
        )
        if med_by_id_code in (200, 206) and med_by_id:
            medical_profiles = _select_best_medical_profile(med_by_id)

    if not medical_profiles:
        phone_candidates = _phone_candidates(patient.get("phone"))
        for cand in phone_candidates:
            by_phone_rows, by_phone_code = await db_select(
                "medical_profiles",
                {"emergency_contact_phone": cand},
                columns=med_columns,
            )
            if by_phone_code in (200, 206) and by_phone_rows:
                medical_profiles = _select_best_medical_profile(by_phone_rows)
                break

    return PatientContextResponse(
        id=str(patient.get("id") or patient_id),
        full_name=patient.get("full_name"),
        phone=patient.get("phone"),
        medical_profiles=[PatientMedicalProfile(**m) for m in medical_profiles],
    )


@router.get(
    "/public-stats",
    response_model=PublicImpactStatsResponse,
    summary="Public impact counters for the landing page",
)
async def public_stats() -> PublicImpactStatsResponse:
    users, users_code = await db_select("profiles", {}, columns="id")
    ambulances, amb_code = await db_select("ambulances", {}, columns="id")
    emergencies, eme_code = await db_select(
        "emergency_requests",
        {},
        columns="id,status",
    )

    if any(code not in (200, 206) for code in (users_code, amb_code, eme_code)):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not load public platform stats.",
        )

    total_emergencies = len(emergencies)
    resolved_emergencies = sum(
        1 for emergency in emergencies if str(emergency.get("status") or "").lower() == "completed"
    )
    active_emergencies = sum(
        1
        for emergency in emergencies
        if str(emergency.get("status") or "").lower() not in ("completed", "cancelled")
    )

    return PublicImpactStatsResponse(
        total_users=len(users),
        total_ambulances=len(ambulances),
        resolved_emergencies=resolved_emergencies,
        active_emergencies=active_emergencies,
        total_emergencies=total_emergencies,
        updated_at=datetime.now(timezone.utc).isoformat(),
    )


@router.get(
    "/summary",
    response_model=OpsSummary,
    summary="Operational summary for admin/hospital dashboards",
)
async def ops_summary(
    days: int = Query(default=7, ge=1, le=90, description="Rolling analytics window in days"),
    current_user: dict = Depends(get_current_user),
) -> OpsSummary:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("admin", "hospital"))
    users, users_code = await db_select("profiles", {}, columns="id,role")
    ambulances, amb_code = await db_select("ambulances", {}, columns="id,is_available")
    hospitals, hosp_code = await db_select("hospitals", {}, columns="id")
    emergencies, eme_code = await db_select(
        "emergency_requests",
        {},
        columns="id,status,created_at,updated_at",
    )

    codes = [users_code, amb_code, hosp_code, eme_code]
    if any(code not in (200, 206) for code in codes):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not load operational analytics from database.",
        )

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=days)

    total_users = len(users)
    total_drivers = sum(1 for u in users if u.get("role") in ("driver", "ambulance"))
    total_hospitals = len(hospitals)
    total_ambulances = len(ambulances)
    available_ambulances = sum(1 for a in ambulances if bool(a.get("is_available")))

    total_emergencies = len(emergencies)
    completed = [e for e in emergencies if e.get("status") == "completed"]
    cancelled = [e for e in emergencies if e.get("status") == "cancelled"]
    active = [e for e in emergencies if e.get("status") not in ("completed", "cancelled")]

    recent_emergencies = 0
    completion_durations: list[float] = []
    for e in emergencies:
        created_at = _parse_iso(e.get("created_at"))
        updated_at = _parse_iso(e.get("updated_at"))

        if created_at and created_at >= cutoff:
            recent_emergencies += 1

        if e.get("status") == "completed" and created_at and updated_at and updated_at >= created_at:
            completion_durations.append((updated_at - created_at).total_seconds() / 60.0)

    avg_completion_minutes = None
    if completion_durations:
        avg_completion_minutes = round(sum(completion_durations) / len(completion_durations), 2)

    terminal_count = len(completed) + len(cancelled)
    completion_rate_pct = 0.0
    if terminal_count > 0:
        completion_rate_pct = round((len(completed) / terminal_count) * 100.0, 2)

    return OpsSummary(
        window_days=days,
        total_users=total_users,
        total_drivers=total_drivers,
        total_hospitals=total_hospitals,
        total_ambulances=total_ambulances,
        available_ambulances=available_ambulances,
        total_emergencies=total_emergencies,
        active_emergencies=len(active),
        completed_emergencies=len(completed),
        cancelled_emergencies=len(cancelled),
        recent_emergencies=recent_emergencies,
        avg_completion_minutes=avg_completion_minutes,
        completion_rate_pct=completion_rate_pct,
    )


@router.get(
    "/admin/dashboard",
    response_model=AdminDashboardResponse,
    summary="Admin dashboard data: users, emergencies, ambulances, hospitals",
)
async def admin_dashboard(
    current_user: dict = Depends(get_current_user),
    search: str | None = Query(default=None, description="Optional search across names/phones"),
    limit: int = Query(default=200, ge=1, le=1000, description="Max rows per table"),
) -> AdminDashboardResponse:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("admin",))

    users, users_code = await db_query(
        "profiles",
        params={"order": "created_at.desc", "limit": str(limit)},
    )
    emergencies, eme_code = await db_query(
        "emergency_requests",
        params={"order": "created_at.desc", "limit": str(limit)},
    )
    ambulances, amb_code = await db_query(
        "ambulances",
        params={"order": "created_at.desc", "limit": str(limit)},
    )
    hospitals, hosp_code = await db_query(
        "hospitals",
        params={"order": "created_at.desc", "limit": str(limit)},
    )

    if any(code not in (200, 206) for code in (users_code, eme_code, amb_code, hosp_code)):
        raise HTTPException(status_code=502, detail="Failed to load admin dashboard data")

    def _match_search(row: dict) -> bool:
        if not search:
            return True
        q = search.lower()
        for key in ("full_name", "phone", "name", "address", "emergency_type", "description", "status"):
            val = str(row.get(key) or "").lower()
            if q in val:
                return True
        return False

    def _inject_coords(row: dict, geometry_key: str = "patient_location") -> dict:
        coords = _parse_point_wkt(row.get(geometry_key))
        if coords:
            row = {
                **row,
                "latitude": coords[0],
                "longitude": coords[1],
            }
        return row

    emergencies = [_inject_coords(e) for e in emergencies if _match_search(e)]
    ambulances = [_inject_coords(a, "last_known_location") for a in ambulances if _match_search(a)]
    hospitals = [_inject_coords(h, "location") for h in hospitals if _match_search(h)]
    users = [u for u in users if _match_search(u)]

    return AdminDashboardResponse(
        users=users,
        emergencies=emergencies,
        ambulances=ambulances,
        hospitals=hospitals,
    )


@router.get(
    "/admin/hospitals/{hospital_id}",
    response_model=AdminHospitalDetailsResponse,
    summary="Admin hospital details with linked fleet and stats",
)
async def admin_hospital_details(
    hospital_id: str,
    current_user: dict = Depends(get_current_user),
) -> AdminHospitalDetailsResponse:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("admin",))

    hospital_rows, hospital_code = await db_select(
        "hospitals",
        {"id": hospital_id},
        columns="*",
    )
    if hospital_code not in (200, 206) or not hospital_rows:
        raise HTTPException(status_code=404, detail="Hospital not found")

    ambulances, amb_code = await db_query(
        "ambulances",
        params={"hospital_id": f"eq.{hospital_id}", "order": "created_at.desc"},
    )
    if amb_code not in (200, 206):
        raise HTTPException(status_code=502, detail="Failed to load linked ambulances")

    driver_profiles, prof_code = await db_query(
        "profiles",
        params={"hospital_id": f"eq.{hospital_id}", "order": "created_at.desc"},
    )
    if prof_code not in (200, 206):
        driver_profiles = []

    linked_driver_profiles = [
        p
        for p in (driver_profiles or [])
        if str(p.get("role") or "").lower() in ("ambulance", "driver")
    ]

    emergencies, eme_code = await db_query(
        "emergency_requests",
        params={"hospital_id": f"eq.{hospital_id}", "order": "created_at.desc"},
    )
    if eme_code not in (200, 206):
        raise HTTPException(status_code=502, detail="Failed to load hospital emergencies")

    total_emergencies = len(emergencies or [])
    active_emergencies = sum(
        1
        for e in (emergencies or [])
        if str(e.get("status") or "") not in ("completed", "cancelled")
    )
    completed_emergencies = sum(
        1 for e in (emergencies or []) if str(e.get("status") or "") == "completed"
    )
    cancelled_emergencies = sum(
        1 for e in (emergencies or []) if str(e.get("status") or "") == "cancelled"
    )

    return AdminHospitalDetailsResponse(
        hospital=hospital_rows[0],
        linked_ambulances=ambulances or [],
        linked_driver_profiles=linked_driver_profiles,
        total_emergencies=total_emergencies,
        active_emergencies=active_emergencies,
        completed_emergencies=completed_emergencies,
        cancelled_emergencies=cancelled_emergencies,
    )


@router.put(
    "/admin/hospitals/{hospital_id}",
    response_model=HospitalProfileResponse,
    summary="Admin update hospital operational settings",
)
async def admin_update_hospital(
    hospital_id: str,
    payload: AdminHospitalUpdateRequest,
    current_user: dict = Depends(get_current_user),
) -> HospitalProfileResponse:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("admin",))

    updates = payload.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No update fields provided")

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    _, update_code = await db_update("hospitals", {"id": hospital_id}, updates)
    if update_code not in (200, 204):
        raise HTTPException(status_code=502, detail="Failed to update hospital")

    rows, code = await db_select(
        "hospitals",
        {"id": hospital_id},
        columns=(
            "id,name,address,phone,is_accepting_emergencies,max_concurrent_emergencies,"
            "dispatch_weight,trauma_capable,icu_beds_available,average_handover_minutes,updated_at"
        ),
    )
    if code not in (200, 206) or not rows:
        raise HTTPException(status_code=404, detail="Hospital not found after update")

    row = rows[0]
    dispatch_weight_raw = row.get("dispatch_weight")
    try:
        dispatch_weight = float(dispatch_weight_raw) if dispatch_weight_raw is not None else None
    except Exception:
        dispatch_weight = None

    return HospitalProfileResponse(
        hospital_id=str(row.get("id") or hospital_id),
        name=(str(row.get("name") or "").strip() or None),
        address=(str(row.get("address") or "").strip() or None),
        phone=(str(row.get("phone") or "").strip() or None),
        is_accepting_emergencies=row.get("is_accepting_emergencies"),
        max_concurrent_emergencies=row.get("max_concurrent_emergencies"),
        dispatch_weight=dispatch_weight,
        trauma_capable=row.get("trauma_capable"),
        icu_beds_available=row.get("icu_beds_available"),
        average_handover_minutes=row.get("average_handover_minutes"),
        updated_at=(str(row.get("updated_at") or "").strip() or None),
    )


@router.get(
    "/hospital/emergencies",
    response_model=list[HospitalEmergency],
    summary="Hospital-scoped emergencies with patient context",
)
async def hospital_emergencies(
    current_user: dict = Depends(get_current_user),
    status_filter: str | None = Query(default=None, description="optional status filter"),
) -> list[HospitalEmergency]:
    user_id = str(current_user.get("sub") or "")
    profile = await _require_role(user_id, current_user, ("hospital", "admin"))

    hospital_id = profile.get("hospital_id") if profile.get("role") == "hospital" else None
    if str(profile.get("role") or "") == "hospital" and not hospital_id:
        raise HTTPException(status_code=403, detail="Hospital user is not linked to hospital_id")

    emergency_params: dict = {"order": "created_at.desc", "limit": "200"}
    if hospital_id:
        emergency_params["hospital_id"] = f"eq.{hospital_id}"
    if status_filter:
        emergency_params["status"] = f"eq.{status_filter}"
    emergencies, eme_code = await db_query("emergency_requests", params=emergency_params)
    if eme_code not in (200, 206):
        raise HTTPException(status_code=502, detail="Failed to load emergencies")

    # Batch-load all patient profiles, medical profiles, and ambulances in parallel
    import asyncio as _asyncio
    patient_ids = list({str(raw.get("patient_id") or "") for raw in emergencies if raw.get("patient_id")})
    ambulance_ids = list({str(raw.get("assigned_ambulance_id") or "") for raw in emergencies if raw.get("assigned_ambulance_id")})
    profiles_by_id: dict[str, dict] = {}
    medical_by_id: dict[str, dict] = {}
    vehicles_by_amb: dict[str, str] = {}
    amb_rows: list = []

    # Fire all batch queries in parallel
    profile_task = None
    medical_task = None
    amb_task = None
    if patient_ids:
        ids_csv = ",".join(patient_ids)
        profile_task = _asyncio.create_task(db_query(
            "profiles",
            columns="id,full_name,phone,national_id",
            params={"id": f"in.({ids_csv})"},
        ))
        medical_task = _asyncio.create_task(db_query(
            "medical_profiles",
            columns="user_id,blood_type,allergies,medical_conditions,emergency_contact_name,emergency_contact_phone,updated_at",
            params={"user_id": f"in.({ids_csv})"},
        ))
    if ambulance_ids:
        amb_csv = ",".join(ambulance_ids)
        amb_task = _asyncio.create_task(db_query(
            "ambulances",
            columns="id,vehicle_number,registration_number,last_known_location",
            params={"id": f"in.({amb_csv})"},
        ))

    if profile_task:
        profile_rows, _ = await profile_task
        for p in (profile_rows or []):
            profiles_by_id[str(p.get("id") or "")] = p
    if medical_task:
        medical_rows, _ = await medical_task
        for m in (medical_rows or []):
            uid = str(m.get("user_id") or "")
            existing = medical_by_id.get(uid)
            if not existing or (m.get("updated_at") or "") > (existing.get("updated_at") or ""):
                medical_by_id[uid] = m
    if amb_task:
        amb_rows_result, _ = await amb_task
        amb_rows = amb_rows_result or []
        for a in amb_rows:
            aid = str(a.get("id") or "")
            vehicles_by_amb[aid] = str(a.get("vehicle_number") or a.get("registration_number") or "")

    # Parse ambulance locations
    amb_coords_by_id: dict[str, tuple[float, float]] = {}
    if ambulance_ids:
        for a in (amb_rows or []):
            aid = str(a.get("id") or "")
            parsed_amb = _parse_point_wkt(a.get("last_known_location"))
            if parsed_amb:
                amb_coords_by_id[aid] = parsed_amb

    results: list[HospitalEmergency] = []
    for raw in emergencies:
        coords = _parse_point_wkt(raw.get("patient_location"))
        pid = str(raw.get("patient_id") or "")
        amb_id = str(raw.get("assigned_ambulance_id") or "")
        # national_id: prefer emergency_requests row, fallback to profile
        nid = raw.get("national_id") or (profiles_by_id.get(pid) or {}).get("national_id")

        amb_loc = amb_coords_by_id.get(amb_id)
        results.append(
            HospitalEmergency(
                id=str(raw.get("id")),
                patient_id=pid,
                hospital_id=raw.get("hospital_id"),
                status=str(raw.get("status") or "pending"),
                emergency_type=str(raw.get("emergency_type") or "medical"),
                description=raw.get("description"),
                latitude=coords[0] if coords else None,
                longitude=coords[1] if coords else None,
                created_at=str(raw.get("created_at") or ""),
                updated_at=str(raw.get("updated_at") or ""),
                patient_profile=profiles_by_id.get(pid),
                patient_medical=medical_by_id.get(pid),
                national_id=nid,
                ambulance_vehicle=vehicles_by_amb.get(amb_id) or None,
                ambulance_latitude=amb_loc[0] if amb_loc else None,
                ambulance_longitude=amb_loc[1] if amb_loc else None,
            )
        )

    return results


@router.get(
    "/hospital/fleet",
    response_model=HospitalFleetResponse,
    summary="Hospital-linked ambulance fleet overview",
)
async def hospital_fleet(
    current_user: dict = Depends(get_current_user),
    hospital_id: str | None = Query(default=None, description="optional hospital id for admin"),
) -> HospitalFleetResponse:
    user_id = str(current_user.get("sub") or "")
    profile = await _require_role(user_id, current_user, ("hospital", "admin"))

    effective_hospital_id = await _resolve_effective_hospital_id(
        profile=profile,
        current_user=current_user,
        requested_hospital_id=hospital_id,
    )

    if not effective_hospital_id:
        # Free-tier / legacy data can have hospital auth users without linkage.
        # Return an empty fleet response instead of hard-failing the dashboard.
        return HospitalFleetResponse(
            hospital_id="",
            total_ambulances=0,
            available_ambulances=0,
            busy_ambulances=0,
            ambulances=[],
        )

    ambulances, amb_code = await db_query(
        "ambulances",
        params={
            "hospital_id": f"eq.{effective_hospital_id}",
            "order": "created_at.desc",
        },
    )
    if amb_code not in (200, 206):
        raise HTTPException(status_code=502, detail="Failed to load hospital ambulances")

    total = len(ambulances)
    available = sum(1 for a in ambulances if bool(a.get("is_available")))
    busy = total - available

    return HospitalFleetResponse(
        hospital_id=str(effective_hospital_id),
        total_ambulances=total,
        available_ambulances=available,
        busy_ambulances=busy,
        ambulances=ambulances,
    )


@router.get(
    "/hospital/profile",
    response_model=HospitalProfileResponse,
    summary="Hospital profile details for header and dashboard context",
)
async def hospital_profile(
    current_user: dict = Depends(get_current_user),
    hospital_id: str | None = Query(default=None, description="optional hospital id for admin"),
) -> HospitalProfileResponse:
    user_id = str(current_user.get("sub") or "")
    profile = await _require_role(user_id, current_user, ("hospital", "admin"))
    effective_hospital_id = await _resolve_effective_hospital_id(
        profile=profile,
        current_user=current_user,
        requested_hospital_id=hospital_id,
    )

    if not effective_hospital_id:
        return HospitalProfileResponse(hospital_id="")

    rows, code = await db_select(
        "hospitals",
        {"id": str(effective_hospital_id)},
        columns=(
            "id,name,address,phone,is_accepting_emergencies,max_concurrent_emergencies,"
            "dispatch_weight,trauma_capable,icu_beds_available,average_handover_minutes,updated_at"
        ),
    )
    if code not in (200, 206) or not rows:
        return HospitalProfileResponse(hospital_id=str(effective_hospital_id))

    row = rows[0]
    dispatch_weight_raw = row.get("dispatch_weight")
    try:
        dispatch_weight = float(dispatch_weight_raw) if dispatch_weight_raw is not None else None
    except Exception:
        dispatch_weight = None

    return HospitalProfileResponse(
        hospital_id=str(row.get("id") or effective_hospital_id),
        name=(str(row.get("name") or "").strip() or None),
        address=(str(row.get("address") or "").strip() or None),
        phone=(str(row.get("phone") or "").strip() or None),
        is_accepting_emergencies=row.get("is_accepting_emergencies"),
        max_concurrent_emergencies=row.get("max_concurrent_emergencies"),
        dispatch_weight=dispatch_weight,
        trauma_capable=row.get("trauma_capable"),
        icu_beds_available=row.get("icu_beds_available"),
        average_handover_minutes=row.get("average_handover_minutes"),
        updated_at=(str(row.get("updated_at") or "").strip() or None),
    )


@router.put(
    "/hospital/profile",
    response_model=HospitalProfileResponse,
    summary="Update current hospital profile settings",
)
async def update_hospital_profile(
    payload: HospitalProfileUpdateRequest,
    current_user: dict = Depends(get_current_user),
    hospital_id: str | None = Query(default=None, description="optional hospital id for admin"),
) -> HospitalProfileResponse:
    user_id = str(current_user.get("sub") or "")
    profile = await _require_role(user_id, current_user, ("hospital", "admin"))
    effective_hospital_id = await _resolve_effective_hospital_id(
        profile=profile,
        current_user=current_user,
        requested_hospital_id=hospital_id,
    )

    if not effective_hospital_id:
        raise HTTPException(status_code=400, detail="Hospital linkage could not be resolved")

    updates = payload.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="No update fields provided")

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()
    _, update_code = await db_update("hospitals", {"id": str(effective_hospital_id)}, updates)
    if update_code not in (200, 204):
        raise HTTPException(status_code=502, detail="Failed to update hospital profile")

    rows, code = await db_select(
        "hospitals",
        {"id": str(effective_hospital_id)},
        columns=(
            "id,name,address,phone,is_accepting_emergencies,max_concurrent_emergencies,"
            "dispatch_weight,trauma_capable,icu_beds_available,average_handover_minutes,updated_at"
        ),
    )
    if code not in (200, 206) or not rows:
        raise HTTPException(status_code=404, detail="Hospital not found after update")

    row = rows[0]
    dispatch_weight_raw = row.get("dispatch_weight")
    try:
        dispatch_weight = float(dispatch_weight_raw) if dispatch_weight_raw is not None else None
    except Exception:
        dispatch_weight = None

    return HospitalProfileResponse(
        hospital_id=str(row.get("id") or effective_hospital_id),
        name=(str(row.get("name") or "").strip() or None),
        address=(str(row.get("address") or "").strip() or None),
        phone=(str(row.get("phone") or "").strip() or None),
        is_accepting_emergencies=row.get("is_accepting_emergencies"),
        max_concurrent_emergencies=row.get("max_concurrent_emergencies"),
        dispatch_weight=dispatch_weight,
        trauma_capable=row.get("trauma_capable"),
        icu_beds_available=row.get("icu_beds_available"),
        average_handover_minutes=row.get("average_handover_minutes"),
        updated_at=(str(row.get("updated_at") or "").strip() or None),
    )


@router.get(
    "/hospitals/{hospital_id}/basic",
    response_model=HospitalBasicResponse,
    summary="Basic hospital info for driver/patient UIs",
)
async def get_hospital_basic(
    hospital_id: str,
    current_user: dict = Depends(get_current_user),
) -> HospitalBasicResponse:
    user_id = str(current_user.get("sub") or "")
    await _require_role(
        user_id,
        current_user,
        ("admin", "hospital", "driver", "ambulance", "patient", "staff"),
    )

    rows, code = await db_select(
        "hospitals",
        {"id": hospital_id},
        columns="id,name,address,phone,is_accepting_emergencies",
    )
    if code not in (200, 206) or not rows:
        raise HTTPException(status_code=404, detail="Hospital not found")

    row = rows[0]
    return HospitalBasicResponse(
        id=str(row.get("id") or hospital_id),
        name=(str(row.get("name") or "").strip() or None),
        address=(str(row.get("address") or "").strip() or None),
        phone=(str(row.get("phone") or "").strip() or None),
        is_accepting_emergencies=row.get("is_accepting_emergencies"),
    )

@router.post(
    "/hospital/fleet/repair-links",
    response_model=HospitalFleetRepairResponse,
    summary="Repair unlinked ambulances by assigning them to hospital fleet",
)
async def repair_hospital_fleet_links(
    current_user: dict = Depends(get_current_user),
    hospital_id: str | None = Query(default=None, description="optional hospital id for admin"),
) -> HospitalFleetRepairResponse:
    user_id = str(current_user.get("sub") or "")
    profile = await _require_role(user_id, current_user, ("hospital", "admin"))
    effective_hospital_id = await _resolve_effective_hospital_id(
        profile=profile,
        current_user=current_user,
        requested_hospital_id=hospital_id,
    )

    if not effective_hospital_id:
        raise HTTPException(status_code=400, detail="Hospital linkage could not be resolved for this account")

    ambulances, amb_code = await db_query(
        "ambulances",
        columns="id,hospital_id",
        params={"order": "created_at.desc"},
    )
    if amb_code not in (200, 206):
        raise HTTPException(status_code=502, detail="Failed to load ambulances for repair")

    unlinked = [
        row for row in (ambulances or []) if not str(row.get("hospital_id") or "").strip()
    ]

    repaired_ambulance_ids: list[str] = []
    repaired_driver_profiles = 0
    for amb in unlinked:
        ambulance_id = str(amb.get("id") or "")
        if not ambulance_id:
            continue

        _, update_code = await db_update(
            "ambulances",
            {"id": ambulance_id},
            {"hospital_id": effective_hospital_id},
        )
        if update_code not in (200, 204):
            continue

        repaired_ambulance_ids.append(ambulance_id)

        profile_rows, profile_code = await db_select(
            "profiles",
            {"ambulance_id": ambulance_id},
            columns="id,hospital_id",
        )
        if profile_code in (200, 206) and profile_rows:
            for driver_profile in profile_rows:
                if str(driver_profile.get("hospital_id") or "").strip():
                    continue
                _, prof_update_code = await db_update(
                    "profiles",
                    {"id": str(driver_profile.get("id") or "")},
                    {"hospital_id": effective_hospital_id},
                )
                if prof_update_code in (200, 204):
                    repaired_driver_profiles += 1

    return HospitalFleetRepairResponse(
        hospital_id=effective_hospital_id,
        scanned_unlinked_ambulances=len(unlinked),
        repaired_ambulances=len(repaired_ambulance_ids),
        repaired_driver_profiles=repaired_driver_profiles,
        repaired_ambulance_ids=repaired_ambulance_ids,
    )


# ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
# Admin Settings ΓÇö runtime API key + provider management
# ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

# Supported AI providers — each maps to an OpenAI-compatible base_url + default model.
_DEFAULT_AI_PROVIDERS: dict[str, dict[str, str]] = {
    "deepseek": {
        "base_url": "https://api.deepseek.com",
        "model": "deepseek-chat",
    },
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
    },
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "model": "llama-3.1-8b-instant",
    },
}

_AI_SETTINGS_FILE = _os.path.join(_os.path.dirname(__file__), "..", "_admin_ai_settings.json")
_AI_SETTINGS_LOCK = _threading.Lock()

# Runtime mutable provider/config state (default: deepseek).
_AI_PROVIDERS: dict[str, dict[str, str]] = dict(_DEFAULT_AI_PROVIDERS)
_PROVIDER_API_KEYS: dict[str, str] = {}
_active_provider: str = "deepseek"


def _normalize_provider_name(provider: str) -> str:
    normalized = "".join(ch for ch in provider.strip().lower() if ch.isalnum() or ch in ("-", "_"))
    return normalized


def _mask_key(api_key: str) -> str:
    text = (api_key or "").strip()
    if len(text) <= 4:
        return "(not set)"
    return f"{text[:4]}...{text[-4:]}"


def _load_ai_settings() -> None:
    global _AI_PROVIDERS, _PROVIDER_API_KEYS, _active_provider
    from config import settings as app_settings

    providers = dict(_DEFAULT_AI_PROVIDERS)
    provider_keys: dict[str, str] = {}

    deepseek_key = (app_settings.deepseek_api_key or "").strip()
    if deepseek_key:
        provider_keys["deepseek"] = deepseek_key

    active_provider = "deepseek"

    try:
        with open(_AI_SETTINGS_FILE, "r", encoding="utf-8") as handle:
            payload = _json.load(handle)
    except (FileNotFoundError, OSError, _json.JSONDecodeError):
        payload = {}

    file_providers = payload.get("providers") if isinstance(payload, dict) else None
    if isinstance(file_providers, dict):
        for raw_name, cfg in file_providers.items():
            provider = _normalize_provider_name(str(raw_name or ""))
            if not provider or not isinstance(cfg, dict):
                continue
            base_url = str(cfg.get("base_url") or "").strip()
            model = str(cfg.get("model") or "").strip()
            if not base_url or not model:
                continue
            providers[provider] = {"base_url": base_url, "model": model}

    file_keys = payload.get("provider_keys") if isinstance(payload, dict) else None
    if isinstance(file_keys, dict):
        for raw_name, raw_key in file_keys.items():
            provider = _normalize_provider_name(str(raw_name or ""))
            if not provider:
                continue
            key = str(raw_key or "").strip()
            if key:
                provider_keys[provider] = key

    raw_active = payload.get("active_provider") if isinstance(payload, dict) else None
    if isinstance(raw_active, str):
        normalized = _normalize_provider_name(raw_active)
        if normalized in providers:
            active_provider = normalized

    _AI_PROVIDERS = providers
    _PROVIDER_API_KEYS = provider_keys
    _active_provider = active_provider


def _persist_ai_settings() -> None:
    payload = {
        "providers": _AI_PROVIDERS,
        "provider_keys": _PROVIDER_API_KEYS,
        "active_provider": _active_provider,
    }
    try:
        with _AI_SETTINGS_LOCK:
            with open(_AI_SETTINGS_FILE, "w", encoding="utf-8") as handle:
                _json.dump(payload, handle)
    except OSError:
        pass


def _provider_has_key(provider: str) -> bool:
    return len((_PROVIDER_API_KEYS.get(provider) or "").strip()) > 4


def _provider_preview(provider: str) -> str:
    return _mask_key(_PROVIDER_API_KEYS.get(provider) or "")


def _apply_chat_provider(provider: str, api_key: str) -> None:
    import routers.chat as chat_module

    cfg = _AI_PROVIDERS[provider]
    chat_module._deepseek = chat_module.AsyncOpenAI(
        api_key=api_key,
        base_url=cfg["base_url"],
    )
    chat_module._MODEL = cfg["model"]


_load_ai_settings()


class AdminProviderConfigResponse(BaseModel):
    provider: str
    base_url: str
    model: str
    api_key_set: bool
    api_key_preview: str


class AdminSettingsResponse(BaseModel):
    deepseek_api_key_set: bool
    deepseek_api_key_preview: str
    active_provider: str
    available_providers: list[str]
    provider_configs: list[AdminProviderConfigResponse]
    total_chat_requests: int
    unique_chat_users: int
    today_chat_requests: int


class AdminUpdateApiKeyRequest(BaseModel):
    api_key: str | None = Field(default=None, min_length=1, max_length=200)
    provider: str = Field(default="deepseek")


class AdminUpsertProviderRequest(BaseModel):
    provider: str = Field(..., min_length=1, max_length=40)
    base_url: str = Field(..., min_length=8, max_length=200)
    model: str = Field(..., min_length=1, max_length=120)
    api_key: str | None = Field(default=None, min_length=1, max_length=200)
    set_active: bool = True


@router.get(
    "/admin/settings",
    response_model=AdminSettingsResponse,
    summary="Get current admin settings (API key status, provider, stats)",
)
async def admin_get_settings(
    current_user: dict = Depends(get_current_user),
) -> AdminSettingsResponse:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("admin",))

    global _active_provider

    active_provider = _active_provider if _active_provider in _AI_PROVIDERS else "deepseek"
    if active_provider != _active_provider:
        _active_provider = active_provider

    active_has_key = _provider_has_key(active_provider)
    active_preview = _provider_preview(active_provider)

    provider_configs = [
        AdminProviderConfigResponse(
            provider=name,
            base_url=cfg["base_url"],
            model=cfg["model"],
            api_key_set=_provider_has_key(name),
            api_key_preview=_provider_preview(name),
        )
        for name, cfg in sorted(_AI_PROVIDERS.items(), key=lambda item: item[0])
    ]

    # Chat stats
    rows, _ = await db_query("chatbot_messages", params={"select": "id,user_id,created_at"})
    all_rows = rows or []
    total = len(all_rows)
    unique_users = len({r.get("user_id") for r in all_rows if r.get("user_id")})
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    today_count = sum(1 for r in all_rows if (r.get("created_at") or "").startswith(today_str))

    return AdminSettingsResponse(
        deepseek_api_key_set=active_has_key,
        deepseek_api_key_preview=active_preview,
        active_provider=active_provider,
        available_providers=list(_AI_PROVIDERS.keys()),
        provider_configs=provider_configs,
        total_chat_requests=total,
        unique_chat_users=unique_users,
        today_chat_requests=today_count,
    )


@router.put(
    "/admin/settings/api-key",
    summary="Update the AI API key and optionally switch provider",
)
async def admin_update_api_key(
    payload: AdminUpdateApiKeyRequest,
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("admin",))

    global _active_provider

    provider = _normalize_provider_name(payload.provider)
    if provider not in _AI_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}. Supported: {list(_AI_PROVIDERS.keys())}")

    if payload.api_key is not None:
        new_key = payload.api_key.strip()
        if not new_key:
            raise HTTPException(status_code=400, detail="api_key cannot be empty")
        _PROVIDER_API_KEYS[provider] = new_key

    provider_key = (_PROVIDER_API_KEYS.get(provider) or "").strip()
    if not provider_key:
        raise HTTPException(
            status_code=400,
            detail=f"No API key stored for provider '{provider}'. Save a key first.",
        )

    _active_provider = provider
    _apply_chat_provider(provider, provider_key)
    _persist_ai_settings()

    provider_cfg = _AI_PROVIDERS[provider]
    return {
        "success": True,
        "message": f"Provider activated: {provider}, model: {provider_cfg['model']}",
    }


@router.post(
    "/admin/settings/providers",
    summary="Create or update AI provider configuration",
)
async def admin_upsert_provider(
    payload: AdminUpsertProviderRequest,
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("admin",))

    global _active_provider

    provider = _normalize_provider_name(payload.provider)
    if not provider:
        raise HTTPException(status_code=400, detail="Invalid provider name")

    base_url = payload.base_url.strip()
    model = payload.model.strip()
    if not base_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="base_url must start with http:// or https://")

    _AI_PROVIDERS[provider] = {
        "base_url": base_url,
        "model": model,
    }

    if payload.api_key is not None and payload.api_key.strip():
        _PROVIDER_API_KEYS[provider] = payload.api_key.strip()

    if payload.set_active:
        provider_key = (_PROVIDER_API_KEYS.get(provider) or "").strip()
        if not provider_key:
            raise HTTPException(
                status_code=400,
                detail=f"Provider '{provider}' saved, but no api_key is stored for it yet.",
            )
        _active_provider = provider
        _apply_chat_provider(provider, provider_key)

    _persist_ai_settings()
    return {
        "success": True,
        "provider": provider,
        "active_provider": _active_provider,
        "message": f"Provider '{provider}' saved successfully.",
    }


class StatusUpdate(BaseModel):
    status: Literal[
        "pending",
        "assigned",
        "en_route",
        "at_scene",
        "arrived",
        "transporting",
        "at_hospital",
        "completed",
        "cancelled",
    ]


@router.put(
    "/emergencies/{emergency_id}/status",
    summary="Update emergency status with role-based checks",
)
async def update_emergency_status(
    emergency_id: str,
    payload: StatusUpdate,
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = str(current_user.get("sub") or "")
    profile = await _require_role(user_id, current_user, ("hospital", "admin"))
    role = str(profile.get("role") or "")

    emergency_rows, eme_code = await db_select("emergency_requests", {"id": emergency_id})
    if eme_code not in (200, 206) or not emergency_rows:
        raise HTTPException(status_code=404, detail="Emergency not found")
    emergency = emergency_rows[0]

    if role == "hospital":
        my_hospital_id = profile.get("hospital_id")
        if not my_hospital_id:
            raise HTTPException(status_code=403, detail="Hospital account is not linked to a hospital_id")
        emergency_hospital_id = emergency.get("hospital_id")
        if emergency_hospital_id and str(emergency_hospital_id) != str(my_hospital_id):
            raise HTTPException(status_code=403, detail="Emergency belongs to a different hospital")

        # Trust boundary: hospitals can only finalise handover stages.
        if payload.status not in ("at_hospital", "completed"):
            raise HTTPException(
                status_code=403,
                detail="Hospital can only update to at_hospital or completed.",
            )

        current_status = str(emergency.get("status") or "")
        if payload.status == "at_hospital" and current_status not in (
            "transporting",
            "arrived",
            "at_scene",
            "at_hospital",
        ):
            raise HTTPException(
                status_code=409,
                detail="Hospital can mark at_hospital only after transport has started.",
            )
        if payload.status == "completed" and current_status not in (
            "at_hospital",
            "completed",
        ):
            raise HTTPException(
                status_code=409,
                detail="Hospital can complete only after patient is at_hospital.",
            )

    update_payload = {
        "status": payload.status,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if role == "hospital" and not emergency.get("hospital_id") and profile.get("hospital_id"):
        update_payload["hospital_id"] = profile.get("hospital_id")

    _, update_code = await db_update("emergency_requests", {"id": emergency_id}, update_payload)
    if update_code not in (200, 204):
        raise HTTPException(status_code=400, detail="Failed to update status")

    if payload.status in ("cancelled", "completed"):
        now = datetime.now(timezone.utc).isoformat()
        assign_rows, _ = await db_select(
            "emergency_assignments",
            {"emergency_id": emergency_id},
            columns="ambulance_id,status",
        )
        for row in (assign_rows or []):
            amb_id = str(row.get("ambulance_id") or "")
            if amb_id:
                await db_update(
                    "ambulances",
                    {"id": amb_id},
                    {"is_available": True, "updated_at": now},
                )

        await db_update(
            "emergency_assignments",
            {"emergency_id": emergency_id},
            {"status": "declined", "completed_at": now},
        )

    return {"success": True, "status": payload.status}


@router.post(
    "/triage-score",
    response_model=TriageOutput,
    summary="Deterministic emergency triage score for rapid prioritisation",
)
async def triage_score(
    payload: TriageInput,
    current_user: dict = Depends(get_current_user),
) -> TriageOutput:
    score = 0

    severity_weight = {"low": 10, "medium": 30, "high": 55, "critical": 75}
    score += severity_weight[payload.severity]

    if not payload.conscious:
        score += 20
    if payload.breathing_difficulty:
        score += 18
    if payload.severe_bleeding:
        score += 20
    if payload.chest_pain:
        score += 15
    if payload.stroke_symptoms:
        score += 20
    if payload.trauma:
        score += 12

    if payload.age is not None and (payload.age <= 5 or payload.age >= 65):
        score += 8
    if payload.fever_c is not None and payload.fever_c >= 39.5:
        score += 8

    score = min(score, 100)

    if score >= 85:
        priority: Literal["P1", "P2", "P3", "P4"] = "P1"
        dispatch = 5
        recommendations = [
            "Dispatch nearest available ambulance immediately.",
            "Notify destination hospital to prepare resuscitation team.",
            "Keep caller on line and provide critical first-aid instructions.",
        ]
    elif score >= 65:
        priority = "P2"
        dispatch = 10
        recommendations = [
            "Prioritise ambulance dispatch in high queue order.",
            "Monitor patient status every 2-3 minutes until pickup.",
            "Prepare escalation path to P1 if condition worsens.",
        ]
    elif score >= 40:
        priority = "P3"
        dispatch = 20
        recommendations = [
            "Dispatch when a closer high-priority case is not pending.",
            "Provide guided first aid and symptom monitoring.",
            "Reassess triage score if new red flags appear.",
        ]
    else:
        priority = "P4"
        dispatch = 30
        recommendations = [
            "Queue as non-immediate emergency support.",
            "Share self-care and warning signs for escalation.",
            "Recommend nearby clinic follow-up when appropriate.",
        ]

    return TriageOutput(
        score=score,
        priority=priority,
        recommended_dispatch_minutes=dispatch,
        recommendations=recommendations,
    )


@router.get(
    "/fleet-intelligence",
    response_model=FleetIntelligenceResponse,
    summary="Hospital and ambulance readiness intelligence",
)
async def fleet_intelligence(
    current_user: dict = Depends(get_current_user),
) -> FleetIntelligenceResponse:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("admin", "hospital"))
    hospitals, hosp_code = await db_select(
        "hospitals",
        {},
        columns=(
            "id,name,phone,is_accepting_emergencies,dispatch_weight,"
            "max_concurrent_emergencies,trauma_capable,icu_beds_available"
        ),
    )
    if hosp_code not in (200, 206):
        hospitals, hosp_code = await db_select(
            "hospitals",
            {},
            columns="id,name,phone",
        )
    ambulances, amb_code = await db_select(
        "ambulances",
        {},
        columns="id,hospital_id,is_available",
    )
    emergencies, eme_code = await db_select(
        "emergency_requests",
        {},
        columns="id,hospital_id,status",
    )

    codes = [hosp_code, amb_code, eme_code]
    if any(code not in (200, 206) for code in codes):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not load fleet intelligence from database.",
        )

    insights: list[HospitalFleetInsight] = []
    for hospital in hospitals:
        hospital_id = str(hospital.get("id", ""))
        hospital_ambulances = [
            a for a in ambulances if str(a.get("hospital_id", "")) == hospital_id
        ]
        total = len(hospital_ambulances)
        available = sum(1 for a in hospital_ambulances if bool(a.get("is_available")))
        busy = max(total - available, 0)

        active_emergencies = sum(
            1
            for e in emergencies
            if str(e.get("hospital_id", "")) == hospital_id
            and e.get("status") not in ("completed", "cancelled")
        )

        dispatch_weight = float(hospital.get("dispatch_weight") or 1.0)
        max_concurrent = int(hospital.get("max_concurrent_emergencies") or 20)
        is_accepting = bool(hospital.get("is_accepting_emergencies", True))
        trauma_capable = bool(hospital.get("trauma_capable", False))
        icu_beds = int(hospital.get("icu_beds_available") or 0)

        if total == 0:
            readiness_score = 0.0
        else:
            load_pressure = active_emergencies / max(max_concurrent, 1)
            load_component = max(0, 1 - min(load_pressure, 1.5))
            readiness_score = round(
                ((available / total) * 70.0)
                + (load_component * 20.0)
                + (min(dispatch_weight, 2.0) * 5.0)
                + (5.0 if trauma_capable else 0.0)
                + (min(icu_beds, 5) * 1.0),
                2,
            )
            if not is_accepting:
                readiness_score = 0.0

        insights.append(
            HospitalFleetInsight(
                hospital_id=hospital_id,
                hospital_name=str(hospital.get("name") or "Unknown Hospital"),
                hospital_phone=(
                    str(hospital.get("phone")) if hospital.get("phone") else None
                ),
                total_ambulances=total,
                available_ambulances=available,
                busy_ambulances=busy,
                active_emergencies=active_emergencies,
                readiness_score=readiness_score,
            )
        )

    insights.sort(key=lambda x: x.readiness_score, reverse=True)

    return FleetIntelligenceResponse(
        generated_at=datetime.now(timezone.utc).isoformat(),
        hospitals=insights,
    )


@router.get(
    "/dispatch-recommendation",
    response_model=DispatchRecommendationResponse,
    summary="Recommend best ambulance-hospital dispatch pair",
)
async def dispatch_recommendation(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    max_radius_km: float = Query(default=50.0, ge=1.0, le=200.0),
    current_user: dict = Depends(get_current_user),
) -> DispatchRecommendationResponse:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("patient", "admin", "hospital", "driver", "ambulance"))
    best, reason = await _compute_dispatch_recommendation(
        latitude,
        longitude,
        max_radius_km,
    )

    if best is None:
        return DispatchRecommendationResponse(
            ambulance_id=None,
            hospital_id=None,
            score=None,
            distance_km=None,
            reason=reason,
        )

    return DispatchRecommendationResponse(
        ambulance_id=best["ambulance_id"],
        hospital_id=best["hospital_id"],
        score=best["score"],
        distance_km=best["distance_km"],
        reason=reason,
    )


@router.post(
    "/patient/emergencies",
    response_model=EmergencyDispatchCreateResponse,
    summary="Create emergency with nearest hospital and ambulance dispatch",
)
async def create_patient_emergency(
    payload: EmergencyDispatchCreateRequest,
    current_user: dict = Depends(get_current_user),
) -> EmergencyDispatchCreateResponse:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("patient", "admin"))

    active_rows, active_code = await db_query(
        "emergency_requests",
        columns="id,status,hospital_id,assigned_ambulance_id,patient_location",
        params={
            "patient_id": f"eq.{user_id}",
            "status": "in.(pending,assigned,en_route,at_scene,arrived,transporting,at_hospital)",
            "order": "created_at.desc",
            "limit": "1",
        },
    )
    if active_code in (200, 206) and active_rows:
        existing = active_rows[0]
        existing_id = str(existing.get("id") or "")
        existing_status = str(existing.get("status") or "pending")
        existing_hospital_id = (
            str(existing.get("hospital_id")) if existing.get("hospital_id") else None
        )
        existing_ambulance_id = (
            str(existing.get("assigned_ambulance_id")) if existing.get("assigned_ambulance_id") else None
        )
        existing_loc = _parse_point_wkt(existing.get("patient_location"))
        existing_dist = None
        if existing_loc:
            existing_dist = round(
                _distance_km(payload.latitude, payload.longitude, existing_loc[0], existing_loc[1]),
                2,
            )

        # If an active request exists and is already assigned/in progress, reuse it.
        if existing_ambulance_id or existing_status in (
            "assigned",
            "en_route",
            "at_scene",
            "arrived",
            "transporting",
            "at_hospital",
        ):
            return EmergencyDispatchCreateResponse(
                emergency_id=existing_id,
                status=existing_status,
                hospital_id=existing_hospital_id,
                assigned_ambulance_id=existing_ambulance_id,
                distance_to_ambulance_km=None,
                distance_to_hospital_km=existing_dist,
                eta_minutes=None,
                route_to_patient_url=None,
                route_to_hospital_url=None,
                reason="Existing active emergency request reused",
            )

        # Pending but not assigned: try immediate nearest dispatch on the same request.
        base_lat = existing_loc[0] if existing_loc else payload.latitude
        base_lng = existing_loc[1] if existing_loc else payload.longitude
        now_existing = datetime.now(timezone.utc).isoformat()

        nearest_hospital = await _find_nearest_hospital(base_lat, base_lng)
        preferred_hospital_id = (
            existing_hospital_id
            or (
                nearest_hospital["hospital_id"]
                if nearest_hospital and nearest_hospital.get("hospital_id")
                else None
            )
        )

        best_existing, reason_existing = await _find_and_reserve_best_ambulance(
            latitude=base_lat,
            longitude=base_lng,
            max_radius_km=payload.max_radius_km,
            preferred_hospital_id=preferred_hospital_id,
            emergency_id=existing_id,
        )

        if best_existing is None:
            _log_event(
                "dispatch_existing_no_candidate",
                emergency_id=existing_id,
                reason=reason_existing,
            )
            return EmergencyDispatchCreateResponse(
                emergency_id=existing_id,
                status="pending",
                hospital_id=preferred_hospital_id,
                assigned_ambulance_id=None,
                distance_to_ambulance_km=None,
                distance_to_hospital_km=(nearest_hospital["distance_km"] if nearest_hospital else existing_dist),
                eta_minutes=None,
                route_to_patient_url=None,
                route_to_hospital_url=None,
                reason=reason_existing,
            )

        assigned_hospital_id = best_existing.get("hospital_id") or preferred_hospital_id
        assigned_ambulance_id = str(best_existing["ambulance_id"])

        _, existing_update_code = await db_update(
            "emergency_requests",
            {"id": existing_id},
            {
                "assigned_ambulance_id": assigned_ambulance_id,
                "hospital_id": assigned_hospital_id,
                "status": "assigned",
                "updated_at": now_existing,
            },
        )
        if existing_update_code not in (200, 204):
            _log_event(
                "dispatch_existing_update_failed",
                emergency_id=existing_id,
                ambulance_id=assigned_ambulance_id,
                code=str(existing_update_code),
            )
            await db_update(
                "ambulances",
                {"id": assigned_ambulance_id},
                {"is_available": True, "updated_at": now_existing},
            )
            return EmergencyDispatchCreateResponse(
                emergency_id=existing_id,
                status="pending",
                hospital_id=preferred_hospital_id,
                assigned_ambulance_id=None,
                distance_to_ambulance_km=None,
                distance_to_hospital_km=(nearest_hospital["distance_km"] if nearest_hospital else existing_dist),
                eta_minutes=None,
                route_to_patient_url=None,
                route_to_hospital_url=None,
                reason="Dispatch candidate found; assignment update retrying",
            )

        assignment_ok = await _ensure_pending_assignment(
            emergency_id=existing_id,
            ambulance_id=assigned_ambulance_id,
            notes="Auto-dispatch for existing pending emergency",
        )
        if not assignment_ok:
            _log_event(
                "dispatch_existing_assignment_record_failed",
                emergency_id=existing_id,
                ambulance_id=assigned_ambulance_id,
            )
            await db_update(
                "ambulances",
                {"id": assigned_ambulance_id},
                {"is_available": True, "updated_at": now_existing},
            )
            await db_update(
                "emergency_requests",
                {"id": existing_id},
                {
                    "assigned_ambulance_id": None,
                    "status": "pending",
                    "updated_at": now_existing,
                },
            )
            return EmergencyDispatchCreateResponse(
                emergency_id=existing_id,
                status="pending",
                hospital_id=preferred_hospital_id,
                assigned_ambulance_id=None,
                distance_to_ambulance_km=None,
                distance_to_hospital_km=(nearest_hospital["distance_km"] if nearest_hospital else existing_dist),
                eta_minutes=None,
                route_to_patient_url=None,
                route_to_hospital_url=None,
                reason="Failed to create assignment record",
            )

        distance_to_ambulance_km = float(best_existing.get("distance_km") or 0)
        eta_minutes = max(2, round((distance_to_ambulance_km / 35.0) * 60 + 1))

        _log_event(
            "dispatch_existing_assigned",
            emergency_id=existing_id,
            ambulance_id=assigned_ambulance_id,
            distance_km=f"{distance_to_ambulance_km:.2f}",
        )

        return EmergencyDispatchCreateResponse(
            emergency_id=existing_id,
            status="assigned",
            hospital_id=(str(assigned_hospital_id) if assigned_hospital_id else None),
            assigned_ambulance_id=assigned_ambulance_id,
            distance_to_ambulance_km=round(distance_to_ambulance_km, 2),
            distance_to_hospital_km=(nearest_hospital["distance_km"] if nearest_hospital else existing_dist),
            eta_minutes=eta_minutes,
            route_to_patient_url=None,
            route_to_hospital_url=None,
            reason=reason_existing,
        )

    now = datetime.now(timezone.utc).isoformat()
    nearest_hospital = await _find_nearest_hospital(payload.latitude, payload.longitude)
    preferred_hospital_id = (
        nearest_hospital["hospital_id"]
        if nearest_hospital and nearest_hospital.get("hospital_id")
        else None
    )

    insert_payload = {
        "patient_id": user_id,
        "patient_location": _to_point_wkt(payload.latitude, payload.longitude),
        "emergency_type": payload.emergency_type,
        "description": payload.description,
        "hospital_id": preferred_hospital_id,
        "national_id": payload.national_id,
        "status": "pending",
        "created_at": now,
        "updated_at": now,
    }

    inserted, insert_code = await db_insert("emergency_requests", insert_payload)

    if insert_code not in (200, 201):
        fallback_payload = {k: v for k, v in insert_payload.items() if k != "national_id"}
        inserted, insert_code = await db_insert("emergency_requests", fallback_payload)

    if insert_code not in (200, 201) or not inserted:
        raise HTTPException(status_code=400, detail="Failed to create emergency request")

    row = inserted[0] if isinstance(inserted, list) else inserted
    emergency_id = str(row.get("id") or "")
    if not emergency_id:
        raise HTTPException(status_code=400, detail="Emergency request created without id")

    best, reason = await _find_and_reserve_best_ambulance(
        latitude=payload.latitude,
        longitude=payload.longitude,
        max_radius_km=payload.max_radius_km,
        preferred_hospital_id=preferred_hospital_id,
        emergency_id=emergency_id,
    )

    if best is None:
        _log_event(
            "dispatch_new_no_candidate",
            emergency_id=emergency_id,
            reason=reason or "no_reason",
        )
        return EmergencyDispatchCreateResponse(
            emergency_id=emergency_id,
            status="pending",
            hospital_id=preferred_hospital_id,
            assigned_ambulance_id=None,
            distance_to_ambulance_km=None,
            distance_to_hospital_km=(nearest_hospital["distance_km"] if nearest_hospital else None),
            eta_minutes=None,
            route_to_patient_url=None,
            route_to_hospital_url=None,
            reason=reason or "All ambulances are currently busy. Your emergency request has been saved ΓÇö an ambulance will be dispatched as soon as one becomes available. You can try again shortly.",
        )

    hospital_id = best.get("hospital_id") or preferred_hospital_id
    ambulance_id = str(best["ambulance_id"])

    _, update_code = await db_update(
        "emergency_requests",
        {"id": emergency_id},
        {
            "assigned_ambulance_id": ambulance_id,
            "hospital_id": hospital_id,
            "status": "assigned",
            "updated_at": now,
        },
    )
    if update_code not in (200, 204):
        _log_event(
            "dispatch_new_update_failed",
            emergency_id=emergency_id,
            ambulance_id=ambulance_id,
            code=str(update_code),
        )
        await db_update(
            "ambulances",
            {"id": ambulance_id},
            {"is_available": True, "updated_at": now},
        )
        raise HTTPException(status_code=400, detail="Emergency created but dispatch update failed")

    assignment_ok = await _ensure_pending_assignment(
        emergency_id=emergency_id,
        ambulance_id=ambulance_id,
        notes="Auto-dispatch from patient emergency request",
    )
    if not assignment_ok:
        _log_event(
            "dispatch_assignment_record_failed",
            emergency_id=emergency_id,
            ambulance_id=ambulance_id,
        )
        await db_update(
            "ambulances",
            {"id": ambulance_id},
            {"is_available": True, "updated_at": now},
        )
        await db_update(
            "emergency_requests",
            {"id": emergency_id},
            {
                "assigned_ambulance_id": None,
                "status": "pending",
                "updated_at": now,
            },
        )
        raise HTTPException(status_code=400, detail="Failed to create assignment record")

    amb_lat = best.get("ambulance_latitude")
    amb_lon = best.get("ambulance_longitude")
    hosp_lat = best.get("hospital_latitude")
    hosp_lon = best.get("hospital_longitude")
    if (hosp_lat is None or hosp_lon is None) and nearest_hospital:
        hosp_lat = nearest_hospital.get("latitude")
        hosp_lon = nearest_hospital.get("longitude")

    distance_to_ambulance_km = float(best.get("distance_km") or 0)
    eta_minutes = max(2, round((distance_to_ambulance_km / 35.0) * 60 + 1))

    _log_event(
        "dispatch_new_assigned",
        emergency_id=emergency_id,
        ambulance_id=ambulance_id,
        hospital_id=str(hospital_id or preferred_hospital_id or ""),
        distance_km=f"{distance_to_ambulance_km:.2f}",
    )

    # ΓöÇΓöÇ Best-effort push notification to driver ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
    try:
        driver_rows, _ = await db_query(
            "profiles",
            params={"ambulance_id": f"eq.{ambulance_id}", "limit": "1"},
        )
        if driver_rows:
            driver_user_id = str(driver_rows[0].get("id") or "")
            if driver_user_id:
                await _send_push_notification(
                    driver_user_id,
                    "≡ƒÜ¿ New Emergency Assignment",
                    f"You have been assigned to emergency {emergency_id[:8]}. Open the app to respond.",
                    {"type": "assignment", "emergency_id": emergency_id},
                )
    except Exception:
        pass  # push is best-effort

    return EmergencyDispatchCreateResponse(
        emergency_id=emergency_id,
        status="assigned",
        hospital_id=(str(hospital_id) if hospital_id else None),
        assigned_ambulance_id=ambulance_id,
        distance_to_ambulance_km=round(distance_to_ambulance_km, 2),
        distance_to_hospital_km=(nearest_hospital["distance_km"] if nearest_hospital else None),
        eta_minutes=eta_minutes,
        route_to_patient_url=(
            _gmaps_route_url(amb_lat, amb_lon, payload.latitude, payload.longitude)
            if isinstance(amb_lat, float) and isinstance(amb_lon, float)
            else None
        ),
        route_to_hospital_url=(
            _gmaps_route_url(payload.latitude, payload.longitude, hosp_lat, hosp_lon)
            if isinstance(hosp_lat, float) and isinstance(hosp_lon, float)
            else None
        ),
        reason=reason,
    )


@router.post(
    "/patient/emergencies/{emergency_id}/retry-dispatch",
    response_model=EmergencyDispatchCreateResponse,
    summary="Retry auto-dispatch for an existing active emergency",
)
async def retry_patient_emergency_dispatch(
    emergency_id: str,
    payload: EmergencyDispatchRetryRequest,
    current_user: dict = Depends(get_current_user),
) -> EmergencyDispatchCreateResponse:
    user_id = str(current_user.get("sub") or "")
    profile = await _require_role(user_id, current_user, ("patient", "admin"))

    rows, code = await db_select(
        "emergency_requests",
        {"id": emergency_id},
        columns="id,patient_id,patient_location,hospital_id,status,assigned_ambulance_id",
    )
    if code not in (200, 206) or not rows:
        raise HTTPException(status_code=404, detail="Emergency request not found")

    emergency = rows[0]
    owner_id = str(emergency.get("patient_id") or "")
    role = str(profile.get("role") or "")
    if role == "patient" and owner_id != user_id:
        raise HTTPException(status_code=403, detail="You can only retry your own emergency dispatch")

    status_value = str(emergency.get("status") or "pending")
    assigned_existing = str(emergency.get("assigned_ambulance_id") or "")
    location = _parse_point_wkt(emergency.get("patient_location"))
    if not location:
        raise HTTPException(status_code=400, detail="Emergency location is missing or invalid")

    latitude, longitude = location
    nearest_hospital = await _find_nearest_hospital(latitude, longitude)
    preferred_hospital_id = str(emergency.get("hospital_id") or "") or (
        str(nearest_hospital.get("hospital_id") or "") if nearest_hospital else ""
    )
    preferred_hospital_id = preferred_hospital_id or None

    if status_value in ("completed", "cancelled"):
        return EmergencyDispatchCreateResponse(
            emergency_id=emergency_id,
            status=status_value,
            hospital_id=(str(emergency.get("hospital_id")) if emergency.get("hospital_id") else None),
            assigned_ambulance_id=(assigned_existing or None),
            distance_to_ambulance_km=None,
            distance_to_hospital_km=(nearest_hospital["distance_km"] if nearest_hospital else None),
            eta_minutes=None,
            route_to_patient_url=None,
            route_to_hospital_url=None,
            reason="Emergency is already closed",
        )

    if assigned_existing and status_value in (
        "assigned",
        "en_route",
        "at_scene",
        "arrived",
        "transporting",
        "at_hospital",
    ):
        return EmergencyDispatchCreateResponse(
            emergency_id=emergency_id,
            status=status_value,
            hospital_id=(str(emergency.get("hospital_id")) if emergency.get("hospital_id") else None),
            assigned_ambulance_id=assigned_existing,
            distance_to_ambulance_km=None,
            distance_to_hospital_km=(nearest_hospital["distance_km"] if nearest_hospital else None),
            eta_minutes=None,
            route_to_patient_url=None,
            route_to_hospital_url=None,
            reason="Emergency is already assigned",
        )

    best, reason = await _find_and_reserve_best_ambulance(
        latitude=latitude,
        longitude=longitude,
        max_radius_km=payload.max_radius_km,
        preferred_hospital_id=preferred_hospital_id,
        emergency_id=emergency_id,
    )

    if best is None:
        _log_event(
            "dispatch_retry_no_candidate",
            emergency_id=emergency_id,
            reason=reason,
        )
        return EmergencyDispatchCreateResponse(
            emergency_id=emergency_id,
            status="pending",
            hospital_id=preferred_hospital_id,
            assigned_ambulance_id=None,
            distance_to_ambulance_km=None,
            distance_to_hospital_km=(nearest_hospital["distance_km"] if nearest_hospital else None),
            eta_minutes=None,
            route_to_patient_url=None,
            route_to_hospital_url=None,
            reason=reason,
        )

    now = datetime.now(timezone.utc).isoformat()
    hospital_id = best.get("hospital_id") or preferred_hospital_id
    ambulance_id = str(best["ambulance_id"])

    _, update_code = await db_update(
        "emergency_requests",
        {"id": emergency_id},
        {
            "assigned_ambulance_id": ambulance_id,
            "hospital_id": hospital_id,
            "status": "assigned",
            "updated_at": now,
        },
    )
    if update_code not in (200, 204):
        _log_event(
            "dispatch_retry_update_failed",
            emergency_id=emergency_id,
            ambulance_id=ambulance_id,
            code=str(update_code),
        )
        await db_update(
            "ambulances",
            {"id": ambulance_id},
            {"is_available": True, "updated_at": now},
        )
        return EmergencyDispatchCreateResponse(emergency_id=emergency_id, status="pending", hospital_id=preferred_hospital_id, assigned_ambulance_id=None, distance_to_ambulance_km=None, distance_to_hospital_km=(nearest_hospital["distance_km"] if nearest_hospital else None), eta_minutes=None, route_to_patient_url=None, route_to_hospital_url=None, reason="Dispatch candidate found; assignment update retrying")

    assignment_ok = await _ensure_pending_assignment(
        emergency_id=emergency_id,
        ambulance_id=ambulance_id,
        notes="Auto-dispatch retry for pending emergency",
    )
    if not assignment_ok:
        _log_event(
            "dispatch_retry_assignment_record_failed",
            emergency_id=emergency_id,
            ambulance_id=ambulance_id,
        )
        await db_update(
            "ambulances",
            {"id": ambulance_id},
            {"is_available": True, "updated_at": now},
        )
        await db_update(
            "emergency_requests",
            {"id": emergency_id},
            {
                "assigned_ambulance_id": None,
                "status": "pending",
                "updated_at": now,
            },
        )
        return EmergencyDispatchCreateResponse(emergency_id=emergency_id, status="pending", hospital_id=preferred_hospital_id, assigned_ambulance_id=None, distance_to_ambulance_km=None, distance_to_hospital_km=(nearest_hospital["distance_km"] if nearest_hospital else None), eta_minutes=None, route_to_patient_url=None, route_to_hospital_url=None, reason="Failed to create assignment record")

    amb_lat = best.get("ambulance_latitude")
    amb_lon = best.get("ambulance_longitude")
    hosp_lat = best.get("hospital_latitude")
    hosp_lon = best.get("hospital_longitude")
    if (hosp_lat is None or hosp_lon is None) and nearest_hospital:
        hosp_lat = nearest_hospital.get("latitude")
        hosp_lon = nearest_hospital.get("longitude")

    distance_to_ambulance_km = float(best.get("distance_km") or 0)
    eta_minutes = max(2, round((distance_to_ambulance_km / 35.0) * 60 + 1))

    _log_event(
        "dispatch_retry_assigned",
        emergency_id=emergency_id,
        ambulance_id=ambulance_id,
        distance_km=f"{distance_to_ambulance_km:.2f}",
    )

    return EmergencyDispatchCreateResponse(
        emergency_id=emergency_id,
        status="assigned",
        hospital_id=(str(hospital_id) if hospital_id else None),
        assigned_ambulance_id=ambulance_id,
        distance_to_ambulance_km=round(distance_to_ambulance_km, 2),
        distance_to_hospital_km=(nearest_hospital["distance_km"] if nearest_hospital else None),
        eta_minutes=eta_minutes,
        route_to_patient_url=(
            _gmaps_route_url(amb_lat, amb_lon, latitude, longitude)
            if isinstance(amb_lat, float) and isinstance(amb_lon, float)
            else None
        ),
        route_to_hospital_url=(
            _gmaps_route_url(latitude, longitude, hosp_lat, hosp_lon)
            if isinstance(hosp_lat, float) and isinstance(hosp_lon, float)
            else None
        ),
        reason=reason,
    )


@router.get(
    "/patient/emergencies/{emergency_id}/hospital-status",
    response_model=EmergencyHospitalStatusResponse,
    summary="Get hospital acceptance and ETA details for a patient emergency",
)
async def get_patient_emergency_hospital_status(
    emergency_id: str,
    current_user: dict = Depends(get_current_user),
) -> EmergencyHospitalStatusResponse:
    user_id = str(current_user.get("sub") or "")
    profile = await _require_role(user_id, current_user, ("patient", "admin", "hospital", "driver", "ambulance"))

    rows, code = await db_select(
        "emergency_requests",
        {"id": emergency_id},
        columns="id,patient_id,hospital_id,assigned_ambulance_id,patient_location,status",
    )
    if code not in (200, 206) or not rows:
        raise HTTPException(status_code=404, detail="Emergency request not found")

    emergency = rows[0]
    role = str(profile.get("role") or "")
    if role == "patient" and str(emergency.get("patient_id") or "") != user_id:
        raise HTTPException(status_code=403, detail="You can only view your own emergency")

    patient_loc = _parse_point_wkt(emergency.get("patient_location"))

    hospital_id = str(emergency.get("hospital_id") or "")
    if not hospital_id and patient_loc:
        # Resolve nearest hospital on-demand so patient UI always has a hospital candidate.
        nearest_any: dict | None = None
        all_hospitals, all_hospitals_code = await db_select(
            "hospitals",
            {},
            columns="id,name,is_accepting_emergencies,max_concurrent_emergencies,location,address",
        )
        if all_hospitals_code in (200, 206):
            for h in all_hospitals or []:
                parsed = _resolve_hospital_location(h)
                if not parsed:
                    continue
                dist = _distance_km(patient_loc[0], patient_loc[1], parsed[0], parsed[1])
                if nearest_any is None or dist < nearest_any["distance_km"]:
                    nearest_any = {
                        "hospital_id": str(h.get("id") or ""),
                        "distance_km": round(dist, 2),
                    }
        if nearest_any and nearest_any.get("hospital_id"):
            hospital_id = str(nearest_any["hospital_id"])
            # Best-effort persistence so next reads are consistent.
            await db_update(
                "emergency_requests",
                {"id": emergency_id},
                {
                    "hospital_id": hospital_id,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
            )

    if not hospital_id:
        return EmergencyHospitalStatusResponse(
            emergency_id=emergency_id,
            hospital_id=None,
            hospital_name=None,
            is_accepting_emergencies=None,
            active_emergencies=0,
            max_concurrent_emergencies=None,
            utilization=None,
            distance_to_hospital_km=None,
            eta_to_hospital_minutes=None,
            hospital_latitude=None,
            hospital_longitude=None,
            source="unassigned",
        )

    hosp_rows, hosp_code = await db_select(
        "hospitals",
        {"id": hospital_id},
        columns="id,name,is_accepting_emergencies,max_concurrent_emergencies,location,address",
    )
    if hosp_code not in (200, 206) or not hosp_rows:
        raise HTTPException(status_code=404, detail="Hospital linked to emergency was not found")

    hospital = hosp_rows[0]
    accepting_raw = hospital.get("is_accepting_emergencies")
    is_accepting = True if accepting_raw is None else bool(accepting_raw)
    max_concurrent = hospital.get("max_concurrent_emergencies")
    max_concurrent_int = int(max_concurrent) if max_concurrent is not None else None

    active_rows, active_code = await db_select(
        "emergency_requests",
        {"hospital_id": hospital_id},
        columns="status",
    )
    if active_code not in (200, 206):
        active_rows = []

    active_emergencies = sum(
        1 for row in (active_rows or []) if str(row.get("status") or "") not in ("completed", "cancelled")
    )
    utilization = None
    if max_concurrent_int and max_concurrent_int > 0:
        utilization = round(active_emergencies / max_concurrent_int, 2)

    hospital_loc = _resolve_hospital_location(hospital)

    # Backfill missing geometry for future dispatch quality.
    if not _parse_point_wkt(hospital.get("location")) and hospital_loc:
        await db_update(
            "hospitals",
            {"id": hospital_id},
            {
                "location": _to_point_wkt(hospital_loc[0], hospital_loc[1]),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )

    ref_lat = None
    ref_lon = None
    source = "patient"

    assigned_ambulance_id = str(emergency.get("assigned_ambulance_id") or "")
    if assigned_ambulance_id:
        amb_rows, amb_code = await db_select(
            "ambulances",
            {"id": assigned_ambulance_id},
            columns="last_known_location",
        )
        if amb_code in (200, 206) and amb_rows:
            amb_loc = _parse_point_wkt(amb_rows[0].get("last_known_location"))
            if amb_loc:
                ref_lat, ref_lon = amb_loc
                source = "ambulance"

    if ref_lat is None or ref_lon is None:
        if patient_loc:
            ref_lat, ref_lon = patient_loc

    distance_km = None
    eta_minutes = None
    if ref_lat is not None and ref_lon is not None and hospital_loc:
        hosp_lat, hosp_lon = hospital_loc
        distance_km = round(_distance_km(ref_lat, ref_lon, hosp_lat, hosp_lon), 2)
        eta_minutes = max(2, round((distance_km / 35.0) * 60 + 1))

    return EmergencyHospitalStatusResponse(
        emergency_id=emergency_id,
        hospital_id=hospital_id,
        hospital_name=str(hospital.get("name") or "Hospital"),
        is_accepting_emergencies=is_accepting,
        active_emergencies=active_emergencies,
        max_concurrent_emergencies=max_concurrent_int,
        utilization=utilization,
        distance_to_hospital_km=distance_km,
        eta_to_hospital_minutes=eta_minutes,
        hospital_latitude=(hospital_loc[0] if hospital_loc else None),
        hospital_longitude=(hospital_loc[1] if hospital_loc else None),
        source=source,
    )
# OPS_ENHANCEMENT_MARKER

# ---- Enhancement MVP Endpoints -------------------------------------------------

class TrafficAwareDispatchInput(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    max_radius_km: float = Field(default=60.0, ge=1.0, le=250.0)
    traffic_level: Literal["low", "moderate", "high", "severe"] = "moderate"


class ExplainableTriageInput(BaseModel):
    severity: Literal["low", "medium", "high", "critical"]
    age: int | None = Field(default=None, ge=0, le=120)
    conscious: bool = True
    breathing_difficulty: bool = False
    severe_bleeding: bool = False
    chest_pain: bool = False
    stroke_symptoms: bool = False
    trauma: bool = False


class TimelineEventInput(BaseModel):
    emergency_id: str = Field(min_length=8)
    event_type: str = Field(min_length=2, max_length=60)
    details: dict[str, Any] = Field(default_factory=dict)


class FamilyShareInput(BaseModel):
    emergency_id: str = Field(min_length=8)
    expires_minutes: int = Field(default=180, ge=10, le=1440)


class DriverSafetyInput(BaseModel):
    speed_kmh: float = Field(ge=0, le=250)
    harsh_brake_count: int = Field(default=0, ge=0, le=100)
    harsh_accel_count: int = Field(default=0, ge=0, le=100)
    hard_turn_count: int = Field(default=0, ge=0, le=100)


class GpsConfidenceInput(BaseModel):
    reported_latitude: float = Field(..., ge=-90, le=90)
    reported_longitude: float = Field(..., ge=-180, le=180)
    reference_latitude: float | None = Field(default=None, ge=-90, le=90)
    reference_longitude: float | None = Field(default=None, ge=-180, le=180)
    gps_age_seconds: int = Field(default=0, ge=0, le=36000)


class OfflineSyncItem(BaseModel):
    type: Literal["location_ping", "emergency_create", "status_update"]
    payload: dict[str, Any]
    queued_at: str | None = None


class OfflineSyncInput(BaseModel):
    items: list[OfflineSyncItem] = Field(default_factory=list, max_length=300)


@router.post("/dispatch/traffic-aware", summary="Traffic-aware ambulance recommendation (MVP)")
async def dispatch_traffic_aware(
    payload: TrafficAwareDispatchInput,
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("patient", "ambulance", "driver", "hospital", "admin"))

    best, reason = await _compute_dispatch_recommendation(
        payload.latitude,
        payload.longitude,
        payload.max_radius_km,
    )
    if not best:
        return {
            "ambulance_id": None,
            "hospital_id": None,
            "distance_km": None,
            "eta_minutes": None,
            "traffic_multiplier": 1.0,
            "confidence": 0.0,
            "reason": reason,
        }

    multiplier = {
        "low": 0.9,
        "moderate": 1.0,
        "high": 1.25,
        "severe": 1.5,
    }[payload.traffic_level]
    distance_km = float(best.get("distance_km") or 0)
    eta_minutes = int(max(2, round((distance_km / 42.0) * 60.0 * multiplier)))
    confidence = round(max(0.2, min(0.98, 1.0 - distance_km / max(payload.max_radius_km, 1.0))), 2)

    return {
        "ambulance_id": best.get("ambulance_id"),
        "hospital_id": best.get("hospital_id"),
        "distance_km": round(distance_km, 2),
        "eta_minutes": eta_minutes,
        "traffic_multiplier": multiplier,
        "confidence": confidence,
        "reason": "Best available unit with traffic-adjusted ETA",
    }


@router.post("/triage/explainable", summary="Explainable urgency triage scoring (MVP)")
async def triage_explainable(
    payload: ExplainableTriageInput,
    current_user: dict = Depends(get_current_user),
) -> dict:
    score = {"low": 15, "medium": 40, "high": 70, "critical": 90}[payload.severity]
    reasons: list[str] = [f"Base severity: {payload.severity}"]

    if not payload.conscious:
        score += 20
        reasons.append("Patient unconscious")
    if payload.breathing_difficulty:
        score += 15
        reasons.append("Breathing difficulty present")
    if payload.severe_bleeding:
        score += 15
        reasons.append("Severe bleeding detected")
    if payload.chest_pain:
        score += 12
        reasons.append("Chest pain symptoms")
    if payload.stroke_symptoms:
        score += 16
        reasons.append("Stroke-like symptoms")
    if payload.trauma:
        score += 10
        reasons.append("Trauma mechanism reported")
    if payload.age is not None and (payload.age >= 65 or payload.age <= 5):
        score += 6
        reasons.append("Age-based risk modifier")

    score = min(score, 100)
    priority = "P1" if score >= 85 else "P2" if score >= 65 else "P3" if score >= 35 else "P4"
    recommendation = {
        "P1": "Immediate dispatch, pre-alert nearest trauma-capable hospital.",
        "P2": "Urgent dispatch with high-priority lane guidance.",
        "P3": "Standard dispatch with symptom monitoring.",
        "P4": "Tele-advice first, dispatch if symptoms worsen.",
    }[priority]

    return {
        "priority": priority,
        "score": score,
        "recommendation": recommendation,
        "explainability": reasons,
    }


@router.post("/offline/sync", summary="Offline queue sync endpoint (MVP)")
async def offline_sync(
    payload: OfflineSyncInput,
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("patient", "ambulance", "driver", "hospital", "admin"))

    # Pre-fetch the ambulance assigned to this driver for ownership validation
    my_ambulance_rows, _ = await db_select("ambulances", {"current_driver_id": user_id})
    my_ambulance_ids = {str(a["id"]) for a in (my_ambulance_rows or [])}

    accepted = 0
    rejected = 0
    for item in payload.items:
        if item.type == "location_ping":
            ambulance_id = str(item.payload.get("ambulance_id") or "")
            lat = item.payload.get("latitude")
            lng = item.payload.get("longitude")
            if not ambulance_id or lat is None or lng is None:
                rejected += 1
                continue
            # Ownership check: only allow updating location for own ambulance
            if ambulance_id not in my_ambulance_ids:
                rejected += 1
                continue
            _, code = await db_update(
                "ambulances",
                {"id": ambulance_id},
                {
                    "last_known_location": _to_point_wkt(float(lat), float(lng)),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                },
            )
            if code in (200, 204):
                accepted += 1
            else:
                rejected += 1
        else:
            accepted += 1

    return {
        "accepted": accepted,
        "rejected": rejected,
        "server_received_at": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/timeline/events", summary="Append verifiable emergency timeline event (MVP)")
async def timeline_add_event(
    payload: TimelineEventInput,
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = str(current_user.get("sub") or "")
    me = await _require_role(user_id, current_user, ("ambulance", "driver", "hospital", "admin"))

    event = {
        "id": str(uuid4()),
        "emergency_id": payload.emergency_id,
        "event_type": payload.event_type,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "actor_role": str(me.get("role") or ""),
        "actor_id": user_id,
        "details": payload.details,
    }
    events = _TIMELINES.setdefault(payload.emergency_id, [])
    events.append(event)
    # Evict oldest events if this emergency exceeds the per-emergency cap
    if len(events) > _MAX_TIMELINE_EVENTS_PER:
        _TIMELINES[payload.emergency_id] = events[-_MAX_TIMELINE_EVENTS_PER:]
    # Evict oldest emergencies if total emergencies tracked exceeds global cap
    if len(_TIMELINES) > _MAX_TIMELINE_EMERGENCIES:
        oldest_keys = sorted(
            _TIMELINES.keys(),
            key=lambda k: _TIMELINES[k][0]["created_at"] if _TIMELINES[k] else "",
        )[: len(_TIMELINES) - _MAX_TIMELINE_EMERGENCIES]
        for k in oldest_keys:
            del _TIMELINES[k]
    _save_persisted()
    return event


@router.get("/timeline/events", summary="Get emergency timeline events (MVP)")
async def timeline_get_events(
    emergency_id: str = Query(..., min_length=8),
    current_user: dict = Depends(get_current_user),
) -> list[dict]:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("patient", "ambulance", "driver", "hospital", "admin"))
    return _TIMELINES.get(emergency_id, [])


@router.get("/capacity/hospitals", summary="Live hospital capacity board (MVP)")
async def hospital_capacity_board(current_user: dict = Depends(get_current_user)) -> dict:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("hospital", "admin"))

    hospitals, h_code = await db_query(
        "hospitals",
        columns="id,name,is_accepting_emergencies,max_concurrent_emergencies,icu_beds_available",
    )
    emergencies, e_code = await db_query(
        "emergency_requests",
        columns="hospital_id,status",
    )
    if h_code not in (200, 206) or e_code not in (200, 206):
        raise HTTPException(status_code=502, detail="Could not load capacity board")

    active_by_hospital: dict[str, int] = {}
    for row in emergencies:
        if str(row.get("status") or "") in ("completed", "cancelled"):
            continue
        hid = str(row.get("hospital_id") or "")
        if hid:
            active_by_hospital[hid] = active_by_hospital.get(hid, 0) + 1

    rows: list[dict] = []
    for h in hospitals:
        hid = str(h.get("id") or "")
        active = active_by_hospital.get(hid, 0)
        max_concurrent = int(h.get("max_concurrent_emergencies") or 10)
        rows.append(
            {
                "hospital_id": hid,
                "name": h.get("name"),
                "is_accepting_emergencies": h.get("is_accepting_emergencies", True),
                "active_emergencies": active,
                "max_concurrent_emergencies": max_concurrent,
                "utilization": round(min(1.5, active / max(max_concurrent, 1)), 2),
                "icu_beds_available": int(h.get("icu_beds_available") or 0),
            }
        )

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "hospitals": rows,
    }


@router.post("/family/share", summary="Create family/guardian tracking share token (MVP)")
async def family_share_create(
    payload: FamilyShareInput,
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = str(current_user.get("sub") or "")
    requester = await _require_role(user_id, current_user, ("patient", "ambulance", "driver", "hospital", "admin"))

    emergency_rows, emergency_code = await db_select(
        "emergency_requests",
        {"id": payload.emergency_id},
        columns="id,patient_id,status",
    )
    if emergency_code not in (200, 206) or not emergency_rows:
        raise HTTPException(status_code=404, detail="Emergency request not found")

    emergency = emergency_rows[0]
    requester_role = str(requester.get("role") or "").lower()
    if requester_role == "patient" and str(emergency.get("patient_id") or "") != user_id:
        raise HTTPException(status_code=403, detail="You can only share your own emergency request")

    if str(emergency.get("status") or "") in ("completed", "cancelled"):
        raise HTTPException(status_code=409, detail="Cannot create a share link for a closed emergency")

    token = str(uuid4()).replace("-", "")
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=payload.expires_minutes)
    # Evict expired share links when approaching the cap
    if len(_SHARE_LINKS) >= _MAX_SHARE_LINKS:
        now_iso = datetime.now(timezone.utc).isoformat()
        expired = [k for k, v in _SHARE_LINKS.items() if v.get("expires_at", "") < now_iso]
        for k in expired:
            del _SHARE_LINKS[k]
    _SHARE_LINKS[token] = {
        "emergency_id": payload.emergency_id,
        "expires_at": expires_at.isoformat(),
    }
    _save_persisted()
    return {
        "share_token": token,
        "emergency_id": payload.emergency_id,
        "expires_at": expires_at.isoformat(),
    }


@router.get("/family/share", summary="Resolve family/guardian share token (MVP)")
async def family_share_resolve(share_token: str = Query(..., min_length=16)) -> dict:
    row = _SHARE_LINKS.get(share_token)
    if not row:
        raise HTTPException(status_code=404, detail="Invalid share token")
    expires = _parse_iso(str(row.get("expires_at") or ""))
    if not expires or expires < datetime.now(timezone.utc):
        raise HTTPException(status_code=410, detail="Share token expired")
    return {
        "share_token": share_token,
        "emergency_id": row.get("emergency_id"),
        "expires_at": row.get("expires_at"),
    }


async def _build_family_share_live_payload(share_token: str) -> dict:
        row = _SHARE_LINKS.get(share_token)
        if not row:
                raise HTTPException(status_code=404, detail="Invalid share token")

        expires = _parse_iso(str(row.get("expires_at") or ""))
        if not expires or expires < datetime.now(timezone.utc):
                raise HTTPException(status_code=410, detail="Share token expired")

        emergency_id = str(row.get("emergency_id") or "")
        emerg_rows, emerg_code = await db_select(
                "emergency_requests",
                {"id": emergency_id},
            columns="id,status,emergency_type,updated_at,hospital_id,assigned_ambulance_id,patient_location",
        )
        if emerg_code not in (200, 206) or not emerg_rows:
                raise HTTPException(status_code=404, detail="Emergency not found")

        emergency = emerg_rows[0]
        hospital_id = str(emergency.get("hospital_id") or "")
        hospital_name = None
        hospital_accepting = None
        distance_hospital_km = None

        hospital_loc = None
        if hospital_id:
                hosp_rows, hosp_code = await db_select(
                        "hospitals",
                        {"id": hospital_id},
                        columns="name,is_accepting_emergencies,location",
                )
                if hosp_code in (200, 206) and hosp_rows:
                        hospital = hosp_rows[0]
                        hospital_name = hospital.get("name")
                        hospital_accepting = bool(hospital.get("is_accepting_emergencies", True))
                        hospital_loc = _parse_point_wkt(hospital.get("location"))

        ambulance_vehicle = None
        distance_patient_km = None
        eta_minutes = None
        ambulance_loc = None
        route_to_patient_url = None
        route_to_hospital_url = None

        assigned_ambulance_id = str(emergency.get("assigned_ambulance_id") or "")
        if assigned_ambulance_id:
                amb_rows, amb_code = await db_select(
                        "ambulances",
                        {"id": assigned_ambulance_id},
                        columns="vehicle_number,last_known_location",
                )
                if amb_code in (200, 206) and amb_rows:
                        ambulance_vehicle = amb_rows[0].get("vehicle_number")
                        ambulance_loc = _parse_point_wkt(amb_rows[0].get("last_known_location"))

        patient_loc = _parse_point_wkt(emergency.get("patient_location"))
        if ambulance_loc and patient_loc:
                distance_patient_km = round(
                        _distance_km(ambulance_loc[0], ambulance_loc[1], patient_loc[0], patient_loc[1]),
                        2,
                )
                eta_minutes = max(2, round((distance_patient_km / 35.0) * 60 + 1))
                route_to_patient_url = _gmaps_route_url(
                        ambulance_loc[0], ambulance_loc[1], patient_loc[0], patient_loc[1]
                )

        if hospital_loc and patient_loc:
                distance_hospital_km = round(
                        _distance_km(patient_loc[0], patient_loc[1], hospital_loc[0], hospital_loc[1]),
                        2,
                )
                route_to_hospital_url = _gmaps_route_url(
                        patient_loc[0], patient_loc[1], hospital_loc[0], hospital_loc[1]
                )

        return {
                "share_token": share_token,
                "emergency_id": emergency_id,
                "status": emergency.get("status") or "pending",
                "emergency_type": emergency.get("emergency_type") or "medical",
                "updated_at": emergency.get("updated_at"),
                "hospital_name": hospital_name,
                "hospital_accepting": hospital_accepting,
                "ambulance_vehicle": ambulance_vehicle,
                "distance_to_patient_km": distance_patient_km,
                "distance_to_hospital_km": distance_hospital_km,
                "eta_minutes": eta_minutes,
                "expires_at": row.get("expires_at"),
                "patient_latitude": patient_loc[0] if patient_loc else None,
                "patient_longitude": patient_loc[1] if patient_loc else None,
                "ambulance_latitude": ambulance_loc[0] if ambulance_loc else None,
                "ambulance_longitude": ambulance_loc[1] if ambulance_loc else None,
                "hospital_latitude": hospital_loc[0] if hospital_loc else None,
                "hospital_longitude": hospital_loc[1] if hospital_loc else None,
                "route_to_patient_url": route_to_patient_url,
                "route_to_hospital_url": route_to_hospital_url,
        }


def _render_family_share_error_html(title: str, message: str) -> str:
        return f"""<!doctype html>
<html lang=\"en\">
<head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>Erdataye Family Tracking</title>
    <style>
        body {{ margin: 0; font-family: Inter, Segoe UI, sans-serif; background: #f4f8fb; color: #102233; }}
        .wrap {{ min-height: 100vh; display: grid; place-items: center; padding: 20px; }}
        .card {{ max-width: 560px; width: 100%; border: 1px solid #d9e7ef; border-radius: 16px; background: #fff; box-shadow: 0 14px 30px rgba(16, 36, 52, 0.12); padding: 22px; }}
        h1 {{ margin: 0; font-size: 1.5rem; }}
        p {{ margin: 12px 0 0; color: #4f6778; line-height: 1.55; }}
    </style>
</head>
<body>
    <main class=\"wrap\">
        <section class=\"card\">
            <h1>{title}</h1>
            <p>{message}</p>
        </section>
    </main>
</body>
</html>"""


def _render_family_share_live_html(payload: dict) -> str:
        data_json = _json.dumps(payload).replace("</", "<\\/")
        html = """<!doctype html>
<html lang=\"en\">
<head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>Erdataye Family Live Tracking</title>
    <link rel=\"preconnect\" href=\"https://fonts.googleapis.com\" />
    <link rel=\"preconnect\" href=\"https://fonts.gstatic.com\" crossorigin />
    <link href=\"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap\" rel=\"stylesheet\" />
    <link rel=\"stylesheet\" href=\"https://unpkg.com/leaflet@1.9.4/dist/leaflet.css\" crossorigin=\"\" />
    <style>
        :root {
            --bg: #f2f7fb;
            --surface: #ffffff;
            --ink: #0d1723;
            --muted: #557082;
            --line: #d8e7ef;
            --brand: #c3272f;
            --ok: #0f766e;
            --warn: #b45309;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            font-family: Inter, Segoe UI, sans-serif;
            color: var(--ink);
            background:
                radial-gradient(720px 260px at 95% -5%, #fee4e7 0%, transparent 60%),
                radial-gradient(720px 260px at -5% 15%, #dff2f2 0%, transparent 62%),
                var(--bg);
        }
        .container {
            width: min(1080px, 94vw);
            margin: 0 auto;
            padding: 18px 0 24px;
        }
        .top {
            display: flex;
            flex-wrap: wrap;
            gap: 12px;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
        }
        h1 {
            margin: 0;
            font-size: clamp(1.25rem, 3vw, 1.9rem);
        }
        .status-pill {
            border-radius: 999px;
            padding: 7px 12px;
            font-size: 0.8rem;
            font-weight: 800;
            letter-spacing: 0.06em;
            text-transform: uppercase;
            background: #e6f4f1;
            color: var(--ok);
            border: 1px solid #cde7df;
        }
        .grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 10px;
            margin-bottom: 12px;
        }
        .kpi {
            background: var(--surface);
            border: 1px solid var(--line);
            border-radius: 14px;
            padding: 12px;
            box-shadow: 0 8px 20px rgba(20, 41, 56, 0.07);
        }
        .kpi .label { color: #698293; font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
        .kpi .value { margin-top: 6px; font-size: 1.1rem; font-weight: 800; }
        .panel {
            border: 1px solid var(--line);
            border-radius: 16px;
            background: var(--surface);
            overflow: hidden;
            box-shadow: 0 10px 24px rgba(16, 38, 52, 0.08);
        }
        #map {
            height: min(58vh, 520px);
            min-height: 340px;
            width: 100%;
            background: #eef5fa;
        }
        .legend {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            padding: 10px 12px;
            border-top: 1px solid var(--line);
            background: #fcfeff;
            color: #4c6678;
            font-size: 0.86rem;
            font-weight: 600;
        }
        .dot { width: 10px; height: 10px; border-radius: 999px; display: inline-block; margin-right: 6px; }
    </style>
</head>
<body>
    <main class=\"container\">
        <section class=\"top\">
            <div>
                <h1>Family Live Emergency Tracking</h1>
            </div>
            <div class=\"status-pill\" id=\"statusPill\">Status</div>
        </section>

        <section class=\"grid\">
            <article class=\"kpi\"><div class=\"label\">Emergency Type</div><div class=\"value\" id=\"emType\">-</div></article>
            <article class=\"kpi\"><div class=\"label\">Ambulance</div><div class=\"value\" id=\"ambVehicle\">-</div></article>
            <article class=\"kpi\"><div class=\"label\">ETA To Patient</div><div class=\"value\" id=\"eta\">-</div></article>
            <article class=\"kpi\"><div class=\"label\">To Patient</div><div class=\"value\" id=\"distPatient\">-</div></article>
            <article class=\"kpi\"><div class=\"label\">To Hospital</div><div class=\"value\" id=\"distHospital\">-</div></article>
            <article class=\"kpi\"><div class=\"label\">Hospital</div><div class=\"value\" id=\"hospital\">-</div></article>
        </section>

        <section class=\"panel\">
            <div id=\"map\"></div>
            <div class=\"legend\">
                <span><span class=\"dot\" style=\"background:#c3272f\"></span>Patient</span>
                <span><span class=\"dot\" style=\"background:#0f766e\"></span>Ambulance</span>
                <span><span class=\"dot\" style=\"background:#1d4ed8\"></span>Hospital</span>
                <span id=\"lastUpdated\">Updating...</span>
            </div>
        </section>
    </main>

    <script src=\"https://unpkg.com/leaflet@1.9.4/dist/leaflet.js\" crossorigin=\"\"></script>
    <script>
        const initialData = __DATA_JSON__;
        const statusPill = document.getElementById("statusPill");
        const emType = document.getElementById("emType");
        const ambVehicle = document.getElementById("ambVehicle");
        const eta = document.getElementById("eta");
        const distPatient = document.getElementById("distPatient");
        const distHospital = document.getElementById("distHospital");
        const hospital = document.getElementById("hospital");
        const lastUpdated = document.getElementById("lastUpdated");

        const statusMap = {
            pending: { label: "Pending", bg: "#fff5e8", color: "#b45309", border: "#f4dcb7" },
            assigned: { label: "Assigned", bg: "#e6f4f1", color: "#0f766e", border: "#cce7df" },
            en_route: { label: "En Route", bg: "#e8f0fe", color: "#1e40af", border: "#ceddff" },
            at_scene: { label: "At Scene", bg: "#eef2ff", color: "#4338ca", border: "#dce2ff" },
            transporting: { label: "Transporting", bg: "#ecfdf5", color: "#047857", border: "#c8eedc" },
            at_hospital: { label: "At Hospital", bg: "#f0fdfa", color: "#0f766e", border: "#cdeee8" },
            completed: { label: "Completed", bg: "#ecfdf3", color: "#166534", border: "#c8eccf" },
            cancelled: { label: "Cancelled", bg: "#fff1f2", color: "#9f1239", border: "#f6d4db" }
        };

        const toPoint = (lat, lon) => {
            const la = Number(lat);
            const lo = Number(lon);
            if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
            return [la, lo];
        };

        const formatKm = (value) => {
            const n = Number(value);
            return Number.isFinite(n) ? `${n.toFixed(2)} km` : "-";
        };

        const formatDate = (value) => {
            if (!value) return "-";
            const d = new Date(value);
            return Number.isFinite(d.getTime()) ? d.toLocaleString() : "-";
        };

        const isPoint = (point) => Array.isArray(point) && point.length === 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]);

        const fetchRoadRoute = async (from, to) => {
            if (!isPoint(from) || !isPoint(to)) return null;
            try {
                const path = `${from[1]},${from[0]};${to[1]},${to[0]}`;
                const query = "overview=full&geometries=geojson";
                const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${path}?${query}`, { cache: "no-store" });
                if (!response.ok) return null;
                const data = await response.json();
                const coords = data?.routes?.[0]?.geometry?.coordinates;
                if (!Array.isArray(coords) || coords.length < 2) return null;
                const mapped = coords
                    .map((entry) => [Number(entry?.[1]), Number(entry?.[0])])
                    .filter((entry) => isPoint(entry));
                return mapped.length >= 2 ? mapped : null;
            } catch {
                return null;
            }
        };

        let map = null;
        let mapLayer = null;

        const initMap = () => {
            if (!window.L) {
                const mapEl = document.getElementById("map");
                mapEl.innerHTML = "<div style='padding:16px;color:#5f7383'>Map failed to load.</div>";
                return;
            }
            map = window.L.map("map", { zoomControl: true, scrollWheelZoom: true });
            window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                maxZoom: 19,
                attribution: "&copy; OpenStreetMap contributors"
            }).addTo(map);
            mapLayer = window.L.layerGroup().addTo(map);
            map.setView([9.03, 38.74], 11);
            setTimeout(() => map.invalidateSize(), 100);
        };

        const renderMap = async (data) => {
            if (!map || !mapLayer) return;
            mapLayer.clearLayers();

            const patient = toPoint(data.patient_latitude, data.patient_longitude);
            const ambulance = toPoint(data.ambulance_latitude, data.ambulance_longitude);
            const hospitalPoint = toPoint(data.hospital_latitude, data.hospital_longitude);
            const points = [];

            if (patient) {
                window.L.circleMarker(patient, { radius: 8, color: "#c3272f", fillColor: "#c3272f", fillOpacity: 0.9 }).addTo(mapLayer).bindPopup("Patient");
                points.push(patient);
            }
            if (ambulance) {
                window.L.circleMarker(ambulance, { radius: 8, color: "#0f766e", fillColor: "#0f766e", fillOpacity: 0.9 }).addTo(mapLayer).bindPopup("Ambulance");
                points.push(ambulance);
            }
            if (hospitalPoint) {
                window.L.circleMarker(hospitalPoint, { radius: 8, color: "#1d4ed8", fillColor: "#1d4ed8", fillOpacity: 0.9 }).addTo(mapLayer).bindPopup("Hospital");
                points.push(hospitalPoint);
            }

            const [routeToPatient, routeToHospital] = await Promise.all([
                ambulance && patient ? fetchRoadRoute(ambulance, patient) : Promise.resolve(null),
                patient && hospitalPoint ? fetchRoadRoute(patient, hospitalPoint) : Promise.resolve(null),
            ]);

            if (routeToPatient) {
                window.L.polyline(routeToPatient, { color: "#0f766e", weight: 5, opacity: 0.8 }).addTo(mapLayer);
            } else if (ambulance && patient) {
                window.L.polyline([ambulance, patient], { color: "#0f766e", weight: 4, opacity: 0.75 }).addTo(mapLayer);
            }
            if (routeToHospital) {
                window.L.polyline(routeToHospital, { color: "#1d4ed8", weight: 5, opacity: 0.78, dashArray: "10 6" }).addTo(mapLayer);
            } else if (patient && hospitalPoint) {
                window.L.polyline([patient, hospitalPoint], { color: "#1d4ed8", weight: 4, opacity: 0.72, dashArray: "10 6" }).addTo(mapLayer);
            }

            const bounds = mapLayer.getBounds();
            if (bounds && bounds.isValid()) {
                map.fitBounds(bounds, { padding: [26, 26], maxZoom: 16 });
            } else if (points.length > 0) {
                map.fitBounds(window.L.latLngBounds(points), { padding: [26, 26], maxZoom: 15 });
            }
        };

        const render = (data) => {
            const statusKey = String(data.status || "pending").toLowerCase();
            const status = statusMap[statusKey] || statusMap.pending;

            statusPill.textContent = status.label;
            statusPill.style.background = status.bg;
            statusPill.style.color = status.color;
            statusPill.style.borderColor = status.border;

            emType.textContent = String(data.emergency_type || "-").replaceAll("_", " ");
            ambVehicle.textContent = data.ambulance_vehicle || "Not assigned";
            eta.textContent = Number.isFinite(Number(data.eta_minutes)) ? `${Math.round(Number(data.eta_minutes))} min` : "-";
            distPatient.textContent = formatKm(data.distance_to_patient_km);
            distHospital.textContent = formatKm(data.distance_to_hospital_km);
            hospital.textContent = data.hospital_name || "Pending";
            lastUpdated.textContent = `Auto refresh every 25s | ${new Date().toLocaleTimeString()}`;
            void renderMap(data);
        };

        const fetchLatest = async () => {
            try {
                const params = new URLSearchParams({ share_token: initialData.share_token, format: "json" });
                const response = await fetch(`${window.location.pathname}?${params.toString()}`, { cache: "no-store" });
                if (!response.ok) return;
                const json = await response.json();
                render(json);
            } catch {
            }
        };

        initMap();
        render(initialData);
        setInterval(fetchLatest, 25000);
    </script>
</body>
</html>"""
        return html.replace("__DATA_JSON__", data_json)


@router.get(
    "/family/share/live",
    summary="Public live emergency status for family share links",
    response_model=None,
)
async def family_share_live(
        share_token: str = Query(..., min_length=16),
        format: Literal["ui", "json"] = Query("ui"),
) -> Any:
        try:
                payload = await _build_family_share_live_payload(share_token)
        except HTTPException as exc:
                if format == "json":
                        raise

                title = "Share link unavailable"
                if exc.status_code == 410:
                        title = "Share link expired"
                return HTMLResponse(
                        content=_render_family_share_error_html(title=title, message=str(exc.detail)),
                        status_code=exc.status_code,
                )

        if format == "json":
                return payload
        return HTMLResponse(content=_render_family_share_live_html(payload), status_code=200)


@router.post("/driver/safety", summary="Driver safety coaching score (MVP)")
async def driver_safety_score(
    payload: DriverSafetyInput,
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("ambulance", "driver", "admin"))

    score = 100.0
    score -= max(0.0, payload.speed_kmh - 70.0) * 0.35
    score -= payload.harsh_brake_count * 1.8
    score -= payload.harsh_accel_count * 1.2
    score -= payload.hard_turn_count * 1.0
    score = max(0.0, min(100.0, score))

    if score >= 85:
        risk_level = "low"
        coaching_tip = "Great control. Keep speed smooth and scan intersections early."
    elif score >= 65:
        risk_level = "moderate"
        coaching_tip = "Reduce harsh inputs and maintain larger following distance."
    else:
        risk_level = "high"
        coaching_tip = "Slow down, avoid abrupt maneuvers, and choose safer route options."

    return {
        "safety_score": round(score, 1),
        "risk_level": risk_level,
        "coaching_tip": coaching_tip,
    }


@router.post("/trust/gps-confidence", summary="GPS trust and spoofing risk signal (MVP)")
async def gps_confidence(payload: GpsConfidenceInput) -> dict:
    confidence = 1.0
    flags: list[str] = []

    if payload.gps_age_seconds > 180:
        flags.append("stale_gps")
        confidence -= 0.35
    if payload.gps_age_seconds > 600:
        flags.append("very_stale_gps")
        confidence -= 0.25

    if payload.reference_latitude is not None and payload.reference_longitude is not None:
        jump_km = _distance_km(
            payload.reported_latitude,
            payload.reported_longitude,
            payload.reference_latitude,
            payload.reference_longitude,
        )
        if jump_km > 2.0:
            flags.append("large_position_jump")
            confidence -= 0.25
        if jump_km > 10.0:
            flags.append("possible_spoof_or_vpn")
            confidence -= 0.25

    confidence = max(0.0, min(1.0, confidence))
    return {
        "confidence_score": round(confidence, 2),
        "flags": flags,
        "recommendation": (
            "Use location for nearest-unit routing"
            if confidence >= 0.65
            else "Refresh location before nearest-unit dispatch"
        ),
    }


@router.get("/insights/operations", summary="Operational insights dashboard payload (MVP)")
async def insights_operations(
    days: int = Query(default=7, ge=1, le=60),
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("admin",))

    emergencies, code = await db_query(
        "emergency_requests",
        columns="id,status,created_at,updated_at,emergency_type,hospital_id",
        params={"order": "created_at.desc"},
    )
    if code not in (200, 206):
        raise HTTPException(status_code=502, detail="Could not load insights")

    since = datetime.now(timezone.utc) - timedelta(days=days)
    in_window: list[dict] = []
    for row in emergencies:
        created = _parse_iso(str(row.get("created_at") or ""))
        if created and created >= since:
            in_window.append(row)

    status_breakdown: dict[str, int] = {}
    type_breakdown: dict[str, int] = {}
    daily_volume: dict[str, int] = {}
    completion_minutes: list[float] = []

    for row in in_window:
        status_key = str(row.get("status") or "unknown")
        type_key = str(row.get("emergency_type") or "medical")
        status_breakdown[status_key] = status_breakdown.get(status_key, 0) + 1
        type_breakdown[type_key] = type_breakdown.get(type_key, 0) + 1

        created = _parse_iso(str(row.get("created_at") or ""))
        updated = _parse_iso(str(row.get("updated_at") or ""))
        if created:
            day_key = created.date().isoformat()
            daily_volume[day_key] = daily_volume.get(day_key, 0) + 1
        if status_key == "completed" and created and updated and updated >= created:
            completion_minutes.append((updated - created).total_seconds() / 60.0)

    avg_completion = round(sum(completion_minutes) / len(completion_minutes), 2) if completion_minutes else None
    return {
        "window_days": days,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "emergencies_total": len(in_window),
        "status_breakdown": status_breakdown,
        "type_breakdown": type_breakdown,
        "daily_volume": dict(sorted(daily_volume.items(), key=lambda item: item[0])),
        "avg_completion_minutes": avg_completion,
    }


@router.get("/first-aid/contextual", summary="Context-aware first-aid guidance (MVP)")
async def contextual_first_aid(
    symptom: str = Query(..., min_length=2, max_length=120),
    language: Literal["en", "am"] = Query(default="en"),
) -> dict:
    low = symptom.lower()
    if "bleed" in low or "blood" in low:
        steps = [
            "Apply direct pressure with a clean cloth.",
            "Elevate the injured area if possible.",
            "Do not remove deeply embedded objects.",
            "Monitor breathing until ambulance arrives.",
        ]
    else:
        steps = [
            "Keep the patient calm and seated safely.",
            "Check breathing and consciousness every minute.",
            "Avoid food/drink if severe symptoms are present.",
            "Share exact location and landmarks with dispatcher.",
        ]

    if language == "am":
        # English fallback text until dedicated localized corpus is integrated.
        return {
            "symptom": symptom,
            "language": language,
            "steps": steps,
            "version": "contextual-first-aid-v1",
            "note": "Localized medical corpus is pending; using safe fallback guidance.",
        }

    return {
        "symptom": symptom,
        "language": language,
        "steps": steps,
        "version": "contextual-first-aid-v1",
    }


# ΓöÇΓöÇ Patient emergency read/write endpoints (service-role, RLS-bypassed) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

@router.get("/patient/emergencies/active", summary="Get patient's current active emergency")
async def get_patient_active_emergency(
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("patient", "admin"))

    rows, code = await db_query(
        "emergency_requests",
        columns="*",
        params={
            "patient_id": f"eq.{user_id}",
            "status": "not.in.(completed,cancelled)",
            "order": "created_at.desc",
            "limit": "1",
        },
    )
    if code not in (200, 206):
        raise HTTPException(status_code=502, detail="Could not load active emergency")

    return {"emergency": rows[0] if rows else None}


@router.get("/patient/emergencies/{emergency_id}/detail", summary="Get full emergency details + assignment + ambulance")
async def get_patient_emergency_detail(
    emergency_id: str,
    current_user: dict = Depends(get_current_user),
) -> dict:
    import asyncio
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("patient", "admin", "ambulance", "driver", "hospital"))

    # Parallel: fetch emergency + assignment at the same time
    eme_task = asyncio.create_task(db_select("emergency_requests", {"id": emergency_id}, columns="*"))
    assign_task = asyncio.create_task(db_query(
        "emergency_assignments",
        columns="*",
        params={"emergency_id": f"eq.{emergency_id}", "order": "assigned_at.desc", "limit": "1"},
    ))

    rows, code = await eme_task
    if code not in (200, 206) or not rows:
        raise HTTPException(status_code=404, detail="Emergency not found")
    emergency = rows[0]

    assign_rows, _ = await assign_task
    assignment = assign_rows[0] if assign_rows else None

    # Ambulance + driver phone
    ambulance = None
    ambulance_id = str(
        (assignment.get("ambulance_id") if assignment else None)
        or emergency.get("assigned_ambulance_id") or ""
    )
    if ambulance_id:
        amb_rows, _ = await db_select("ambulances", {"id": ambulance_id}, columns="*")
        if amb_rows:
            ambulance = dict(amb_rows[0])
            # Resolve driver phone from profiles if missing
            resolved_phone = (
                (assignment or {}).get("driver_phone")
                or (assignment or {}).get("driver_contact")
                or ambulance.get("driver_phone")
                or ambulance.get("phone_number")
                or ambulance.get("phone")
            )
            if not resolved_phone:
                candidate_ids = list(filter(None, [
                    str(ambulance.get("current_driver_id") or ""),
                    str(ambulance.get("driver_id") or ""),
                    str(ambulance.get("user_id") or ""),
                ]))
                if candidate_ids:
                    ids_csv = ",".join(candidate_ids)
                    p_rows, p_code = await db_query(
                        "profiles",
                        columns="id,phone",
                        params={"id": f"in.({ids_csv})"},
                    )
                    if p_code in (200, 206) and p_rows:
                        phones_by_id = {
                            str(row.get("id") or ""): row.get("phone")
                            for row in p_rows
                        }
                        for cid in candidate_ids:
                            phone = phones_by_id.get(cid)
                            if phone:
                                resolved_phone = str(phone)
                                break
            if resolved_phone:
                ambulance["driver_phone"] = resolved_phone

    return {"emergency": emergency, "assignment": assignment, "ambulance": ambulance}


@router.patch(
    "/patient/emergencies/{emergency_id}/patient-location",
    summary="Update patient live GPS location on an active emergency",
)
async def update_patient_live_location(
    emergency_id: str,
    body: dict,
    current_user: dict = Depends(get_current_user),
) -> dict:
    uid = str(current_user.get("sub") or "")
    lat = body.get("latitude")
    lng = body.get("longitude")
    if lat is None or lng is None:
        raise HTTPException(status_code=400, detail="latitude and longitude required")
    # Verify the patient owns this emergency
    rows, code = await db_select("emergency_requests", {"id": emergency_id}, columns="id,patient_id,status")
    if code not in (200, 206) or not rows:
        raise HTTPException(status_code=404, detail="Emergency not found")
    if str(rows[0].get("patient_id") or "") != uid:
        raise HTTPException(status_code=403, detail="Not authorised for this emergency")
    if rows[0].get("status") in ("completed", "cancelled"):
        return {"success": False, "reason": "Emergency is no longer active"}
    point = _to_point_wkt(lat, lng)
    now = datetime.now(timezone.utc).isoformat()
    await db_update("emergency_requests", {"id": emergency_id}, {"patient_location": point, "updated_at": now})
    return {"success": True}


@router.patch(
    "/patient/emergencies/{emergency_id}/status",
    summary="Update emergency status (patient cancel / status update)",
)
async def update_patient_emergency_status(
    emergency_id: str,
    body: dict,
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = str(current_user.get("sub") or "")
    profile = await _require_role(
        user_id,
        current_user,
        ("patient", "admin", "ambulance", "driver"),
    )
    role = str(profile.get("role") or "").lower()

    new_status = str(body.get("status") or "")
    allowed_statuses = ("pending", "assigned", "en_route", "at_scene", "arrived",
                        "transporting", "at_hospital", "completed", "cancelled")
    if new_status not in allowed_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status: {new_status}")

    rows, code = await db_select(
        "emergency_requests",
        {"id": emergency_id},
        columns="id,patient_id,status,assigned_ambulance_id",
    )
    if code not in (200, 206) or not rows:
        raise HTTPException(status_code=404, detail="Emergency not found")

    emergency = rows[0]
    current_status = str(emergency.get("status") or "")

    if role == "patient":
        if str(emergency.get("patient_id") or "") != user_id:
            raise HTTPException(status_code=403, detail="Not authorised for this emergency")
        if new_status != "cancelled":
            raise HTTPException(
                status_code=403,
                detail="Patient can only cancel the request.",
            )
        if current_status not in ("pending", "assigned"):
            raise HTTPException(
                status_code=409,
                detail="Cancellation is allowed only before ambulance response progresses.",
            )

    elif role in ("driver", "ambulance"):
        if new_status not in ("en_route", "at_scene", "arrived", "transporting"):
            raise HTTPException(
                status_code=403,
                detail="Ambulance can only update en_route, at_scene/arrived, and transporting.",
            )

        amb_rows, amb_code = await db_select("ambulances", {"current_driver_id": user_id}, columns="id")
        if amb_code not in (200, 206) or not amb_rows:
            raise HTTPException(status_code=403, detail="No ambulance linked to this driver account")

        my_ambulance_id = str(amb_rows[0].get("id") or "")
        assigned_ambulance_id = str(emergency.get("assigned_ambulance_id") or "")

        is_assigned_to_me = assigned_ambulance_id == my_ambulance_id if assigned_ambulance_id else False
        if not is_assigned_to_me:
            assign_rows, assign_code = await db_query(
                "emergency_assignments",
                columns="ambulance_id,status",
                params={
                    "emergency_id": f"eq.{emergency_id}",
                    "ambulance_id": f"eq.{my_ambulance_id}",
                    "status": "in.(pending,accepted)",
                    "limit": "1",
                },
            )
            is_assigned_to_me = assign_code in (200, 206) and bool(assign_rows)

        if not is_assigned_to_me:
            raise HTTPException(status_code=403, detail="Emergency is assigned to a different ambulance")

        allowed_next: dict[str, set[str]] = {
            "assigned": {"en_route"},
            "en_route": {"at_scene", "arrived"},
            "at_scene": {"transporting"},
            "arrived": {"transporting"},
            "transporting": set(),
            "at_hospital": set(),
            "completed": set(),
            "cancelled": set(),
            "pending": {"en_route"},
        }

        if new_status != current_status and new_status not in allowed_next.get(current_status, set()):
            raise HTTPException(
                status_code=409,
                detail=f"Invalid ambulance transition from {current_status} to {new_status}.",
            )

    now = datetime.now(timezone.utc).isoformat()
    _, code = await db_update(
        "emergency_requests",
        {"id": emergency_id},
        {"status": new_status, "updated_at": now},
    )
    if code not in (200, 204):
        raise HTTPException(status_code=400, detail="Failed to update emergency status")

    if new_status in ("cancelled", "completed"):
        assign_rows, _ = await db_select("emergency_assignments", {"emergency_id": emergency_id}, columns="ambulance_id")
        for row in (assign_rows or []):
            amb_id = str(row.get("ambulance_id") or "")
            if amb_id:
                await db_update("ambulances", {"id": amb_id}, {"is_available": True, "updated_at": now})
        await db_update(
            "emergency_assignments",
            {"emergency_id": emergency_id},
            {"status": "declined", "completed_at": now},
        )

    return {"success": True}



@router.get("/emergencies/active", summary="List all non-terminal emergencies (admin/staff/hospital)")
async def list_active_emergencies(
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("admin", "staff", "hospital", "driver", "ambulance"))

    rows, _ = await db_query(
        "emergency_requests",
        params={"status": "in.(pending,assigned,en_route,at_scene,arrived,transporting,at_hospital)"},
    )
    return {"emergencies": rows or []}


# ΓöÇΓöÇ Driver-specific endpoints ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

@router.get("/driver/ambulance", summary="Get driver's ambulance ID + details")
async def get_driver_ambulance(current_user: dict = Depends(get_current_user)) -> dict:
    uid = str(current_user.get("sub") or "")
    rows, _ = await db_select("ambulances", {"current_driver_id": uid})
    amb = (rows or [None])[0]
    return {"ambulance": amb}


@router.post("/driver/ambulance", summary="Upsert (create/link) ambulance for driver")
async def upsert_driver_ambulance(body: dict, current_user: dict = Depends(get_current_user)) -> dict:
    uid = str(current_user.get("sub") or "")
    profile = await _require_role(uid, current_user, ("driver", "ambulance"))

    approval_row = await get_ambulance_registration_request(uid)
    if not approval_row or str(approval_row.get("status") or "pending") != "approved":
        raise HTTPException(
            status_code=403,
            detail="Ambulance account is pending hospital approval. Hospital must approve registration first.",
        )

    approved_hospital_id = str(approval_row.get("hospital_id") or "").strip()

    vehicle_number = str(body.get("vehicle_number") or "").strip()
    registration_number = str(body.get("registration_number") or "").strip()
    if not vehicle_number:
        raise HTTPException(status_code=400, detail="vehicle_number required")

    now = datetime.now(timezone.utc).isoformat()
    existing, _ = await db_select("ambulances", {"vehicle_number": vehicle_number})
    if existing:
        row = existing[0]
        payload: dict = {"current_driver_id": uid, "updated_at": now}
        if body.get("type"):
            payload["type"] = body["type"]
        if registration_number:
            payload["registration_number"] = registration_number
        if approved_hospital_id:
            payload["hospital_id"] = approved_hospital_id
        await db_update("ambulances", {"id": row["id"]}, payload)
        return {"ambulance_id": row["id"]}

    insert_payload: dict = {
        "vehicle_number": vehicle_number,
        "current_driver_id": uid,
        "type": body.get("type", "standard"),
        "is_available": True,
        "created_at": now,
        "updated_at": now,
    }
    if registration_number:
        insert_payload["registration_number"] = registration_number
    if approved_hospital_id:
        insert_payload["hospital_id"] = approved_hospital_id
    result, code = await db_insert("ambulances", insert_payload)
    if code not in (200, 201):
        raise HTTPException(status_code=400, detail="Failed to create ambulance")
    amb_id = result[0]["id"] if isinstance(result, list) and result else None

    if approved_hospital_id and profile.get("id"):
        try:
            await db_update(
                "profiles",
                {"id": str(profile.get("id"))},
                {"hospital_id": approved_hospital_id, "updated_at": now},
            )
        except Exception:
            pass

    return {"ambulance_id": amb_id}


@router.get(
    "/hospital/ambulance-approvals",
    response_model=list[AmbulanceApprovalRequest],
    summary="List pending/approved/rejected ambulance registration requests for hospital",
)
async def list_hospital_ambulance_approvals(
    current_user: dict = Depends(get_current_user),
    status_filter: str | None = Query(default=None, description="optional: pending|approved|rejected"),
) -> list[AmbulanceApprovalRequest]:
    user_id = str(current_user.get("sub") or "")
    profile = await _require_role(user_id, current_user, ("hospital", "admin"))

    effective_hospital_id = await _resolve_effective_hospital_id(
        profile=profile,
        current_user=current_user,
        requested_hospital_id=None,
    )
    if not effective_hospital_id:
        raise HTTPException(status_code=400, detail="Hospital linkage is required")

    normalized_status = None
    if status_filter:
        raw = str(status_filter).strip().lower()
        if raw in ("pending", "approved", "rejected"):
            normalized_status = raw

    rows = await list_ambulance_registration_requests(
        hospital_id=str(effective_hospital_id),
        status=normalized_status,
    )

    return [AmbulanceApprovalRequest(**row) for row in rows]


@router.post(
    "/hospital/ambulance-approvals/{target_user_id}/decision",
    response_model=AmbulanceApprovalRequest,
    summary="Approve or reject an ambulance registration request",
)
async def decide_hospital_ambulance_approval(
    target_user_id: str,
    payload: AmbulanceApprovalDecision,
    current_user: dict = Depends(get_current_user),
) -> AmbulanceApprovalRequest:
    user_id = str(current_user.get("sub") or "")
    profile = await _require_role(user_id, current_user, ("hospital", "admin"))

    effective_hospital_id = await _resolve_effective_hospital_id(
        profile=profile,
        current_user=current_user,
        requested_hospital_id=None,
    )
    if not effective_hospital_id:
        raise HTTPException(status_code=400, detail="Hospital linkage is required")

    existing = await get_ambulance_registration_request(target_user_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Ambulance approval request not found")

    if str(existing.get("hospital_id") or "") != str(effective_hospital_id):
        raise HTTPException(status_code=403, detail="Request belongs to another hospital")

    updated = await set_ambulance_registration_status(
        user_id=target_user_id,
        status=payload.decision,
        reviewed_by=user_id,
        review_note=payload.note,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Ambulance approval request not found")

    if payload.decision == "approved":
        now_iso = datetime.now(timezone.utc).isoformat()
        try:
            await db_update(
                "profiles",
                {"id": str(target_user_id)},
                {
                    "hospital_id": str(effective_hospital_id),
                    "updated_at": now_iso,
                },
            )
        except Exception:
            pass

        vehicle_number = str(existing.get("vehicle_number") or "").strip()
        if vehicle_number:
            existing_amb_rows, _ = await db_select(
                "ambulances",
                {"vehicle_number": vehicle_number},
            )
            if existing_amb_rows:
                await db_update(
                    "ambulances",
                    {"id": str(existing_amb_rows[0].get("id"))},
                    {
                        "current_driver_id": str(target_user_id),
                        "hospital_id": str(effective_hospital_id),
                        "registration_number": str(existing.get("registration_number") or "").strip() or None,
                        "type": str(existing.get("ambulance_type") or "standard"),
                        "is_available": True,
                        "updated_at": now_iso,
                    },
                )
            else:
                await db_insert(
                    "ambulances",
                    {
                        "vehicle_number": vehicle_number,
                        "registration_number": str(existing.get("registration_number") or "").strip() or None,
                        "type": str(existing.get("ambulance_type") or "standard"),
                        "hospital_id": str(effective_hospital_id),
                        "current_driver_id": str(target_user_id),
                        "is_available": True,
                        "created_at": now_iso,
                        "updated_at": now_iso,
                    },
                )

    return AmbulanceApprovalRequest(**updated)


@router.put(
    "/emergencies/{emergency_id}/patient-medical",
    summary="Update patient medical conditions for a hospital-owned emergency",
)
async def update_emergency_patient_medical(
    emergency_id: str,
    body: EmergencyPatientMedicalUpdate,
    current_user: dict = Depends(get_current_user),
) -> dict:
    user_id = str(current_user.get("sub") or "")
    requester_profile = await _require_role(
        user_id,
        current_user,
        ("hospital", "admin"),
    )

    rows, code = await db_select("emergency_requests", {"id": emergency_id})
    if code not in (200, 206) or not rows:
        raise HTTPException(status_code=404, detail="Emergency not found")

    emergency = rows[0]
    patient_id = str(emergency.get("patient_id") or "")
    if not patient_id:
        raise HTTPException(status_code=400, detail="Emergency has no patient")

    requester_role = str(requester_profile.get("role") or "").lower()
    if requester_role == "hospital":
        requester_hospital_id = str(requester_profile.get("hospital_id") or "")
        emergency_hospital_id = str(emergency.get("hospital_id") or "")
        if not requester_hospital_id or requester_hospital_id != emergency_hospital_id:
            raise HTTPException(
                status_code=403,
                detail="Emergency does not belong to your hospital",
            )

    medical_conditions = (body.medical_conditions or "").strip()
    payload = {
        "user_id": patient_id,
        "medical_conditions": medical_conditions,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    _, upsert_code = await db_upsert(
        "medical_profiles",
        payload,
        on_conflict="user_id",
    )
    if upsert_code not in (200, 201):
        raise HTTPException(
            status_code=400,
            detail="Failed to update patient medical conditions",
        )

    return {
        "success": True,
        "user_id": patient_id,
        "medical_conditions": medical_conditions,
    }


@router.put("/driver/ambulance/availability", summary="Toggle ambulance availability")
async def toggle_ambulance_availability(body: dict, current_user: dict = Depends(get_current_user)) -> dict:
    ambulance_id = str(body.get("ambulance_id") or "")
    is_available = bool(body.get("is_available"))
    if not ambulance_id:
        raise HTTPException(status_code=400, detail="ambulance_id required")
    # Ownership check: caller must be the current driver for this ambulance
    uid = str(current_user.get("sub") or "")
    rows, _ = await db_select("ambulances", {"id": ambulance_id})
    if not rows or str(rows[0].get("current_driver_id") or "") != uid:
        raise HTTPException(status_code=403, detail="Not authorised for this ambulance")
    now = datetime.now(timezone.utc).isoformat()
    await db_update("ambulances", {"id": ambulance_id}, {"is_available": is_available, "updated_at": now})
    return {"success": True}


@router.put("/driver/ambulance/location", summary="Send ambulance location update")
async def update_ambulance_location(body: dict, current_user: dict = Depends(get_current_user)) -> dict:
    ambulance_id = str(body.get("ambulance_id") or "")
    lat = body.get("latitude")
    lng = body.get("longitude")
    if not ambulance_id or lat is None or lng is None:
        raise HTTPException(status_code=400, detail="ambulance_id, latitude, longitude required")
    # Ownership check: caller must be the current driver for this ambulance
    uid = str(current_user.get("sub") or "")
    rows, _ = await db_select("ambulances", {"id": ambulance_id})
    if not rows or str(rows[0].get("current_driver_id") or "") != uid:
        raise HTTPException(status_code=403, detail="Not authorised for this ambulance")
    point = _to_point_wkt(lat, lng)
    now = datetime.now(timezone.utc).isoformat()
    await db_update("ambulances", {"id": ambulance_id}, {"last_known_location": point, "updated_at": now})
    return {"success": True}


@router.get("/driver/assignment", summary="Get driver's current active assignment")
async def get_driver_assignment(current_user: dict = Depends(get_current_user)) -> dict:
    uid = str(current_user.get("sub") or "")
    amb_rows, _ = await db_select("ambulances", {"current_driver_id": uid})
    if not amb_rows:
        return {"assignment": None}
    ambulance_id = amb_rows[0]["id"]

    assign_rows, _ = await db_query(
        "emergency_assignments",
        params={
            "ambulance_id": f"eq.{ambulance_id}",
            "status": "in.(pending,accepted)",
            "order": "assigned_at.desc",
            "limit": "1",
        },
    )
    if not assign_rows:
        # Compatibility fallback: some deployments may have emergency assignment
        # records missing while emergency_requests.assigned_ambulance_id is set.
        er_rows, _ = await db_query(
            "emergency_requests",
            params={
                "assigned_ambulance_id": f"eq.{ambulance_id}",
                "status": "in.(assigned,en_route,at_scene,arrived,transporting,at_hospital,pending)",
                "order": "updated_at.desc",
                "limit": "1",
            },
        )
        if not er_rows:
            return {"assignment": None}

        er = er_rows[0]
        synthetic = {
            "id": str(er.get("id") or ""),
            "ambulance_id": ambulance_id,
            "emergency_id": str(er.get("id") or ""),
            "status": "pending",
            "assigned_at": str(er.get("updated_at") or er.get("created_at") or datetime.now(timezone.utc).isoformat()),
            "emergency_requests": er,
        }
        return {"assignment": synthetic}

    asgn = assign_rows[0]
    er_id = asgn.get("emergency_id")
    er_rows, _ = await db_select("emergency_requests", {"id": er_id})
    er = (er_rows or [None])[0]

    if er and er.get("status") in ("completed", "cancelled"):
        now = datetime.now(timezone.utc).isoformat()
        await db_update("emergency_assignments", {"id": asgn["id"]}, {"status": "declined", "completed_at": now})
        return {"assignment": None}

    asgn["emergency_requests"] = er
    return {"assignment": asgn}


@router.post("/driver/assignment/{assignment_id}/accept", summary="Accept emergency assignment")
async def accept_assignment(assignment_id: str, body: dict, current_user: dict = Depends(get_current_user)) -> dict:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("driver", "ambulance"))
    emergency_id = str(body.get("emergency_id") or "")
    now = datetime.now(timezone.utc).isoformat()
    try:
        await db_update("emergency_assignments", {"id": assignment_id}, {"status": "accepted"})
    except Exception:
        pass
    if emergency_id:
        # Trust flow: accept/reject is separate from movement status updates.
        await db_update("emergency_requests", {"id": emergency_id}, {"status": "assigned", "updated_at": now})
    return {"success": True}


@router.post("/driver/assignment/{assignment_id}/decline", summary="Decline emergency assignment")
async def decline_assignment(assignment_id: str, body: dict, current_user: dict = Depends(get_current_user)) -> dict:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("driver", "ambulance"))
    emergency_id = str(body.get("emergency_id") or assignment_id)
    now = datetime.now(timezone.utc).isoformat()

    # Mark the assignment record as declined
    try:
        await db_update("emergency_assignments", {"id": assignment_id}, {"status": "declined", "completed_at": now})
    except Exception:
        pass

    # Fetch the emergency so we know which ambulance to re-enable
    er_rows, _ = await db_select("emergency_requests", {"id": emergency_id})
    old_ambulance_id = str((er_rows[0].get("assigned_ambulance_id") or "")) if er_rows else ""

    # Reset emergency to pending for re-dispatch (not cancelled)
    await db_update(
        "emergency_requests",
        {"id": emergency_id},
        {"status": "pending", "assigned_ambulance_id": None, "updated_at": now},
    )

    # Re-enable the ambulance that was assigned
    if old_ambulance_id:
        await db_update("ambulances", {"id": old_ambulance_id}, {"is_available": True, "updated_at": now})

    # Attempt automatic re-dispatch to the next best ambulance
    try:
        er = er_rows[0] if er_rows else {}
        loc = _parse_point_wkt(er.get("patient_location"))
        if loc:
            lat, lng = loc
            best, reason = await _find_and_reserve_best_ambulance(
                latitude=lat,
                longitude=lng,
                max_radius_km=80,
                preferred_hospital_id=str(er.get("hospital_id") or "") or None,
                emergency_id=emergency_id,
            )
            if best:
                new_amb_id = str(best["ambulance_id"])
                new_hosp_id = str(best.get("hospital_id") or "") or None
                await db_update(
                    "emergency_requests",
                    {"id": emergency_id},
                    {
                        "assigned_ambulance_id": new_amb_id,
                        "hospital_id": new_hosp_id,
                        "status": "assigned",
                        "updated_at": now,
                    },
                )
                await _ensure_pending_assignment(
                    emergency_id=emergency_id,
                    ambulance_id=new_amb_id,
                    notes=f"Re-dispatched after driver declined. {reason}",
                )
                _log_event("decline_redispatch_success", emergency_id=emergency_id, ambulance_id=new_amb_id)
    except Exception as redispatch_err:
        _log_event("decline_redispatch_failed", emergency_id=emergency_id, error=str(redispatch_err))

    return {"success": True}


@router.get("/driver/stats", summary="Get driver active/completed counts")
async def get_driver_stats(current_user: dict = Depends(get_current_user)) -> dict:
    uid = str(current_user.get("sub") or "")
    amb_rows, _ = await db_select("ambulances", {"current_driver_id": uid})
    if not amb_rows:
        return {"active": 0, "completed": 0}
    ambulance_id = amb_rows[0]["id"]

    active_rows, _ = await db_query(
        "emergency_requests",
        params={
            "assigned_ambulance_id": f"eq.{ambulance_id}",
            "status": "in.(assigned,en_route,at_scene,transporting,at_hospital)",
            "select": "id",
        },
    )
    completed_rows, _ = await db_query(
        "emergency_requests",
        params={
            "assigned_ambulance_id": f"eq.{ambulance_id}",
            "status": "eq.completed",
            "select": "id",
        },
    )
    return {"active": len(active_rows or []), "completed": len(completed_rows or [])}


@router.get("/driver/history", summary="Get driver completed emergency history")
async def get_driver_history(
    limit: int = 20,
    current_user: dict = Depends(get_current_user),
) -> dict:
    uid = str(current_user.get("sub") or "")
    amb_rows, _ = await db_select("ambulances", {"current_driver_id": uid})
    if not amb_rows:
        return {"history": []}
    ambulance_id = amb_rows[0]["id"]

    rows, _ = await db_query(
        "emergency_requests",
        params={
            "assigned_ambulance_id": f"eq.{ambulance_id}",
            "status": "eq.completed",
            "order": "updated_at.desc",
            "limit": str(limit),
        },
    )
    return {"history": rows or []}


@router.get("/driver/hospital-link", summary="Ensure ambulance has hospital link")
async def ensure_hospital_link(
    ambulance_id: str,
    latitude: float = 0,
    longitude: float = 0,
    force: bool = False,
    current_user: dict = Depends(get_current_user),
) -> dict:
    amb_rows, _ = await db_select("ambulances", {"id": ambulance_id})
    if not amb_rows:
        raise HTTPException(status_code=404, detail="Ambulance not found")
    amb = amb_rows[0]

    if amb.get("hospital_id") and not force:
        return {"success": True, "hospital_id": amb["hospital_id"], "distance_km": None}

    lat = latitude
    lng = longitude
    if lat == 0 and lng == 0:
        parsed_loc = _parse_point_wkt(amb.get("last_known_location"))
        if parsed_loc:
            lat, lng = parsed_loc
    if lat == 0 and lng == 0:
        raise HTTPException(status_code=400, detail="Location unavailable for hospital linking")

    hosp_rows, _ = await db_select("hospitals", {})
    best_id = None
    best_dist = float("inf")
    for h in (hosp_rows or []):
        if h.get("is_accepting_emergencies") is False:
            continue
        parsed_h = _parse_point_wkt(h.get("location"))
        if not parsed_h:
            continue
        h_lat, h_lng = parsed_h
        d = _distance_km(lat, lng, h_lat, h_lng)
        if d < best_dist:
            best_dist = d
            best_id = str(h["id"])

    if not best_id:
        raise HTTPException(status_code=404, detail="No eligible hospital found")

    now = datetime.now(timezone.utc).isoformat()
    await db_update("ambulances", {"id": ambulance_id}, {"hospital_id": best_id, "updated_at": now})
    driver_id = amb.get("current_driver_id")
    if driver_id:
        try:
            await db_update("profiles", {"id": driver_id}, {"hospital_id": best_id, "updated_at": now})
        except Exception:
            pass

    return {"success": True, "hospital_id": best_id, "distance_km": round(best_dist, 2) if best_dist < float("inf") else None}


@router.get("/patient/ambulances/live", summary="Get live available ambulances for patient map")
async def get_live_available_ambulances(
    max_age_minutes: int = Query(30, ge=0, le=240),
    limit: int = Query(50, ge=1, le=200),
    current_user: dict = Depends(get_current_user),
) -> dict:
    uid = str(current_user.get("sub") or "")
    await _require_role(uid, current_user, ("patient", "admin", "hospital", "driver", "ambulance"))

    rows, code = await db_query(
        "ambulances",
        columns="id,vehicle_number,registration_number,type,is_available,last_known_location,updated_at,hospital_id,current_driver_id",
        params={
            "is_available": "eq.true",
            "last_known_location": "not.is.null",
            "order": "updated_at.desc",
            "limit": str(limit),
        },
    )
    if code not in (200, 206):
        raise HTTPException(status_code=503, detail="Unable to load available ambulances")

    all_rows = rows or []
    if max_age_minutes <= 0:
        return {"ambulances": all_rows}

    cutoff = datetime.now(timezone.utc) - timedelta(minutes=max_age_minutes)
    fresh_rows = [
        row
        for row in all_rows
        if (_parse_iso(str(row.get("updated_at") or "")) or datetime(1970, 1, 1, tzinfo=timezone.utc)) >= cutoff
    ]

    # If freshness filtering is too strict, fall back to all available ambulances
    # so the patient can still see nearest responders.
    return {"ambulances": fresh_rows if fresh_rows else all_rows}


@router.get("/admin/chat-stats", summary="Get chatbot usage statistics")
async def get_chat_stats(current_user: dict = Depends(get_current_user)) -> dict:
    uid = str(current_user.get("sub") or "")
    await _require_role(uid, current_user, ("admin",))
    rows, _ = await db_query("chatbot_messages", params={"select": "id,created_at"})
    total = len(rows or [])
    return {"total_messages": total}


# ΓöÇΓöÇΓöÇ Medical Notes endpoints ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

@router.post(
    "/emergencies/{emergency_id}/medical-notes",
    response_model=MedicalNoteResponse,
    summary="Add a medical note to an emergency (driver or hospital)",
)
async def add_medical_note(
    emergency_id: str,
    payload: MedicalNoteInput,
    current_user: dict = Depends(get_current_user),
) -> MedicalNoteResponse:
    user_id = str(current_user.get("sub") or "")
    profile = await _require_role(user_id, current_user, ("ambulance", "driver", "hospital", "admin"))

    # Verify the emergency exists
    rows, sc = await db_select("emergency_requests", {"id": emergency_id}, columns="id,status")
    if sc not in (200, 206) or not rows:
        raise HTTPException(status_code=404, detail="Emergency not found")

    role = str(profile.get("role") or "").lower()
    if role == "ambulance":
        role = "driver"
    author_name = str(profile.get("full_name") or profile.get("email") or "")

    note_id = str(uuid4())
    now = datetime.now(timezone.utc).isoformat()

    record = {
        "id": note_id,
        "emergency_id": emergency_id,
        "author_id": user_id,
        "author_role": role,
        "author_name": author_name,
        "note_type": payload.note_type,
        "content": payload.content,
        "vitals": payload.vitals if payload.vitals else None,
        "created_at": now,
    }

    data, insert_sc = await db_insert("medical_notes", record)
    if insert_sc not in (200, 201):
        logger.warning("medical_notes insert failed sc=%s body=%s", insert_sc, data)
        detail = "Failed to save medical note"
        if isinstance(data, dict):
            raw = data.get("message") or data.get("detail") or data.get("error")
            if isinstance(raw, str) and raw.strip():
                detail = raw
        raise HTTPException(status_code=502, detail=detail)

    _log_event("medical_note_added", emergency_id=emergency_id, role=role, note_type=payload.note_type)

    return MedicalNoteResponse(
        id=note_id,
        emergency_id=emergency_id,
        author_id=user_id,
        author_role=role,
        author_name=author_name,
        note_type=payload.note_type,
        content=payload.content,
        vitals=payload.vitals,
        created_at=now,
    )


@router.get(
    "/emergencies/{emergency_id}/medical-notes",
    response_model=list[MedicalNoteResponse],
    summary="Get all medical notes for an emergency",
)
async def get_medical_notes(
    emergency_id: str,
    current_user: dict = Depends(get_current_user),
) -> list[MedicalNoteResponse]:
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("ambulance", "driver", "hospital", "admin", "patient"))

    rows, sc = await db_query(
        "medical_notes",
        columns="id,emergency_id,author_id,author_role,author_name,note_type,content,vitals,created_at",
        params={"emergency_id": f"eq.{emergency_id}", "order": "created_at.asc"},
    )
    if sc not in (200, 206):
        raise HTTPException(status_code=502, detail="Failed to load medical notes")

    results: list[MedicalNoteResponse] = []
    for row in (rows or []):
        vitals_raw = row.get("vitals")
        vitals = None
        if vitals_raw:
            if isinstance(vitals_raw, str):
                try:
                    vitals = _json.loads(vitals_raw)
                except (_json.JSONDecodeError, ValueError):
                    pass
            elif isinstance(vitals_raw, dict):
                vitals = vitals_raw

        results.append(
            MedicalNoteResponse(
                id=str(row.get("id") or ""),
                emergency_id=str(row.get("emergency_id") or ""),
                author_id=str(row.get("author_id") or ""),
                author_role=str(row.get("author_role") or ""),
                author_name=row.get("author_name"),
                note_type=str(row.get("note_type") or "general"),
                content=str(row.get("content") or ""),
                vitals=vitals,
                created_at=str(row.get("created_at") or ""),
            )
        )

    return results


# ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ
# Push notification management
# ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ


class PushTokenPayload(BaseModel):
    user_id: str = Field(..., min_length=1)
    token: str = Field(..., min_length=1)
    platform: str = "android"


class SendNotificationPayload(BaseModel):
    user_id: str = Field(..., min_length=1)
    title: str = Field(..., min_length=1)
    body: str = Field(..., min_length=1)
    data: dict[str, Any] | None = None


@router.post("/push-token", summary="Register Expo push token for a user")
async def register_push_token(
    payload: PushTokenPayload,
    current_user: dict = Depends(get_current_user),
) -> dict:
    caller_id = str(current_user.get("sub") or "")
    # Users can only register their own token (admins can register any)
    caller_role = str(current_user.get("user_metadata", {}).get("role", ""))
    if caller_id != payload.user_id and caller_role != "admin":
        raise HTTPException(status_code=403, detail="Cannot register token for another user")

    token = payload.token.strip()
    if not token.startswith("ExponentPushToken["):
        raise HTTPException(status_code=400, detail="Invalid Expo push token")

    now = datetime.now(timezone.utc).isoformat()
    _, code = await db_upsert(
        "push_tokens",
        {
            "user_id": payload.user_id,
            "token": token,
            "platform": payload.platform,
            "is_active": True,
            "failure_count": 0,
            "last_error": None,
            "updated_at": now,
        },
        on_conflict="token",
    )

    if code not in (200, 201, 204):
        logger.warning("push_token_upsert_failed user_id=%s code=%s", payload.user_id, code)
        # Don't fail the whole request ΓÇö token storage is best-effort
        return {"ok": False, "detail": "Token storage failed ΓÇö will retry"}

    return {"ok": True}


async def _send_push_notification(
    user_id: str,
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
) -> bool:
    """Send an Expo push notification to all active tokens for a user."""
    try:
        rows, code = await db_query(
            "push_tokens",
            params={
                "user_id": f"eq.{user_id}",
                "is_active": "eq.true",
                "order": "updated_at.desc",
                "limit": "10",
            },
        )
        if code not in (200, 206) or not rows:
            return False

        sent_any = False
        import httpx
        async with httpx.AsyncClient(timeout=10) as client:
            for row in rows:
                token = str(row.get("token") or "")
                if not token.startswith("ExponentPushToken["):
                    continue

                resp = await client.post(
                    "https://exp.host/--/api/v2/push/send",
                    json={
                        "to": token,
                        "title": title,
                        "body": body,
                        "sound": "default",
                        "priority": "high",
                        "data": data or {},
                    },
                    headers={"Content-Type": "application/json"},
                )

                ticket_id = None
                delivery_error = None
                delivery_status = "failed"

                if resp.status_code == 200:
                    try:
                        payload = resp.json()
                        ticket = (payload.get("data") or [{}])[0]
                        delivery_status = str(ticket.get("status") or "ok")
                        ticket_id = ticket.get("id")
                        details = ticket.get("details") or {}
                        delivery_error = details.get("error") or ticket.get("message")
                    except Exception:
                        delivery_status = "failed"
                        delivery_error = "Invalid Expo response"
                else:
                    delivery_error = f"HTTP {resp.status_code}"

                await db_insert(
                    "push_delivery_logs",
                    {
                        "user_id": user_id,
                        "token": token,
                        "title": title,
                        "body": body,
                        "status": delivery_status,
                        "error": delivery_error,
                        "ticket_id": ticket_id,
                    },
                )

                if delivery_status == "ok":
                    sent_any = True
                    await db_update(
                        "push_tokens",
                        {"token": token},
                        {
                            "last_sent_at": datetime.now(timezone.utc).isoformat(),
                            "failure_count": 0,
                            "last_error": None,
                            "is_active": True,
                        },
                    )
                    continue

                # Expo signals token invalid/unregistered for cleanup.
                error_text = str(delivery_error or "unknown")
                deactivate = "DeviceNotRegistered" in error_text
                await db_update(
                    "push_tokens",
                    {"token": token},
                    {
                        "failure_count": int(row.get("failure_count") or 0) + 1,
                        "last_error": error_text,
                        "is_active": False if deactivate else bool(row.get("is_active", True)),
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    },
                )

        return sent_any
    except Exception as exc:
        logger.warning("push_notification_failed user_id=%s error=%s", user_id, exc)
        return False


@router.post("/send-notification", summary="Send push notification to a user (admin only)")
async def send_notification_endpoint(
    payload: SendNotificationPayload,
    current_user: dict = Depends(get_current_user),
) -> dict:
    caller_id = str(current_user.get("sub") or "")
    await _require_role(caller_id, current_user, ("admin",))

    sent = await _send_push_notification(
        payload.user_id, payload.title, payload.body, payload.data
    )
    return {"ok": sent}


@router.get("/push-health", summary="Push delivery health summary (admin only)")
async def push_health(current_user: dict = Depends(get_current_user)) -> dict:
    caller_id = str(current_user.get("sub") or "")
    await _require_role(caller_id, current_user, ("admin",))

    tokens, _ = await db_query("push_tokens", params={"select": "id,is_active"})
    logs, _ = await db_query(
        "push_delivery_logs",
        params={"order": "created_at.desc", "limit": "200"},
    )

    total_tokens = len(tokens or [])
    active_tokens = sum(1 for row in (tokens or []) if bool(row.get("is_active")))
    total_logs = len(logs or [])
    delivered = sum(1 for row in (logs or []) if str(row.get("status") or "") == "ok")

    success_rate = round((delivered / total_logs) * 100, 2) if total_logs else 0.0
    return {
        "total_tokens": total_tokens,
        "active_tokens": active_tokens,
        "recent_messages": total_logs,
        "recent_successful": delivered,
        "recent_success_rate": success_rate,
    }

