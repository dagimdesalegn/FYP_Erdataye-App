"""
Operations router — non-breaking backend enhancements.

Provides:
  • Dashboard-friendly operational summary metrics.
  • A deterministic triage scoring endpoint for decision support demos.

These endpoints do not modify existing tables or flows.
"""

from datetime import datetime, timedelta, timezone
from math import asin, cos, radians, sin, sqrt
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from deps import get_current_user
from services.supabase import db_select
from fastapi import Depends

router = APIRouter(prefix="/ops", tags=["Operations"])


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


def _parse_point_wkt(value: str | None) -> tuple[float, float] | None:
    if not value:
        return None
    try:
        # Supports: SRID=4326;POINT(lon lat) and POINT(lon lat)
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

    me_rows, me_code = await db_select(
        "profiles",
        {"id": user_id},
        columns="id,role,hospital_id",
    )
    if me_code not in (200, 206) or not me_rows:
        raise HTTPException(status_code=403, detail="Unable to verify requester role.")

    role = str(me_rows[0].get("role") or "").lower()
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
                and str(r.get("status") or "") in ("pending", "accepted", "declined")
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
) -> OpsSummary:
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


@router.post(
    "/triage-score",
    response_model=TriageOutput,
    summary="Deterministic emergency triage score for rapid prioritisation",
)
async def triage_score(payload: TriageInput) -> TriageOutput:
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
async def fleet_intelligence() -> FleetIntelligenceResponse:
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
) -> DispatchRecommendationResponse:
    hospitals, hosp_code = await db_select(
        "hospitals",
        {},
        columns=(
            "id,is_accepting_emergencies,dispatch_weight,"
            "max_concurrent_emergencies,trauma_capable,icu_beds_available"
        ),
    )
    if hosp_code not in (200, 206):
        hospitals, hosp_code = await db_select("hospitals", {}, columns="id")

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
    available = [a for a in all_ambulances if bool(a.get("is_available"))]
    if not available:
        return DispatchRecommendationResponse(
            ambulance_id=None,
            hospital_id=None,
            score=None,
            distance_km=None,
            reason="No available ambulances",
        )

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

    best: dict | None = None
    for amb in available:
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

        distance_score = max(0.0, 100.0 - dist * 2.0)
        load_ratio = min(active / max(max_concurrent, 1), 2.0)
        load_score = max(0.0, 100.0 - load_ratio * 50.0)
        capacity_score = min(100.0, fleet * 10.0)
        capability_bonus = (6.0 if trauma_capable else 0.0) + min(icu_beds, 5) * 1.2
        score = (
            distance_score * 0.52
            + load_score * 0.26
            + capacity_score * 0.12
            + min(dispatch_weight, 2.0) * 8.0
            + capability_bonus
        )

        if best is None or score > best["score"]:
            best = {
                "ambulance_id": str(amb.get("id")),
                "hospital_id": (str(amb.get("hospital_id")) if amb.get("hospital_id") else None),
                "score": round(score, 2),
                "distance_km": round(dist, 2),
            }

    if best is None:
        return DispatchRecommendationResponse(
            ambulance_id=None,
            hospital_id=None,
            score=None,
            distance_km=None,
            reason=f"No available ambulances within {max_radius_km:.0f} km",
        )

    return DispatchRecommendationResponse(
        ambulance_id=best["ambulance_id"],
        hospital_id=best["hospital_id"],
        score=best["score"],
        distance_km=best["distance_km"],
        reason="Recommended by distance, hospital load, and fleet capacity",
    )
