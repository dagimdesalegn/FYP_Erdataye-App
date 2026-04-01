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
import time

import httpx
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import MissingCryptographyError

from config import settings
from services.supabase import _client as _shared_client

logger = logging.getLogger("deps")
_bearer = HTTPBearer(auto_error=True)
_JWKS_CACHE_TTL_SECONDS = 3600
_jwks_cache: dict[str, dict] = {}
_jwks_cache_expires_at = 0.0


async def _refresh_jwks_cache() -> None:
    global _jwks_cache, _jwks_cache_expires_at

    response = await _shared_client().get("/auth/v1/.well-known/jwks.json")
    response.raise_for_status()

    body = response.json() if response.content else {}
    keys = body.get("keys") if isinstance(body, dict) else None
    if not isinstance(keys, list):
        raise ValueError("Supabase JWKS response is missing keys")

    parsed_keys: dict[str, dict] = {}
    for jwk_dict in keys:
        if not isinstance(jwk_dict, dict):
            continue
        kid = str(jwk_dict.get("kid") or "").strip()
        if not kid:
            continue
        parsed_keys[kid] = jwk_dict

    if not parsed_keys:
        raise ValueError("Supabase JWKS response did not contain usable keys")

    _jwks_cache = parsed_keys
    _jwks_cache_expires_at = time.time() + _JWKS_CACHE_TTL_SECONDS


async def _get_jwks_signing_key(kid: str) -> object:
    cache_stale = time.time() >= _jwks_cache_expires_at
    if cache_stale or kid not in _jwks_cache:
        await _refresh_jwks_cache()

    jwk_dict = _jwks_cache.get(kid)
    if jwk_dict is None:
        raise KeyError(f"No JWKS key found for kid={kid}")
    return jwt.PyJWK.from_dict(jwk_dict).key


async def _verify_via_supabase_user_endpoint(token: str) -> dict:
    response = await _shared_client().get(
        "/auth/v1/user",
        headers={
            "apikey": settings.supabase_service_role_key,
            "Authorization": f"Bearer {token}",
        },
    )
    if response.status_code != 200:
        body = response.json() if response.content else {}
        message = (
            body.get("msg")
            or body.get("error_description")
            or "Invalid or expired token."
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=message,
        )

    user_data = response.json()
    user_id = user_data.get("id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing user identity.",
        )
    return {"sub": user_id, **user_data}


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
        header = jwt.get_unverified_header(token)
        algorithm = str(header.get("alg") or "").upper()

        if algorithm == "HS256":
            payload = jwt.decode(
                token,
                settings.supabase_jwt_secret,
                algorithms=["HS256"],
                audience="authenticated",
            )
        else:
            kid = str(header.get("kid") or "").strip()
            if not kid:
                raise jwt.InvalidTokenError("Asymmetric token is missing kid header")

            try:
                signing_key = await _get_jwks_signing_key(kid)
            except MissingCryptographyError:
                logger.warning(
                    "cryptography package missing for %s verification; using Supabase fallback",
                    algorithm,
                )
                return await _verify_via_supabase_user_endpoint(token)

            try:
                payload = jwt.decode(
                    token,
                    signing_key,
                    algorithms=[algorithm],
                    audience="authenticated",
                )
            except MissingCryptographyError:
                logger.warning(
                    "cryptography package missing for %s verification; using Supabase fallback",
                    algorithm,
                )
                return await _verify_via_supabase_user_endpoint(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired.",
        )
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        logger.exception("JWKS verification failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Authentication service is temporarily unavailable. Please try again.",
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
