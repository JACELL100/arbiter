from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from .. import db
from ..auth import PROFILE_COLS, current_user
from ..services import stats as st

router = APIRouter(tags=["me"])


class MeUpdate(BaseModel):
    full_name: str | None = Field(default=None, max_length=200)


@router.get("/me")
async def get_me(user: dict = Depends(current_user)):
    return user


@router.patch("/me")
async def update_me(body: MeUpdate, user: dict = Depends(current_user)):
    if "full_name" not in body.model_fields_set:
        return user
    name = body.full_name.strip() if body.full_name else None
    return await db.fetch_one(
        f"update profiles set full_name = %s where id = %s returning {PROFILE_COLS}", (name or None, user["id"])
    )


@router.get("/me/stats")
async def my_stats(user: dict = Depends(current_user)):
    uid = user["id"]
    async with db.connection() as conn:
        mine = await (await conn.execute(
            """select j.item_id, j.user_id, j.project_id, j.preference, j.swapped, j.too_fast, j.is_gold,
                      j.gold_correct, j.duration_ms, j.created_at
                 from judgments j where j.user_id = %s""",
            (uid,),
        )).fetchall()
        others = await (await conn.execute(
            """select o.item_id, o.user_id, o.preference from judgments o
                where not o.is_gold
                  and o.item_id in (select item_id from judgments where user_id = %s and not is_gold)""",
            (uid,),
        )).fetchall()
        projects = await (await conn.execute(
            """select p.id, p.name, coalesce(pc.status, 'active') as status
                 from projects p
                 left join project_contributors pc on pc.project_id = p.id and pc.user_id = %s
                where p.id in (select distinct project_id from judgments where user_id = %s)
                order by p.name""",
            (uid, uid),
        )).fetchall()
    prefs_by_item: dict = defaultdict(list)
    for o in others:
        prefs_by_item[o["item_id"]].append((o["user_id"], int(o["preference"])))
    by_project: dict = defaultdict(list)
    for j in mine:
        by_project[j["project_id"]].append(j)
    out = []
    for p in projects:
        m = st.contributor_metrics(by_project.get(p["id"], []), prefs_by_item)
        out.append({
            "project_id": p["id"],
            "project_name": p["name"],
            "judgments": m["judgments"],
            "gold_accuracy": m["gold_accuracy"],
            "golds": m["golds"],
            "too_fast_rate": m["too_fast_rate"],
            "agreement_rate": m["agreement_rate"],
            "median_seconds": m["median_seconds"],
            "status": p["status"],
        })
    return {"total_judgments": len(mine), "projects": out}
