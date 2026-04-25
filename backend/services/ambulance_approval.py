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


def _is_missing_column(code: int, payload: Any, column_name: str) -> bool:
    if code != 400:
        return False

    candidate: dict[str, Any] | None = None
    if isinstance(payload, dict):
        candidate = payload
    elif isinstance(payload, list) and payload and isinstance(payload[0], dict):
        candidate = payload[0]

    if not candidate:
        return False

    err_code = str(candidate.get("code") or "").strip()
    message = str(candidate.get("message") or "").strip().lower()
    return err_code == "42703" and column_name.lower() in message


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


async def _infer_profile_status_and_hospital(
    user_id: str,
    profile_hospital_id: str | None,
) -> tuple[str, str | None]:
    # If an ambulance row is linked to this driver, treat it as approved.
    rows, code = await db_query(
        "ambulances",
        columns="hospital_id",
        params={
            "current_driver_id": f"eq.{user_id}",
            "order": "updated_at.desc",
            "limit": "1",
        },
    )
    if code in (200, 206) and rows:
        inferred_hospital = str(rows[0].get("hospital_id") or "").strip() or None
        return "approved", inferred_hospital or profile_hospital_id

    return "pending", profile_hospital_id


async def _profile_row_to_request(row: dict[str, Any]) -> dict[str, Any]:
    item = _from_profile_row(row)
    explicit = _normalize_status(row.get("approval_status"))
    if explicit in ("approved", "rejected"):
        item["status"] = explicit
        return item

    inferred_status, inferred_hospital = await _infer_profile_status_and_hospital(
        str(item.get("user_id") or ""),
        str(item.get("hospital_id") or "").strip() or None,
    )
    item["status"] = inferred_status
    if inferred_hospital and not str(item.get("hospital_id") or "").strip():
        item["hospital_id"] = inferred_hospital
    return item


_PROFILE_COLS_FULL = (
    "id,role,hospital_id,full_name,phone,vehicle_number,registration_number,"
    "ambulance_type,approval_status,created_at,updated_at"
)
_PROFILE_COLS_MIN = "id,role,hospital_id,full_name,phone,created_at,updated_at"


def _overlay_profile_fields(target: dict[str, Any], profile_row: dict[str, Any]) -> None:
    """Fill empty request-row fields from `profiles` (same user)."""
    for key in ("vehicle_number", "registration_number", "full_name", "phone"):
        raw = profile_row.get(key)
        if raw is None:
            continue
        s = str(raw).strip()
        if not s:
            continue
        cur = target.get(key)
        if cur is None or str(cur).strip() == "":
            target[key] = s
    at_raw = profile_row.get("ambulance_type")
    if at_raw is not None:
        at = str(at_raw).strip()
        if at and (
            target.get("ambulance_type") is None
            or str(target.get("ambulance_type") or "").strip() == ""
        ):
            target["ambulance_type"] = at


