"""
FastAPI dependency — verifies Supabase JWTs so protected routes know
exactly which authenticated user is making the request.

Verification is done by calling Supabase's auth.getUser() endpoint, which
works regardless of the JWT signing algorithm (HS256, ES256, etc.).

Usage:
    @router.get("/me")
    async def me(current_user: dict = Depends(get_current_user)):
        user_id = current_user["sub"]
"""

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import settings

_bearer = HTTPBearer(auto_error=True)


async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    """
    Verify the Supabase JWT by calling the Supabase auth API.
    Returns a dict with at least {"sub": "<user-uuid>"}.
    Raises HTTP 401 on any failure.
    """
    token = creds.credentials
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            res = await client.get(
                f"{settings.supabase_url}/auth/v1/user",
                headers={
                    "apikey": settings.supabase_service_role_key,
                    "Authorization": f"Bearer {token}",
                },
            )
        if res.status_code != 200:
            body = res.json() if res.content else {}
            msg = body.get("msg") or body.get("error_description") or "Invalid or expired token"
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=msg,
            )
        user_data = res.json()
        user_id = user_data.get("id")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token missing user identity.",
            )
        return {"sub": user_id, **user_data}
    except httpx.RequestError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Could not reach auth service: {exc}",
        ) from exc
