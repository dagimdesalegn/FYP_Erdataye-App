"""
Operations router — non-breaking backend enhancements.

Provides:
  • Dashboard-friendly operational summary metrics.
  • A deterministic triage scoring endpoint for decision support demos.

These endpoints do not modify existing tables or flows.
"""

import logging
import struct
from datetime import datetime, timedelta, timezone
from math import asin, cos, radians, sin, sqrt
from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field, field_validator

from deps import get_current_user
from services.supabase import db_insert, db_query, db_select, db_update
from fastapi import Depends

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
        pass  # non-fatal — in-memory copy is authoritative


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


# ─────────────────────────────────────────────────────────────────────────────
# Role helpers
# ─────────────────────────────────────────────────────────────────────────────


async def _get_profile(user_id: str, current_user: dict | None = None) -> dict | None:
    rows, code = await db_select("profiles", {"id": user_id}, columns="id,role,hospital_id")
    if code not in (200, 206) or not rows:
        metadata = (current_user or {}).get("user_metadata") or {}
        metadata_role = str(metadata.get("role") or "").lower()
        if metadata_role in ("admin", "hospital", "driver", "ambulance", "patient"):
            return {
                "id": user_id,
                "role": metadata_role,
                "hospital_id": metadata.get("hospital_id"),
            }
        return None
    return rows[0]


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


