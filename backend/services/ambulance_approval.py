from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from services.supabase import db_query, db_select, db_upsert, db_update

_TABLE = "ambulance_registration_requests"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_status(value: str | None) -> str:
    status = str(value or "").strip().lower()
    return status if status in ("pending", "approved", "rejected") else "pending"


async def upsert_ambulance_registration_request(
    *,
    user_id: str,
    hospital_id: str,
    full_name: str,
    phone: str,
    vehicle_number: str,
    registration_number: str,
    ambulance_type: str,
) -> dict[str, Any]:
    user_id = str(user_id or "").strip()
    if not user_id:
        raise ValueError("user_id is required")

    existing = await get_ambulance_registration_request(user_id)
    now = _now_iso()
    payload = {
        "user_id": user_id,
        "hospital_id": str(hospital_id or "").strip(),
        "full_name": str(full_name or "").strip(),
        "phone": str(phone or "").strip(),
        "vehicle_number": str(vehicle_number or "").strip(),
        "registration_number": str(registration_number or "").strip(),
        "ambulance_type": str(ambulance_type or "standard").strip() or "standard",
        "status": "pending",
        "requested_at": existing.get("requested_at") if existing else now,
        "updated_at": now,
        "reviewed_at": None,
        "reviewed_by": None,
        "review_note": None,
    }

    rows, code = await db_upsert(_TABLE, payload, on_conflict="user_id")
    if code not in (200, 201):
        raise RuntimeError("Failed to upsert ambulance approval request")
    if isinstance(rows, list) and rows:
        return dict(rows[0])
    return payload


async def get_ambulance_registration_request(user_id: str) -> dict[str, Any] | None:
    user_id = str(user_id or "").strip()
    if not user_id:
        return None
    rows, code = await db_select(_TABLE, {"user_id": user_id})
    if code not in (200, 206) or not rows:
        return None
    row = dict(rows[0])
    row["status"] = _normalize_status(row.get("status"))
    return row


async def list_ambulance_registration_requests(
    *,
    hospital_id: str | None = None,
    status: str | None = None,
) -> list[dict[str, Any]]:
    params: dict[str, str] = {"order": "requested_at.desc"}
    hospital_id_norm = str(hospital_id or "").strip()
    if hospital_id_norm:
        params["hospital_id"] = f"eq.{hospital_id_norm}"

    status_norm = _normalize_status(status) if status else ""
    if status_norm:
        params["status"] = f"eq.{status_norm}"

    rows, code = await db_query(_TABLE, params=params)
    if code not in (200, 206) or not rows:
        return []

    normalized: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        item["status"] = _normalize_status(item.get("status"))
        normalized.append(item)
    return normalized


async def set_ambulance_registration_status(
    *,
    user_id: str,
    status: str,
    reviewed_by: str,
    review_note: str | None = None,
) -> dict[str, Any] | None:
    user_id = str(user_id or "").strip()
    normalized_status = _normalize_status(status)
    if normalized_status not in ("pending", "approved", "rejected"):
        raise ValueError("status must be pending, approved, or rejected")
    if not user_id:
        return None

    existing = await get_ambulance_registration_request(user_id)
    if not existing:
        return None

    now = _now_iso()
    payload = {
        "status": normalized_status,
        "updated_at": now,
        "reviewed_at": now if normalized_status in ("approved", "rejected") else None,
        "reviewed_by": str(reviewed_by or "").strip() or None,
        "review_note": str(review_note or "").strip() or None,
    }
    _, code = await db_update(_TABLE, {"user_id": user_id}, payload)
    if code not in (200, 204):
        return None
    return await get_ambulance_registration_request(user_id)
