"""
FastAPI dependency — verifies Supabase JWTs so protected routes know
exactly which authenticated user is making the request.

Verification is done **locally** using the JWT secret, avoiding any
network round-trip to Supabase. This is faster and immune to timeouts.

Usage:
    @router.get("/me")
    async def me(current_user: dict = Depends(get_current_user)):
        user_id = current_user["sub"]
"""

import logging

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from config import settings

logger = logging.getLogger("deps")
_bearer = HTTPBearer(auto_error=True)


async def get_current_user(
    creds: HTTPAuthorizationCredentials = Depends(_bearer),
) -> dict:
    """
    Verify the Supabase JWT locally using the JWT secret.
    Returns a dict with at least {"sub": "<user-uuid>"}.
    Raises HTTP 401 on any failure.
    """
    token = creds.credentials
    try:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired.",
        )
    except jwt.InvalidTokenError as exc:
        logger.warning("JWT validation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing user identity.",
        )
    return payload
