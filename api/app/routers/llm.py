from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from .. import db
from ..auth import require_admin, require_staff
from ..common import get_project, parse_uuid
from ..config import settings
from ..db import Jsonb
from ..services import groq, jobs
from ..services.judge import judge_item
from ..services.jobs import JOB_COLS

router = APIRouter(tags=["llm"])


class GenerateInput(BaseModel):
    model_a: str = Field(min_length=1, max_length=200)
    model_b: str = Field(min_length=1, max_length=200)
    overwrite: bool = False
    system_prompt: str | None = Field(default=None, max_length=20_000)
    max_tokens: int = Field(default=700, ge=16, le=8192)


class JudgeInput(BaseModel):
    model: str | None = Field(default=None, max_length=200)
    both_orders: bool = True
    overwrite: bool = False


def _require_key(*models: str) -> None:
    for m in models:
        if m.startswith(groq.OPENROUTER_PREFIX):
            if not settings.openrouter_api_key:
                raise HTTPException(status_code=400, detail="OPENROUTER_API_KEY is not configured on the API server")
        elif not settings.groq_api_key:
            raise HTTPException(status_code=400, detail="GROQ_API_KEY is not configured on the API server")


@router.get("/llm/models")
async def list_models(_: dict = Depends(require_admin)):
    return await groq.list_models()


@router.post("/projects/{project_id}/generate", status_code=201)
async def generate(project_id: str, body: GenerateInput, admin: dict = Depends(require_admin)):
    _require_key(body.model_a.strip(), body.model_b.strip())
    project = await get_project(project_id)
    cond = "" if body.overwrite else "and (coalesce(response_a, '') = '' or coalesce(response_b, '') = '')"
    items = await db.fetch_all(
        f"select id, prompt from items where project_id = %s and not is_gold {cond} order by created_at, id",
        (project["id"],),
    )
    if not items:
        raise HTTPException(status_code=400, detail="No items need responses")
    model_a, model_b = body.model_a.strip(), body.model_b.strip()
    system_prompt = (body.system_prompt or "").strip()
    params = {"model_a": model_a, "model_b": model_b, "overwrite": body.overwrite,
              "system_prompt": system_prompt or None, "max_tokens": body.max_tokens}
    job = await jobs.create_job(project["id"], "generate", len(items), params, admin["id"])

    async def worker(item: dict) -> None:
        messages = ([{"role": "system", "content": system_prompt}] if system_prompt else []) + [
            {"role": "user", "content": item["prompt"]}
        ]
        ra, rb = await asyncio.gather(
            groq.chat(model_a, messages, temperature=0.7, max_tokens=body.max_tokens),
            groq.chat(model_b, messages, temperature=0.7, max_tokens=body.max_tokens),
        )
        if not ra or not rb:
            raise groq.GroqError("Model returned an empty response")
        await db.execute(
            "update items set response_a = %s, response_b = %s, model_a = %s, model_b = %s where id = %s",
            (ra, rb, model_a, model_b, item["id"]),
        )

    jobs.start_job(job["id"], items, worker)
    return job


@router.post("/projects/{project_id}/judge", status_code=201)
async def run_judge(project_id: str, body: JudgeInput, admin: dict = Depends(require_admin)):
    project = await get_project(project_id)
    model = (body.model or project["judge_model"]).strip()
    _require_key(model)
    cond = "" if body.overwrite else (
        "and not exists (select 1 from llm_judgments l where l.item_id = i.id and l.model = %(model)s)")
    items = await db.fetch_all(
        f"""select i.id, i.prompt, i.response_a, i.response_b from items i
             where i.project_id = %(pid)s and coalesce(i.response_a, '') <> '' and coalesce(i.response_b, '') <> ''
             {cond} order by i.created_at, i.id""",
        {"pid": project["id"], "model": model},
    )
    if not items:
        raise HTTPException(status_code=400, detail="No items to judge (items need both responses)")
    params = {"model": model, "both_orders": body.both_orders, "overwrite": body.overwrite}
    job = await jobs.create_job(project["id"], "judge", len(items), params, admin["id"])
    instructions, rubric = project["instructions"], project["rubric"] or []

    async def worker(item: dict) -> None:
        v = await judge_item(model, instructions, rubric, item["prompt"], item["response_a"], item["response_b"],
                             both_orders=body.both_orders)
        await db.execute(
            """insert into llm_judgments (project_id, item_id, model, preference, criteria, rationale, consistent, raw)
               values (%s, %s, %s, %s, %s, %s, %s, %s)
               on conflict (item_id, model) do update set preference = excluded.preference,
                 criteria = excluded.criteria, rationale = excluded.rationale, consistent = excluded.consistent,
                 raw = excluded.raw, created_at = now()""",
            (project["id"], item["id"], model, v["preference"], Jsonb(v["criteria"]), v["rationale"],
             v["consistent"], Jsonb(v["raw"])),
        )

    jobs.start_job(job["id"], items, worker)
    return job


@router.get("/projects/{project_id}/jobs")
async def list_jobs(project_id: str, _: dict = Depends(require_staff)):
    project = await get_project(project_id)
    return await db.fetch_all(
        f"select {JOB_COLS} from jobs where project_id = %s order by created_at desc limit 20", (project["id"],)
    )


@router.post("/jobs/{job_id}/cancel")
async def cancel_job(job_id: str, _: dict = Depends(require_admin)):
    jid = parse_uuid(job_id, "Job")
    row = await db.fetch_one(
        f"""update jobs set status = 'cancelled', finished_at = now()
             where id = %s and status in ('queued', 'running') returning {JOB_COLS}""",
        (jid,),
    )
    if row:
        return row
    existing = await db.fetch_one(f"select {JOB_COLS} from jobs where id = %s", (jid,))
    if not existing:
        raise HTTPException(status_code=404, detail="Job not found")
    raise HTTPException(status_code=409, detail=f"Job is already {existing['status']}")
