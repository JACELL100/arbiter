"""Async Postgres pool (psycopg 3).

The pool is created with ``open=False`` and opened in the app lifespan with ``wait=False``,
so the API starts (and ``/health`` answers) even when DATABASE_URL is missing or unreachable.
``prepare_threshold=None`` keeps us compatible with Supabase's transaction-mode pooler.
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import HTTPException
from psycopg import AsyncConnection
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool, PoolTimeout

from .config import settings

log = logging.getLogger("arbiter.db")

_pool: AsyncConnectionPool | None = None


async def _configure(conn: AsyncConnection) -> None:
    conn.prepare_threshold = None


async def open_pool() -> None:
    global _pool
    if _pool is not None:
        return
    if not settings.database_url:
        log.warning("DATABASE_URL is not set; database endpoints will return 503")
        return
    _pool = AsyncConnectionPool(
        conninfo=settings.database_url,
        min_size=settings.db_pool_min,
        max_size=settings.db_pool_max,
        open=False,
        timeout=15,
        kwargs={"row_factory": dict_row, "prepare_threshold": None, "autocommit": True},
        configure=_configure,
    )
    try:
        await _pool.open(wait=False)
    except Exception as exc:  # pragma: no cover - defensive
        log.error("could not open database pool: %s", exc)


async def close_pool() -> None:
    global _pool
    if _pool is not None:
        await _pool.close()
        _pool = None


def get_pool() -> AsyncConnectionPool:
    if _pool is None:
        raise HTTPException(status_code=503, detail="Database is not configured")
    return _pool


@asynccontextmanager
async def connection() -> AsyncIterator[AsyncConnection]:
    """Autocommit connection: each statement commits on its own.
    Use ``async with conn.transaction():`` for multi-statement writes."""
    pool = get_pool()
    try:
        async with pool.connection() as conn:
            yield conn
    except PoolTimeout:
        raise HTTPException(status_code=503, detail="Database is unavailable")


async def fetch_all(sql: str, params: Any = None) -> list[dict]:
    async with connection() as conn:
        cur = await conn.execute(sql, params)
        return await cur.fetchall()


async def fetch_one(sql: str, params: Any = None) -> dict | None:
    async with connection() as conn:
        cur = await conn.execute(sql, params)
        return await cur.fetchone()


async def execute(sql: str, params: Any = None) -> int:
    async with connection() as conn:
        cur = await conn.execute(sql, params)
        return cur.rowcount


__all__ = ["Jsonb", "connection", "fetch_all", "fetch_one", "execute", "open_pool", "close_pool", "get_pool"]
