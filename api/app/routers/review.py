from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from ..auth import require_staff
from ..common import get_project
from .items import disputed_rows

router = APIRouter(tags=["review"])


@router.get("/projects/{project_id}/review-queue")
async def review_queue(
    project_id: str,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _: dict = Depends(require_staff),
):
    project = await get_project(project_id)
    rows = await disputed_rows(project)
    return {"items": rows[offset: offset + limit], "total": len(rows)}
