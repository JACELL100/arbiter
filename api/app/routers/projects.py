from __future__ import annotations

import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator

from .. import db
from ..auth import current_user, is_staff, require_admin
from ..common import PROJECT_COLS, get_project, serialize_project
from ..db import Jsonb

router = APIRouter(tags=["projects"])

_KEY_RE = re.compile(r"^[a-z0-9_][a-z0-9_\-]{0,63}$")


class RubricCriterion(BaseModel):
    key: str = Field(min_length=1, max_length=64)
    label: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=2000)

    @field_validator("key")
    @classmethod
    def _key(cls, v: str) -> str:
        v = v.strip()
        if not _KEY_RE.match(v):
            raise ValueError("rubric key must be lowercase letters, digits, '_' or '-'")
        return v


class ProjectFields(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    instructions: str | None = Field(default=None, max_length=50000)
    rubric: list[RubricCriterion] | None = Field(default=None, max_length=20)
    judgments_per_item: int | None = Field(default=None, ge=1, le=10)
    min_reason_chars: int | None = Field(default=None, ge=0, le=5000)
    min_seconds: int | None = Field(default=None, ge=0, le=3600)
    gold_rate: float | None = Field(default=None, ge=0, le=1)
    gold_min_accuracy: float | None = Field(default=None, ge=0, le=1)
    gold_min_count: int | None = Field(default=None, ge=0, le=1000)
    judge_model: str | None = Field(default=None, min_length=1, max_length=200)

    @field_validator("rubric")
    @classmethod
    def _unique_keys(cls, v):
        if v is not None:
            keys = [c.key for c in v]
            if len(keys) != len(set(keys)):
                raise ValueError("rubric keys must be unique")
        return v


class ProjectCreate(ProjectFields):
    name: str = Field(min_length=1, max_length=200)


class ProjectUpdate(ProjectFields):
    status: Literal["draft", "active", "paused", "completed"] | None = None


def _db_values(body: ProjectFields) -> dict:
    vals = body.model_dump(exclude_unset=True)
    out = {}
    for k, v in vals.items():
        if v is None:
            continue  # columns are NOT NULL; ignore explicit nulls
        if k == "rubric":
            v = Jsonb(v)
        elif k in ("name", "judge_model"):
            v = v.strip()
        out[k] = v
    return out


async def _summaries(user: dict, project_id=None) -> list[dict]:
    where = []
    params: dict = {"uid": user["id"]}
    if not is_staff(user):
        where.append("p.status = 'active'")
    if project_id is not None:
        where.append("p.id = %(pid)s")
        params["pid"] = project_id
    sql = f"""
    select p.*,
      coalesce(i.items_count, 0)::int as items_count,
      coalesce(i.gold_count, 0)::int as gold_count,
      coalesce(i.ready_items_count, 0)::int as ready_items_count,
      coalesce(i.done_capped, 0)::int as done_capped,
      coalesce(j.judgments_count, 0)::int as judgments_count,
      coalesce(j.my_judgments_count, 0)::int as my_judgments_count,
      coalesce(j.contributors_count, 0)::int as contributors_count
    from (select {PROJECT_COLS} from projects) p
    left join (
      select it.project_id,
             count(*) as items_count,
             count(*) filter (where it.is_gold) as gold_count,
             count(*) filter (where not it.is_gold and coalesce(it.response_a, '') <> ''
                                and coalesce(it.response_b, '') <> '') as ready_items_count,
             sum(least(it.judgments_count, pr.judgments_per_item)) filter (
               where not it.is_gold and coalesce(it.response_a, '') <> ''
                 and coalesce(it.response_b, '') <> '') as done_capped
        from items it join projects pr on pr.id = it.project_id
       group by it.project_id
    ) i on i.project_id = p.id
    left join (
      select project_id,
             count(*) as judgments_count,
             count(*) filter (where user_id = %(uid)s) as my_judgments_count,
             count(distinct user_id) as contributors_count
        from judgments group by project_id
    ) j on j.project_id = p.id
    {"where " + " and ".join(where) if where else ""}
    order by p.created_at desc
    """
    rows = await db.fetch_all(sql, params)
    out = []
    for r in rows:
        r = serialize_project(r)
        done = r.pop("done_capped")
        target = r["ready_items_count"] * int(r["judgments_per_item"])
        r["target_judgments"] = target
        r["progress"] = round(min(done / target, 1.0), 4) if target else 0.0
        out.append(r)
    return out


@router.get("/projects")
async def list_projects(user: dict = Depends(current_user)):
    return await _summaries(user)


@router.post("/projects", status_code=201)
async def create_project(body: ProjectCreate, admin: dict = Depends(require_admin)):
    vals = _db_values(body)
    vals["created_by"] = admin["id"]
    cols = ", ".join(vals)
    placeholders = ", ".join(f"%({k})s" for k in vals)
    row = await db.fetch_one(f"insert into projects ({cols}) values ({placeholders}) returning {PROJECT_COLS}", vals)
    return serialize_project(row)


@router.get("/projects/{project_id}")
async def get_project_summary(project_id: str, user: dict = Depends(current_user)):
    project = await get_project(project_id)
    rows = await _summaries(user, project["id"])
    if not rows:
        raise HTTPException(status_code=404, detail="Project not found")
    return rows[0]


@router.patch("/projects/{project_id}")
async def update_project(project_id: str, body: ProjectUpdate, _: dict = Depends(require_admin)):
    project = await get_project(project_id)
    vals = _db_values(body)
    if not vals:
        return project
    sets = ", ".join(f"{k} = %({k})s" for k in vals)  # keys come from the pydantic model, not the user
    vals["id"] = project["id"]
    row = await db.fetch_one(
        f"update projects set {sets}, updated_at = now() where id = %(id)s returning {PROJECT_COLS}", vals
    )
    return serialize_project(row)


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str, _: dict = Depends(require_admin)):
    project = await get_project(project_id)
    await db.execute("delete from projects where id = %s", (project["id"],))
    return {"ok": True}