def _parse_point_wkt(value: Any) -> tuple[float, float] | None:
    """Parse a PostGIS point from WKT, EWKB hex, or GeoJSON dict → (lat, lon)."""
    if value is None:
        return None

    # ── GeoJSON dict (Supabase REST returns this for geometry columns) ───
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
    effective_hospital_id = requested_hospital_id if role == "admin" and requested_hospital_id else profile.get("hospital_id")

    if role == "hospital" and not effective_hospital_id:
        metadata = current_user.get("user_metadata") or {}
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
        if effective_hospital_id and not profile.get("hospital_id") and profile.get("id"):
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
        columns="hospital_id,status",
    )

    codes = [hosp_code, amb_code, eme_code]
    if any(code not in (200, 206) for code in codes):
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not compute dispatch recommendation from database.",
        )

    all_ambulances = ambulances or []
    hospitals_by_id = {str(h.get("id")): h for h in (hospitals or [])}
    excluded_ids = exclude_ambulance_ids or set()
    available = [
        a
        for a in all_ambulances
        if bool(a.get("is_available"))
        and str(a.get("id") or "") not in excluded_ids
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
    for amb in candidates:
        parsed = _parse_point_wkt(amb.get("last_known_location"))
        if not parsed:
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

    if best is None:
        return None, f"No ambulances found within {max_radius_km:.0f} km of your location. Your request has been saved and will be dispatched when an ambulance becomes available nearby."

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
        # A 204 means `return=minimal` or zero matches — never a success.
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

    # Batch-load all patient profiles and medical profiles in 2 queries (fixes N+1)
    patient_ids = list({str(raw.get("patient_id") or "") for raw in emergencies if raw.get("patient_id")})
    profiles_by_id: dict[str, dict] = {}
    medical_by_id: dict[str, dict] = {}

    if patient_ids:
        ids_csv = ",".join(patient_ids)
        profile_rows, _ = await db_query(
            "profiles",
            columns="id,full_name,phone,national_id",
            params={"id": f"in.({ids_csv})"},
        )
        for p in (profile_rows or []):
            profiles_by_id[str(p.get("id") or "")] = p

        medical_rows, _ = await db_query(
            "medical_profiles",
            columns="user_id,blood_type,allergies,medical_conditions,emergency_contact_name,emergency_contact_phone,updated_at",
            params={"user_id": f"in.({ids_csv})"},
        )
        for m in (medical_rows or []):
            uid = str(m.get("user_id") or "")
            existing = medical_by_id.get(uid)
            if not existing or (m.get("updated_at") or "") > (existing.get("updated_at") or ""):
                medical_by_id[uid] = m

    # Batch-load assigned ambulance vehicles
    ambulance_ids = list({str(raw.get("assigned_ambulance_id") or "") for raw in emergencies if raw.get("assigned_ambulance_id")})
    vehicles_by_amb: dict[str, str] = {}
    if ambulance_ids:
        amb_csv = ",".join(ambulance_ids)
        amb_rows, _ = await db_query(
            "ambulances",
            columns="id,vehicle_number,registration_number",
            params={"id": f"in.({amb_csv})"},
        )
        for a in (amb_rows or []):
            aid = str(a.get("id") or "")
            vehicles_by_amb[aid] = str(a.get("vehicle_number") or a.get("registration_number") or "")

    results: list[HospitalEmergency] = []
    for raw in emergencies:
        coords = _parse_point_wkt(raw.get("patient_location"))
        pid = str(raw.get("patient_id") or "")
        amb_id = str(raw.get("assigned_ambulance_id") or "")
        # national_id: prefer emergency_requests row, fallback to profile
        nid = raw.get("national_id") or (profiles_by_id.get(pid) or {}).get("national_id")

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


# ─────────────────────────────────────────────────────────────────────────────
# Admin Settings — runtime API key + provider management
# ─────────────────────────────────────────────────────────────────────────────

# Supported AI providers — each maps to an OpenAI-compatible base_url + default model
_AI_PROVIDERS: dict[str, dict] = {
    "deepseek": {"base_url": "https://api.deepseek.com", "model": "deepseek-chat"},
    "openai":   {"base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini"},
    "groq":     {"base_url": "https://api.groq.com/openai/v1", "model": "llama-3.1-8b-instant"},
}

# Runtime mutable provider state (default: deepseek)
_active_provider: str = "deepseek"


class AdminSettingsResponse(BaseModel):
    deepseek_api_key_set: bool
    deepseek_api_key_preview: str
    active_provider: str
    available_providers: list[str]
    total_chat_requests: int
    unique_chat_users: int
    today_chat_requests: int


class AdminUpdateApiKeyRequest(BaseModel):
    api_key: str = Field(..., min_length=1, max_length=200)
    provider: str = Field(default="deepseek")


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

    from config import settings as app_settings
    global _active_provider

    key = app_settings.deepseek_api_key or ""
    has_key = len(key) > 4
    preview = (key[:4] + "..." + key[-4:]) if has_key else "(not set)"

    # Chat stats
    rows, _ = await db_query("chatbot_messages", params={"select": "id,user_id,created_at"})
    all_rows = rows or []
    total = len(all_rows)
    unique_users = len({r.get("user_id") for r in all_rows if r.get("user_id")})
    today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    today_count = sum(1 for r in all_rows if (r.get("created_at") or "").startswith(today_str))

    return AdminSettingsResponse(
        deepseek_api_key_set=has_key,
        deepseek_api_key_preview=preview,
        active_provider=_active_provider,
        available_providers=list(_AI_PROVIDERS.keys()),
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

    from config import settings as app_settings
    import routers.chat as chat_module
    global _active_provider

    new_key = payload.api_key.strip()
    provider = payload.provider.strip().lower()
    if provider not in _AI_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}. Supported: {list(_AI_PROVIDERS.keys())}")

    provider_cfg = _AI_PROVIDERS[provider]
    # Update the runtime settings object
    app_settings.deepseek_api_key = new_key
    _active_provider = provider
    # Rebuild the AsyncOpenAI client used by the chat router
    chat_module._deepseek = chat_module.AsyncOpenAI(
        api_key=new_key,
        base_url=provider_cfg["base_url"],
    )
    # Update the model name so the chat endpoint uses the correct model
    chat_module._MODEL = provider_cfg["model"]
    return {"success": True, "message": f"API key updated. Provider: {provider}, Model: {provider_cfg['model']}"}


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

    update_payload = {
        "status": payload.status,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    if role == "hospital" and not emergency.get("hospital_id") and profile.get("hospital_id"):
        update_payload["hospital_id"] = profile.get("hospital_id")

    _, update_code = await db_update("emergency_requests", {"id": emergency_id}, update_payload)
    if update_code not in (200, 204):
        raise HTTPException(status_code=400, detail="Failed to update status")

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
            reason=reason or "All ambulances are currently busy. Your emergency request has been saved — an ambulance will be dispatched as soon as one becomes available. You can try again shortly.",
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


@router.get("/family/share/live", summary="Public live emergency status for family share links")
async def family_share_live(share_token: str = Query(..., min_length=16)) -> dict:
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
        distance_patient_km = round(_distance_km(ambulance_loc[0], ambulance_loc[1], patient_loc[0], patient_loc[1]), 2)
        eta_minutes = max(2, round((distance_patient_km / 35.0) * 60 + 1))

    if hospital_loc and patient_loc:
        distance_hospital_km = round(_distance_km(patient_loc[0], patient_loc[1], hospital_loc[0], hospital_loc[1]), 2)

    return {
        "share_token": share_token,
        "emergency_id": emergency_id,
        "status": emergency.get("status"),
        "emergency_type": emergency.get("emergency_type"),
        "updated_at": emergency.get("updated_at"),
        "hospital_name": hospital_name,
        "hospital_accepting": hospital_accepting,
        "ambulance_vehicle": ambulance_vehicle,
        "distance_to_patient_km": distance_patient_km,
        "distance_to_hospital_km": distance_hospital_km,
        "eta_minutes": eta_minutes,
        "expires_at": row.get("expires_at"),
    }


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


# ── Patient emergency read/write endpoints (service-role, RLS-bypassed) ──────

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
    user_id = str(current_user.get("sub") or "")
    await _require_role(user_id, current_user, ("patient", "admin", "ambulance", "driver", "hospital"))

    rows, code = await db_select("emergency_requests", {"id": emergency_id}, columns="*")
    if code not in (200, 206) or not rows:
        raise HTTPException(status_code=404, detail="Emergency not found")
    emergency = rows[0]

    # Assignment
    assign_rows, _ = await db_query(
        "emergency_assignments",
        columns="*",
        params={"emergency_id": f"eq.{emergency_id}", "order": "assigned_at.desc", "limit": "1"},
    )
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
                    for cid in candidate_ids:
                        p_rows, _ = await db_select("profiles", {"id": cid}, columns="id,phone")
                        if p_rows and p_rows[0].get("phone"):
                            resolved_phone = p_rows[0]["phone"]
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
    await _require_role(user_id, current_user, ("patient", "admin", "ambulance", "driver", "hospital"))

    new_status = str(body.get("status") or "")
    allowed_statuses = ("pending", "assigned", "en_route", "at_scene", "arrived",
                        "transporting", "at_hospital", "completed", "cancelled")
    if new_status not in allowed_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status: {new_status}")

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


# ── Driver-specific endpoints ────────────────────────────────────────────────

@router.get("/driver/ambulance", summary="Get driver's ambulance ID + details")
async def get_driver_ambulance(current_user: dict = Depends(get_current_user)) -> dict:
    uid = str(current_user.get("sub") or "")
    rows, _ = await db_select("ambulances", {"current_driver_id": uid})
    amb = (rows or [None])[0]
    return {"ambulance": amb}


@router.post("/driver/ambulance", summary="Upsert (create/link) ambulance for driver")
async def upsert_driver_ambulance(body: dict, current_user: dict = Depends(get_current_user)) -> dict:
    uid = str(current_user.get("sub") or "")
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
        if body.get("hospital_id"):
            payload["hospital_id"] = body["hospital_id"]
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
    if body.get("hospital_id"):
        insert_payload["hospital_id"] = body["hospital_id"]
    result, code = await db_insert("ambulances", insert_payload)
    if code not in (200, 201):
        raise HTTPException(status_code=400, detail="Failed to create ambulance")
    amb_id = result[0]["id"] if isinstance(result, list) and result else None
    return {"ambulance_id": amb_id}


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
        return {"assignment": None}

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
    emergency_id = str(body.get("emergency_id") or "")
    now = datetime.now(timezone.utc).isoformat()
    try:
        await db_update("emergency_assignments", {"id": assignment_id}, {"status": "accepted"})
    except Exception:
        pass
    if emergency_id:
        await db_update("emergency_requests", {"id": emergency_id}, {"status": "en_route", "updated_at": now})
    return {"success": True}


@router.post("/driver/assignment/{assignment_id}/decline", summary="Decline emergency assignment")
async def decline_assignment(assignment_id: str, body: dict, current_user: dict = Depends(get_current_user)) -> dict:
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

