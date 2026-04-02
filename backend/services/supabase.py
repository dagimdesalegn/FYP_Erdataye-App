"""
Async Supabase REST API helper — uses the service-role key for admin operations.
All sensitive credentials stay on the server; the mobile client never sees them.

We use raw httpx calls (instead of the supabase-py library) for:
  • Full async/await support with httpx.AsyncClient
  • Fine-grained control over headers and retry behaviour
  • Compatibility with any Supabase REST API version
"""

import httpx

from config import settings

# ─────────────────────────────────────────────────────────────────────────────
# Shared async client — reuse TCP connections across requests (connection pool)
# ─────────────────────────────────────────────────────────────────────────────

_http: httpx.AsyncClient | None = None


def _client() -> httpx.AsyncClient:
    global _http
    if _http is None or _http.is_closed:
        _http = httpx.AsyncClient(
            base_url=settings.supabase_url,
            headers={
                "apikey": settings.supabase_service_role_key,
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "Content-Type": "application/json",
            },
            timeout=httpx.Timeout(15.0, connect=5.0),
        )
    return _http


async def close_client() -> None:
    """Call on app shutdown to release connection pool."""
    global _http
    if _http and not _http.is_closed:
        await _http.aclose()
        _http = None


# ─────────────────────────────────────────────────────────────────────────────
# Auth Admin helpers
# ─────────────────────────────────────────────────────────────────────────────


async def auth_create_user(
    email: str,
    password: str,
    user_metadata: dict,
) -> tuple[dict, int]:
    """Create a verified user account via the Supabase Auth Admin API."""
    res = await _client().post(
        "/auth/v1/admin/users",
        json={
            "email": email,
            "password": password,
            "email_confirm": True,
            "phone_confirm": True,
            "user_metadata": user_metadata,
        },
    )
    return res.json(), res.status_code


async def auth_sign_in(email: str, password: str) -> tuple[dict, int]:
    """
    Authenticate with email/password using the service-role apikey header,
    which bypasses per-IP rate limits on the GoTrue token endpoint.
    Returns Supabase session tokens.
    """
    res = await _client().post(
        "/auth/v1/token",
        params={"grant_type": "password"},
        json={"email": email, "password": password},
    )
    return res.json(), res.status_code


async def auth_refresh(refresh_token: str) -> tuple[dict, int]:
    """Exchange a refresh token for a new access/refresh token pair."""
    res = await _client().post(
        "/auth/v1/token",
        params={"grant_type": "refresh_token"},
        json={"refresh_token": refresh_token},
    )
    return res.json(), res.status_code


async def auth_update_user(user_id: str, payload: dict) -> tuple[dict, int]:
    """Update a user's attributes via the Supabase Auth Admin API."""
    res = await _client().put(
        f"/auth/v1/admin/users/{user_id}",
        json=payload,
    )
    return res.json(), res.status_code


# ─────────────────────────────────────────────────────────────────────────────
# Database helpers (PostgREST REST API)
# ─────────────────────────────────────────────────────────────────────────────


async def db_upsert(
    table: str,
    payload: dict,
    on_conflict: str = "id",
) -> tuple[dict | list, int]:
    """Upsert a row (insert or update on conflict)."""
    res = await _client().post(
        f"/rest/v1/{table}",
        json=payload,
        headers={
            "Prefer": f"resolution=merge-duplicates,return=representation",
        },
        params={"on_conflict": on_conflict},
    )
    try:
        return res.json(), res.status_code
    except Exception:
        return {}, res.status_code


async def db_select(
    table: str,
    filters: dict[str, str],
    columns: str = "*",
) -> tuple[list, int]:
    """Select rows matching all supplied equality filters."""
    params: dict = {"select": columns}
    for col, val in filters.items():
        params[col] = f"eq.{val}"
    res = await _client().get(f"/rest/v1/{table}", params=params)
    try:
        data = res.json()
        return (data if isinstance(data, list) else [data]), res.status_code
    except Exception:
        return [], res.status_code


async def db_query(
    table: str,
    *,
    columns: str = "*",
    params: dict | None = None,
) -> tuple[list, int]:
    """
    Generic selector with arbitrary PostgREST params (supports ilike/or/order).
    Useful for richer filtering without adding ad-hoc helpers everywhere.
    """
    query_params = {"select": columns, **(params or {})}
    res = await _client().get(f"/rest/v1/{table}", params=query_params)
    try:
        data = res.json()
        return (data if isinstance(data, list) else [data]), res.status_code
    except Exception:
        return [], res.status_code


async def db_update(
    table: str,
    filters: dict[str, str],
    payload: dict,
) -> tuple[dict | list, int]:
    """Patch (partial update) rows matching all supplied equality filters."""
    params: dict = {}
    for col, val in filters.items():
        params[col] = f"eq.{val}"
    res = await _client().patch(
        f"/rest/v1/{table}",
        params=params,
        json=payload,
        headers={"Prefer": "return=representation"},
    )
    try:
        return res.json(), res.status_code
    except Exception:
        return {}, res.status_code


async def db_insert(
    table: str,
    payload: dict | list[dict],
) -> tuple[dict | list, int]:
    """Insert one or more rows (no upsert / conflict handling)."""
    res = await _client().post(
        f"/rest/v1/{table}",
        json=payload,
        headers={"Prefer": "return=representation"},
    )
    try:
        return res.json(), res.status_code
    except Exception:
        return {}, res.status_code


async def db_delete(
    table: str,
    filters: dict[str, str],
) -> tuple[dict | list, int]:
    """Delete rows matching all supplied equality filters."""
    params: dict = {}
    for col, val in filters.items():
        params[col] = f"eq.{val}"
    res = await _client().delete(
        f"/rest/v1/{table}",
        params=params,
        headers={"Prefer": "return=representation"},
    )
    try:
        return res.json(), res.status_code
    except Exception:
        return {}, res.status_code
