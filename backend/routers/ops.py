"""
Operations router — non-breaking backend enhancements.

Provides:
  • Dashboard-friendly operational summary metrics.
  • A deterministic triage scoring endpoint for decision support demos.

These endpoints do not modify existing tables or flows.
"""

from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from services.supabase import db_select

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

        if total == 0:
            readiness_score = 0.0
        else:
            readiness_score = round(
                ((available / total) * 70.0)
                + (max(0, 1 - (active_emergencies / max(total, 1))) * 30.0),
                2,
            )

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
