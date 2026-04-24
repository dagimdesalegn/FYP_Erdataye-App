from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from services.supabase import db_query, db_select, db_upsert, db_update

_TABLE = "ambulance_registration_requests"
_PROFILE_TABLE = "profiles"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_status(value: str | None) -> str:
    status = str(value or "").strip().lower()
    return status if status in ("pending", "approved", "rejected") else "pending"


def _is_missing_relation(code: int, payload: Any) -> bool:
    if code == 404:
        return True

    candidate: dict[str, Any] | None = None
    if isinstance(payload, dict):
        candidate = payload
    elif isinstance(payload, list) and payload and isinstance(payload[0], dict):
        candidate = payload[0]

    if not candidate:
        return False

    err_code = str(candidate.get("code") or "").strip().upper()
    message = str(candidate.get("message") or "").strip().lower()
    return err_code == "PGRST205" or "could not find the table" in message


def _from_profile_row(row: dict[str, Any]) -> dict[str, Any]:
    updated_at = str(row.get("updated_at") or "") or None
    return {
        "user_id": str(row.get("id") or "").strip(),
        "hospital_id": str(row.get("hospital_id") or "").strip(),
        "full_name": str(row.get("full_name") or "").strip() or None,
        "phone": str(row.get("phone") or "").strip() or None,
        "vehicle_number": str(row.get("vehicle_number") or "").strip() or None,
        "registration_number": str(row.get("registration_number") or "").strip() or None,
        "ambulance_type": str(row.get("ambulance_type") or "").strip() or "standard",
        "status": _normalize_status(row.get("approval_status")),
        "requested_at": str(row.get("created_at") or updated_at or "") or None,
        "updated_at": updated_at,
        "reviewed_at": None,
        "reviewed_by": None,
        "review_note": None,
    }


async def _select_profile_for_approval(user_id: str) -> dict[str, Any] | None:
    # Try richer columns first, then fall back for deployments where optional
    # vehicle-related columns are not present on profiles.
    full_columns = (
        "id,role,hospital_id,full_name,phone,approval_status,"
        "vehicle_number,registration_number,ambulance_type,created_at,updated_at"
    )
    rows, code = await db_select(_PROFILE_TABLE, {"id": user_id}, columns=full_columns)
    if code not in (200, 206):
        rows, code = await db_select(
            _PROFILE_TABLE,
            {"id": user_id},
            columns="id,role,hospital_id,full_name,phone,approval_status,created_at,updated_at",
        )
        if code not in (200, 206) or not rows:
            return None

    if not rows:
        return None
    row = dict(rows[0])
    if str(row.get("role") or "").strip().lower() not in ("ambulance", "driver"):
        return None
    return row


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
    if code in (200, 201):
        if isinstance(rows, list) and rows:
            return dict(rows[0])
        return payload

    if not _is_missing_relation(code, rows):
        raise RuntimeError("Failed to upsert ambulance approval request")

    now = _now_iso()
    base_patch = {
        "hospital_id": str(hospital_id or "").strip(),
        "full_name": str(full_name or "").strip(),
        "phone": str(phone or "").strip(),
        "approval_status": "pending",
        "updated_at": now,
    }
    _, fallback_code = await db_update(_PROFILE_TABLE, {"id": user_id}, base_patch)
    if fallback_code not in (200, 204):
        # Best effort fallback for deployments where profile row was not present.
        await db_upsert(
            _PROFILE_TABLE,
            {"id": user_id, "role": "ambulance", **base_patch},
            on_conflict="id",
        )

    extra_patch = {
        "vehicle_number": str(vehicle_number or "").strip() or None,
        "registration_number": str(registration_number or "").strip() or None,
        "ambulance_type": str(ambulance_type or "standard").strip() or "standard",
    }
    try:
        await db_update(_PROFILE_TABLE, {"id": user_id}, extra_patch)
    except Exception:
        pass

    fallback_row = await _select_profile_for_approval(user_id)
    if fallback_row:
        return _from_profile_row(fallback_row)
    return {"user_id": user_id, **payload}


async def get_ambulance_registration_request(user_id: str) -> dict[str, Any] | None:
    user_id = str(user_id or "").strip()
    if not user_id:
        return None
    rows, code = await db_select(_TABLE, {"user_id": user_id})
    if code in (200, 206) and rows:
        row = dict(rows[0])
        row["status"] = _normalize_status(row.get("status"))
        return row

    if not _is_missing_relation(code, rows):
        return None

    profile_row = await _select_profile_for_approval(user_id)
    if not profile_row:
        return None
    return _from_profile_row(profile_row)


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
    if code in (200, 206) and rows:
        normalized: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            item["status"] = _normalize_status(item.get("status"))
            normalized.append(item)
        return normalized

    if not _is_missing_relation(code, rows):
        return []

    profile_params: dict[str, str] = {
        "role": "eq.ambulance",
        "order": "updated_at.desc",
    }
    if hospital_id_norm:
        profile_params["hospital_id"] = f"eq.{hospital_id_norm}"
    if status_norm:
        profile_params["approval_status"] = f"eq.{status_norm}"

    full_columns = (
        "id,role,hospital_id,full_name,phone,approval_status,"
        "vehicle_number,registration_number,ambulance_type,created_at,updated_at"
    )
    profile_rows, profile_code = await db_query(_PROFILE_TABLE, columns=full_columns, params=profile_params)
    if profile_code not in (200, 206):
        profile_rows, profile_code = await db_query(
            _PROFILE_TABLE,
            columns="id,role,hospital_id,full_name,phone,approval_status,created_at,updated_at",
            params=profile_params,
        )
    if profile_code not in (200, 206) or not profile_rows:
        return []

    output: list[dict[str, Any]] = []
    for row in profile_rows:
        item = _from_profile_row(dict(row))
        if str(item.get("user_id") or ""):
            output.append(item)
    return output


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
    if code in (200, 204):
        return await get_ambulance_registration_request(user_id)

    if not _is_missing_relation(code, None):
        return None

    profile_patch = {
        "approval_status": normalized_status,
        "updated_at": now,
    }
    _, profile_code = await db_update(_PROFILE_TABLE, {"id": user_id}, profile_patch)
    if profile_code not in (200, 204):
        return None
    return await get_ambulance_registration_request(user_id)
