from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends

from .. import db
from ..auth import require_staff
from ..common import get_project
from ..services.stats import compute_project_stats

router = APIRouter(tags=["stats"])


@router.get("/projects/{project_id}/stats")
async def project_stats(project_id: str, _: dict = Depends(require_staff)):
    project = await get_project(project_id)
    pid = project["id"]
    async with db.connection() as conn:
        items = await (await conn.execute(
            """select id, is_gold, model_a, model_b, judgments_count,
                      coalesce(response_a, '') <> '' as has_a, coalesce(response_b, '') <> '' as has_b
                 from items where project_id = %s""",
            (pid,),
        )).fetchall()
        judgments = await (await conn.execute(
            """select item_id, user_id, preference, criteria, swapped, too_fast, is_gold, gold_correct, flagged,
                      created_at
                 from judgments where project_id = %s""",
            (pid,),
        )).fetchall()
        llm = await (await conn.execute(
            "select item_id, model, preference, consistent, created_at from llm_judgments where project_id = %s",
            (pid,),
        )).fetchall()
        reviews = await (await conn.execute(
            "select item_id, final_preference from reviews where project_id = %s", (pid,)
        )).fetchall()
        paused = (await (await conn.execute(
            "select count(*)::int as n from project_contributors where project_id = %s and status = 'paused'",
            (pid,),
        )).fetchone())["n"]
    for it in items:  # stats only need presence, not the full text
        it["response_a"] = "x" if it.pop("has_a") else None
        it["response_b"] = "x" if it.pop("has_b") else None
    # bootstrap is CPU-bound; keep the event loop responsive
    return await asyncio.to_thread(compute_project_stats, project, items, judgments, llm, reviews, paused)
