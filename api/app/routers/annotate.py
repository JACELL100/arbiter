from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ..auth import current_user
from ..common import get_project
from ..services import assignment

router = APIRouter(tags=["annotate"])


class SubmitInput(BaseModel):
    choice: int = Field(ge=-2, le=2)
    criteria: dict[str, Any] = Field(default_factory=dict)
    reason: str = Field(default="", max_length=20_000)
    duration_ms: int = Field(ge=0, le=86_400_000)
    flagged: bool = False
    flag_note: str | None = Field(default=None, max_length=5_000)


class SkipInput(BaseModel):
    reason: str | None = Field(default=None, max_length=5_000)


@router.post("/projects/{project_id}/next")
async def next_task(project_id: str, user: dict = Depends(current_user)):
    project = await get_project(project_id)
    return await assignment.next_task(project, user)


@router.post("/assignments/{assignment_id}/submit")
async def submit(assignment_id: str, body: SubmitInput, user: dict = Depends(current_user)):
    return await assignment.submit(
        assignment_id, user, body.choice, body.criteria, body.reason, body.duration_ms, body.flagged, body.flag_note
    )


@router.post("/assignments/{assignment_id}/skip")
async def skip(assignment_id: str, body: SkipInput | None = None, user: dict = Depends(current_user)):
    return await assignment.skip(assignment_id, user)
