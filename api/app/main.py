from __future__ import annotations

import asyncio
import logging
import sys
from contextlib import asynccontextmanager

import psycopg
from fastapi import APIRouter, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg_pool import PoolTimeout

from . import db
from .config import settings
from .routers import annotate, contributors, export, items, llm, me, projects, review, stats, users
from .services import groq, jobs

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("arbiter")


@asynccontextmanager
async def lifespan(app: FastAPI):
    if sys.platform == "win32" and isinstance(asyncio.get_running_loop(), getattr(asyncio, "ProactorEventLoop", ())):
        log.error("psycopg cannot run on the Windows Proactor event loop. Start the API with "
                  "`python run.py` or `python -m uvicorn app.main:app --reload`.")
    await db.open_pool()  # non-blocking: connections are established in the background
    try:
        yield
    finally:
        await jobs.shutdown()
        await groq.close_client()
        await db.close_pool()


app = FastAPI(title="Arbiter API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


def _format_validation(exc: RequestValidationError) -> str:
    parts = []
    for err in exc.errors():
        loc = [str(x) for x in err.get("loc", ()) if x not in ("body", "query", "path")]
        msg = err.get("msg", "invalid value")
        msg = msg.removeprefix("Value error, ")
        parts.append(f"{'.'.join(loc)}: {msg}" if loc else msg)
    return "; ".join(parts) or "Invalid request"


@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    return JSONResponse(status_code=400, content={"detail": _format_validation(exc)})


@app.exception_handler(psycopg.errors.UniqueViolation)
async def unique_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=409, content={"detail": "Conflict: this record already exists"})


@app.exception_handler(psycopg.errors.ForeignKeyViolation)
async def fk_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=409, content={"detail": "Conflict: a referenced record does not exist"})


@app.exception_handler(psycopg.errors.CheckViolation)
async def check_handler(request: Request, exc: Exception):
    return JSONResponse(status_code=400, content={"detail": "A value is outside the allowed range"})


@app.exception_handler(psycopg.OperationalError)
@app.exception_handler(PoolTimeout)
async def db_down_handler(request: Request, exc: Exception):
    log.error("database unavailable: %s", exc)
    return JSONResponse(status_code=503, content={"detail": "Database is unavailable"})


@app.exception_handler(Exception)
async def unhandled_handler(request: Request, exc: Exception):
    log.exception("unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


api = APIRouter(prefix="/api/v1")


@api.get("/health", tags=["health"])
async def health():
    return {"ok": True}


for r in (me, users, projects, items, llm, annotate, contributors, stats, review, export):
    api.include_router(r.router)

app.include_router(api)
