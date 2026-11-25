"""Supabase JWT authentication + role dependencies."""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

import httpx
import jwt
from fastapi import Depends, Header, HTTPException

from . import db
from .config import settings

log = logging.getLogger("arbiter.auth")

PROFILE_COLS = "id, email, full_name, avatar_url, role, status, created_at"

_jwks_keys: dict[str, Any] = {}
_jwks_fetched_at: float = 0.0
_jwks_lock = asyncio.Lock()
_user_cache: dict[str, tuple[float, dict]] = {}
USER_CACHE_TTL = 60.0


class _Unverifiable(Exception):
    """Local verification impossible (no secret / no matching key) -> fall back to /auth/v1/user."""


def _unauthorized(msg: str = "Invalid or expired token") -> HTTPException:
    return HTTPException(status_code=401, detail=msg, headers={"WWW-Authenticate": "Bearer"})


async def _load_jwks(force: bool = False) -> dict[str, Any]:
    global _jwks_keys, _jwks_fetched_at
    async with _jwks_lock:
        # avoid hammering the endpoint: at most one forced refetch per 30 s
        if _jwks_keys and not force:
            return _jwks_keys
        if force and time.time() - _jwks_fetched_at < 30 and _jwks_keys:
            return _jwks_keys
        if not settings.supabase_url:
            return {}
        url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(url)
                resp.raise_for_status()
                data = resp.json()
        except Exception as exc:
            log.warning("JWKS fetch failed: %s", exc)
            _jwks_fetched_at = time.time()
            return _jwks_keys
        keys: dict[str, Any] = {}
        for jwk in data.get("keys", []):
            kid = jwk.get("kid")
            if not kid:
                continue
            try:
                keys[kid] = (jwt.PyJWK.from_dict(jwk), jwk.get("alg"))
            except Exception as exc:  # unsupported key type
                log.warning("skipping JWK %s: %s", kid, exc)
        _jwks_keys = keys
        _jwks_fetched_at = time.time()
        return _jwks_keys


async def _verify_local(token: str) -> dict:
    try:
        header = jwt.get_unverified_header(token)
    except jwt.PyJWTError:
        raise _unauthorized()
    alg = header.get("alg")
    opts = {"require": ["exp", "sub"]}
    if alg == "HS256":
        if not settings.supabase_jwt_secret:
            raise _Unverifiable()
        try:
            return jwt.decode(token, settings.supabase_jwt_secret, algorithms=["HS256"],
                              audience="authenticated", options=opts)
        except jwt.ExpiredSignatureError:
            raise _unauthorized("Token expired")
        except jwt.PyJWTError:
            raise _unauthorized()
    kid = header.get("kid")
    if not kid:
        raise _Unverifiable()
    keys = await _load_jwks()
    if kid not in keys:
        keys = await _load_jwks(force=True)
    if kid not in keys:
        raise _Unverifiable()
    pyjwk, key_alg = keys[kid]
    try:
        return jwt.decode(token, pyjwk.key, algorithms=[key_alg or alg], audience="authenticated", options=opts)
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Token expired")
    except jwt.PyJWTError:
        raise _unauthorized()


async def _verify_remote(token: str) -> dict:
    now = time.time()
    cached = _user_cache.get(token)
    if cached and cached[0] > now:
        return cached[1]
    if not settings.supabase_url:
        raise HTTPException(status_code=503, detail="Auth is not configured (SUPABASE_URL missing)")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{settings.supabase_url.rstrip('/')}/auth/v1/user",
                headers={"apikey": settings.supabase_anon_key, "Authorization": f"Bearer {token}"},
            )
    except httpx.HTTPError:
        raise HTTPException(status_code=503, detail="Auth service unavailable")
    if resp.status_code != 200:
        raise _unauthorized()
    user = resp.json()
    claims = {
        "sub": user.get("id"),
        "email": user.get("email"),
        "user_metadata": user.get("user_metadata") or {},
    }
    if len(_user_cache) > 5000:
        for k in [k for k, v in _user_cache.items() if v[0] <= now]:
            _user_cache.pop(k, None)
    _user_cache[token] = (now + USER_CACHE_TTL, claims)
    return claims


async def verify_token(token: str) -> dict:
    try:
        return await _verify_local(token)
    except _Unverifiable:
        return await _verify_remote(token)


async def _load_or_create_profile(claims: dict) -> dict:
    user_id = claims.get("sub")
    if not user_id:
        raise _unauthorized()
    profile = await db.fetch_one(f"select {PROFILE_COLS} from profiles where id = %s", (user_id,))
    if profile:
        return profile
    meta = claims.get("user_metadata") or {}
    if isinstance(meta, str):
        try:
            meta = json.loads(meta)
        except ValueError:
            meta = {}
    async with db.connection() as conn:
        async with conn.transaction():
            # serialize "first user becomes admin" decisions
            await conn.execute("select pg_advisory_xact_lock(hashtext('arbiter_first_admin'))")
            cur = await conn.execute(
                f"""
                insert into profiles (id, email, full_name, avatar_url, role)
                values (%s, %s, %s, %s,
                        case when not exists (select 1 from profiles) then 'admin' else 'contributor' end)
                on conflict (id) do nothing
                returning {PROFILE_COLS}
                """,
                (user_id, claims.get("email"), meta.get("full_name") or meta.get("name"), meta.get("avatar_url")),
            )
            row = await cur.fetchone()
            if row:
                return row
            cur = await conn.execute(f"select {PROFILE_COLS} from profiles where id = %s", (user_id,))
            row = await cur.fetchone()
    if not row:
        raise _unauthorized("Profile could not be created")
    return row


async def current_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise _unauthorized("Missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        raise _unauthorized("Missing bearer token")
    claims = await verify_token(token)
    profile = await _load_or_create_profile(claims)
    if profile["status"] == "suspended":
        raise HTTPException(status_code=403, detail="Your account is suspended")
    return profile


def is_staff(user: dict) -> bool:
    return user["role"] in ("admin", "reviewer")


async def require_staff(user: dict = Depends(current_user)) -> dict:
    if not is_staff(user):
        raise HTTPException(status_code=403, detail="Reviewer or admin role required")
    return user


async def require_admin(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "admin":
        raise HTTPException(status_code=403, detail="Admin role required")
    return user