async def _select_profile_for_approval(user_id: str) -> dict[str, Any] | None:
    for cols in (_PROFILE_COLS_FULL, _PROFILE_COLS_MIN):
        rows, code = await db_select(_PROFILE_TABLE, {"id": user_id}, columns=cols)
        if code in (200, 206) and rows:
            row = dict(rows[0])
            if str(row.get("role") or "").strip().lower() not in ("ambulance", "driver"):
                return None
            return row
    return None


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

    try:
        await db_update(
            _PROFILE_TABLE,
            {"id": user_id},
            {"approval_status": "pending", "updated_at": now},
        )
    except Exception:
        pass

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
        return await _profile_row_to_request(fallback_row)
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

    # Same as list: table may exist while this driver's row only exists in `profiles`.
    use_profile_fallback = _is_missing_relation(code, rows) or (
        code in (200, 206) and not (rows or [])
    )
    if not use_profile_fallback:
        return None

    profile_row = await _select_profile_for_approval(user_id)
    if not profile_row:
        return None
    return await _profile_row_to_request(profile_row)


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
    combined: list[dict[str, Any]] = []
    seen_user: set[str] = set()
    if code in (200, 206) and rows:
        for row in rows:
            item = dict(row)
            item["status"] = _normalize_status(item.get("status"))
            uid = str(item.get("user_id") or "").strip()
            if uid:
                seen_user.add(uid)
            combined.append(item)

    # Use profiles when: relation missing / no table rows, OR pending list for a hospital (merge
    # drivers only stored on `profiles`, and include role=driver — not only role=ambulance).
    use_profiles = (
        _is_missing_relation(code, rows)
        or (code in (200, 206) and not (rows or []))
        or (bool(hospital_id_norm) and status_norm == "pending")
    )
    if not use_profiles:
        return combined

    profile_params: dict[str, str] = {
        "or": "(role.eq.ambulance,role.eq.driver)",
        "order": "updated_at.desc",
    }
    if hospital_id_norm:
        profile_params["hospital_id"] = f"eq.{hospital_id_norm}"
    # For pending: do NOT filter `approval_status=eq.pending` in SQL — new rows often have
    # NULL there; PostgREST excludes NULL on eq.pending. Filter pending in Python below.
    if status_norm and status_norm != "pending":
        profile_params["approval_status"] = f"eq.{status_norm}"

    # Prefer full profile columns so plate / registration / type show on the hospital UI.
    # Fall back to MIN if optional columns are missing on older DBs.
    profile_rows: list[Any] = []
    profile_code = 0
    for cols in (_PROFILE_COLS_FULL, _PROFILE_COLS_MIN):
        profile_rows, profile_code = await db_query(
            _PROFILE_TABLE,
            columns=cols,
            params=profile_params,
        )
        if profile_code in (200, 206):
            profile_rows = list(profile_rows or [])
            break
        profile_rows = []

    if profile_code not in (200, 206) or not profile_rows:
        return combined

    combined_by_uid: dict[str, dict[str, Any]] = {}
    for it in combined:
        u = str(it.get("user_id") or "").strip()
        if u:
            combined_by_uid[u] = it

    for row in profile_rows:
        prow = dict(row)
        uid = str(prow.get("id") or "").strip()
        if not uid:
            continue
        if uid in combined_by_uid:
            # Request row exists but may omit plate/registration stored only on profiles.
            _overlay_profile_fields(combined_by_uid[uid], prow)
            continue

        item = await _profile_row_to_request(prow)
        if status_norm and item.get("status") != status_norm:
            continue
        seen_user.add(uid)
        combined.append(item)

    return combined


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
    result, code = await db_update(_TABLE, {"user_id": user_id}, payload)
    table_rows = 0
    if isinstance(result, list):
        table_rows = len([r for r in result if isinstance(r, dict)])
    elif isinstance(result, dict) and result:
        err = str(result.get("code") or "")
        if not (err.upper().startswith("PGRST") or err in ("42703", "42P01")):
            table_rows = 1

    if code in (200, 204) and table_rows > 0:
        return await get_ambulance_registration_request(user_id)

    # Table exists but no row for this user (PATCH matched 0 rows) → persist on profile.
    if code in (200, 204) and table_rows == 0:
        pass
    elif not _is_missing_relation(code, result):
        return None

    profile_patch = {
        "approval_status": normalized_status,
        "updated_at": now,
    }
    profile_result, profile_code = await db_update(_PROFILE_TABLE, {"id": user_id}, profile_patch)
    if profile_code in (200, 204):
        return await get_ambulance_registration_request(user_id)

    if _is_missing_column(profile_code, profile_result, "approval_status"):
        # Schema lacks approval_status. Return synthetic row so ops route can
        # continue with ambulance/profile linkage updates.
        synthetic = dict(existing)
        synthetic["status"] = normalized_status
        synthetic["updated_at"] = now
        synthetic["reviewed_at"] = now if normalized_status in ("approved", "rejected") else None
        synthetic["reviewed_by"] = str(reviewed_by or "").strip() or None
        synthetic["review_note"] = str(review_note or "").strip() or None
        return synthetic

    return None
