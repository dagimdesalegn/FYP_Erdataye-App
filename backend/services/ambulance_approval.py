from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from threading import Lock
from typing import Any

from services.supabase import db_query, db_select, db_update, db_upsert

_APPROVALS_FILE = os.path.join(os.path.dirname(__file__), "..", "_ambulance_approvals.json")
_APPROVALS_LOCK = Lock()
_APPROVALS_TABLE = "ambulance_registration_requests"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _load() -> dict[str, dict[str, Any]]:
    try:
        with open(_APPROVALS_FILE, "r", encoding="utf-8") as handle:
            payload = json.load(handle)
            if isinstance(payload, dict):
                return {
                    str(k): v
                    for k, v in payload.items()
                    if isinstance(v, dict)
                }
    except (FileNotFoundError, OSError, json.JSONDecodeError):
        return {}
    return {}


def _save(records: dict[str, dict[str, Any]]) -> None:
    with open(_APPROVALS_FILE, "w", encoding="utf-8") as handle:
        json.dump(records, handle, ensure_ascii=True)


def _build_record(
    *,
    existing: dict[str, Any] | None,
    user_id: str,
    hospital_id: str,
    full_name: str,
    phone: str,
    vehicle_number: str,
    registration_number: str,
    ambulance_type: str,
) -> dict[str, Any]:
    now = _now_iso()
    current = existing or {}
    return {
        **current,
        "user_id": user_id,
        "hospital_id": str(hospital_id or "").strip(),
        "full_name": str(full_name or "").strip(),
        "phone": str(phone or "").strip(),
        "vehicle_number": str(vehicle_number or "").strip(),
        "registration_number": str(registration_number or "").strip(),
        "ambulance_type": str(ambulance_type or "standard").strip() or "standard",
        "status": "pending",
        "requested_at": current.get("requested_at") or now,
        "updated_at": now,
        "reviewed_at": None,
        "reviewed_by": None,
        "review_note": None,
    }


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

    record: dict[str, Any]
    with _APPROVALS_LOCK:
        records = _load()
        existing = records.get(user_id, {})
        record = _build_record(
            existing=existing,
            user_id=user_id,
            hospital_id=hospital_id,
            full_name=full_name,
            phone=phone,
            vehicle_number=vehicle_number,
            registration_number=registration_number,
            ambulance_type=ambulance_type,
        )
        records[user_id] = record
        _save(records)

    try:
        db_rows, db_code = await db_upsert(
            _APPROVALS_TABLE,
            record,
            on_conflict="user_id",
        )
        if db_code in (200, 201):
            if isinstance(db_rows, list) and db_rows:
                return dict(db_rows[0])
            if isinstance(db_rows, dict):
                return dict(db_rows)
    except Exception:
        pass

    return record


async def get_ambulance_registration_request(user_id: str) -> dict[str, Any] | None:
    user_id = str(user_id or "").strip()
    if not user_id:
        return None

    try:
        rows, code = await db_select(_APPROVALS_TABLE, {"user_id": user_id})
        if code in (200, 206) and rows:
            return dict(rows[0])
    except Exception:
        pass

    with _APPROVALS_LOCK:
        records = _load()
        row = records.get(user_id)
        return dict(row) if isinstance(row, dict) else None


async def list_ambulance_registration_requests(
    *,
    hospital_id: str | None = None,
    status: str | None = None,
) -> list[dict[str, Any]]:
    hospital_id_norm = str(hospital_id or "").strip()
    status_norm = str(status or "").strip().lower()

    try:
        params: dict[str, str] = {"order": "requested_at.desc"}
        if hospital_id_norm:
            params["hospital_id"] = f"eq.{hospital_id_norm}"
        if status_norm:
            params["status"] = f"eq.{status_norm}"
        rows, code = await db_query(_APPROVALS_TABLE, params=params)
        if code in (200, 206) and rows:
            return [dict(row) for row in rows if isinstance(row, dict)]
    except Exception:
        pass

    with _APPROVALS_LOCK:
        records = _load()

    rows = []
    for row in records.values():
        if not isinstance(row, dict):
            continue
        if hospital_id_norm and str(row.get("hospital_id") or "").strip() != hospital_id_norm:
            continue
        if status_norm and str(row.get("status") or "").strip().lower() != status_norm:
            continue
        rows.append(dict(row))

    rows.sort(key=lambda item: str(item.get("requested_at") or ""), reverse=True)
    return rows


async def set_ambulance_registration_status(
    *,
    user_id: str,
    status: str,
    reviewed_by: str,
    review_note: str | None = None,
) -> dict[str, Any] | None:
    user_id = str(user_id or "").strip()
    normalized_status = str(status or "").strip().lower()
    if normalized_status not in ("pending", "approved", "rejected"):
        raise ValueError("status must be pending, approved, or rejected")
    if not user_id:
        return None

    now = _now_iso()

    try:
        db_rows, db_code = await db_update(
            _APPROVALS_TABLE,
            {"user_id": user_id},
            {
                "status": normalized_status,
                "updated_at": now,
                "reviewed_at": now if normalized_status in ("approved", "rejected") else None,
                "reviewed_by": str(reviewed_by or "").strip() or None,
                "review_note": str(review_note or "").strip() or None,
            },
        )
        if db_code in (200, 206):
            if isinstance(db_rows, list) and db_rows:
                updated = dict(db_rows[0])
            elif isinstance(db_rows, dict):
                updated = dict(db_rows)
            else:
                updated = None
            if updated:
                with _APPROVALS_LOCK:
                    records = _load()
                    records[user_id] = updated
                    _save(records)
                return updated
    except Exception:
        pass

    with _APPROVALS_LOCK:
        records = _load()
        existing = records.get(user_id)
        if not isinstance(existing, dict):
            return None
        updated = {
            **existing,
            "status": normalized_status,
            "updated_at": now,
            "reviewed_at": now if normalized_status in ("approved", "rejected") else None,
            "reviewed_by": str(reviewed_by or "").strip() or None,
            "review_note": str(review_note or "").strip() or None,
        }
        records[user_id] = updated
        _save(records)
        return updated
