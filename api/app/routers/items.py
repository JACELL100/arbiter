from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field, model_validator

from .. import db
from ..auth import require_admin, require_staff
from ..common import (
    ITEM_COLS, JUDGMENT_COLS, LLM_COLS, REVIEW_COLS, get_item, get_project, item_row, load_item_context,
)
from ..db import Jsonb
from ..services.stats import pick_llm
from ..services.upload import MAX_BYTES, UploadError, parse_upload

router = APIRouter(tags=["items"])


class ItemCreate(BaseModel):
    prompt: str = Field(min_length=1, max_length=100_000)
    response_a: str | None = Field(default=None, max_length=200_000)
    response_b: str | None = Field(default=None, max_length=200_000)
    model_a: str | None = Field(default=None, max_length=200)
    model_b: str | None = Field(default=None, max_length=200)
    is_gold: bool = False
    gold_preference: Literal[-1, 0, 1] | None = None
    gold_explanation: str | None = Field(default=None, max_length=20_000)

    @model_validator(mode="after")
    def _gold(self):
        for f in ("prompt", "response_a", "response_b", "model_a", "model_b", "gold_explanation"):
            v = getattr(self, f)
            if isinstance(v, str):
                setattr(self, f, v.strip() or None)
        if not self.prompt:
            raise ValueError("prompt is required")
        if self.is_gold:
            if self.gold_preference is None:
                raise ValueError("gold items need gold_preference (-1, 0 or 1)")
            if not self.response_a or not self.response_b:
                raise ValueError("gold items need both responses")
        else:
            self.gold_preference = None
            self.gold_explanation = None
        return self


class ReviewInput(BaseModel):
    final_preference: int = Field(ge=-2, le=2)
    note: str = Field(default="", max_length=10_000)


def _escape_like(q: str) -> str:
    return q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def disputed_rows(project: dict) -> list[dict]:
    """All open (unreviewed) disputed items with reasons, oldest first. Shared by items filter + review queue."""
    items = await db.fetch_all(
        f"select {ITEM_COLS} from items where project_id = %s and not is_gold order by created_at, id",
        (project["id"],),
    )
    j_by, llm_by, rev_by = await load_item_context(project)
    rows = [item_row(project, it, j_by, llm_by, rev_by, with_reasons=True) for it in items]
    return [r for r in rows if r["disputed"]]


@router.get("/projects/{project_id}/items")
async def list_items(
    project_id: str,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    filter: Literal["all", "gold", "pending", "disputed"] = "all",
    q: str = "",
    _: dict = Depends(require_staff),
):
    project = await get_project(project_id)
    q = q.strip()
    if filter == "disputed":
        rows = await disputed_rows(project)
        if q:
            ql = q.lower()
            rows = [r for r in rows if ql in r["prompt"].lower()]
        for r in rows:
            r.pop("reasons", None)
        return {"items": rows[offset: offset + limit], "total": len(rows)}

    where = ["project_id = %s"]
    params: list = [project["id"]]
    if filter == "gold":
        where.append("is_gold")
    elif filter == "pending":
        where.append("(coalesce(response_a, '') = '' or coalesce(response_b, '') = '')")
    if q:
        where.append("prompt ilike %s escape '\\'")
        params.append(f"%{_escape_like(q)}%")
    w = " and ".join(where)
    async with db.connection() as conn:
        total = (await (await conn.execute(f"select count(*)::int as n from items where {w}", params)).fetchone())["n"]
        items = await (await conn.execute(
            f"select {ITEM_COLS} from items where {w} order by created_at, id limit %s offset %s",
            [*params, limit, offset],
        )).fetchall()
    j_by, llm_by, rev_by = await load_item_context(project, [i["id"] for i in items])
    return {"items": [item_row(project, it, j_by, llm_by, rev_by) for it in items], "total": total}


@router.post("/projects/{project_id}/items/upload")
async def upload_items(project_id: str, file: UploadFile = File(...), _: dict = Depends(require_admin)):
    project = await get_project(project_id)
    data = await file.read(MAX_BYTES + 1)
    try:
        rows, errors = parse_upload(file.filename or "", data)
    except UploadError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if rows:
        params = [
            (project["id"], r["prompt"], r["response_a"], r["response_b"], r["model_a"], r["model_b"], r["is_gold"],
             r["gold_preference"], r["gold_explanation"], Jsonb(r["metadata"]))
            for r in rows
        ]
        async with db.connection() as conn:
            async with conn.transaction():
                async with conn.cursor() as cur:
                    await cur.executemany(
                        """insert into items (project_id, prompt, response_a, response_b, model_a, model_b, is_gold,
                                              gold_preference, gold_explanation, metadata)
                           values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                        params,
                    )
    return {"inserted": len(rows), "skipped": len(errors), "errors": errors[:200]}


@router.post("/projects/{project_id}/items", status_code=201)
async def create_item(project_id: str, body: ItemCreate, _: dict = Depends(require_admin)):
    project = await get_project(project_id)
    return await db.fetch_one(
        f"""insert into items (project_id, prompt, response_a, response_b, model_a, model_b, is_gold,
                               gold_preference, gold_explanation)
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s) returning {ITEM_COLS}""",
        (project["id"], body.prompt, body.response_a, body.response_b, body.model_a, body.model_b, body.is_gold,
         body.gold_preference, body.gold_explanation),
    )


@router.get("/projects/{project_id}/items/{item_id}")
async def get_item_detail(project_id: str, item_id: str, _: dict = Depends(require_staff)):
    project = await get_project(project_id)
    item = await get_item(project["id"], item_id)
    j_cols = ", ".join(f"j.{c.strip()}" for c in JUDGMENT_COLS.split(","))
    async with db.connection() as conn:
        judgments = await (await conn.execute(
            f"""select {j_cols}, p.email as user_email, p.full_name as user_name
                  from judgments j left join profiles p on p.id = j.user_id
                 where j.item_id = %s order by j.created_at""",
            (item["id"],),
        )).fetchall()
        llms = await (await conn.execute(
            f"select {LLM_COLS} from llm_judgments where item_id = %s", (item["id"],))).fetchall()
        review = await (await conn.execute(
            f"select {REVIEW_COLS} from reviews where item_id = %s", (item["id"],))).fetchone()
    llm = pick_llm(llms, project.get("judge_model"))
    row = item_row(project, item, {item["id"]: judgments}, {item["id"]: llm} if llm else {},
                   {item["id"]: review} if review else {}, with_reasons=True)
    return {**row, "judgments": judgments, "llm_judgment": llm, "review": review}


@router.delete("/projects/{project_id}/items/{item_id}")
async def delete_item(project_id: str, item_id: str, _: dict = Depends(require_admin)):
    project = await get_project(project_id)
    item = await get_item(project["id"], item_id)
    await db.execute("delete from items where id = %s", (item["id"],))
    return {"ok": True}


@router.post("/projects/{project_id}/items/{item_id}/review")
async def review_item(project_id: str, item_id: str, body: ReviewInput, user: dict = Depends(require_staff)):
    project = await get_project(project_id)
    item = await get_item(project["id"], item_id)
    return await db.fetch_one(
        f"""insert into reviews (project_id, item_id, reviewer_id, final_preference, note)
            values (%s, %s, %s, %s, %s)
            on conflict (item_id) do update set reviewer_id = excluded.reviewer_id,
                final_preference = excluded.final_preference, note = excluded.note, created_at = now()
            returning {REVIEW_COLS}""",
        (project["id"], item["id"], user["id"], body.final_preference, body.note.strip()),
    )
