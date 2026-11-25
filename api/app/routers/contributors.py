from __future__ import annotations

from collections import defaultdict
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from .. import db
from ..auth import require_admin, require_staff
from ..common import get_project, parse_uuid
from ..services import stats as st

router = APIRouter(tags=["contributors"])


class ContributorUpdate(BaseModel):
    status: Literal["active", "paused"]
    override: bool | None = None


async def contributor_rows(project: dict, only_user: Any = None) -> list[dict]:
    pid = project["id"]
    async with db.connection() as conn:
        judgments = await (await conn.execute(
            """select item_id, user_id, preference, swapped, too_fast, is_gold, gold_correct, duration_ms, created_at
                 from judgments where project_id = %s""",
            (pid,),
        )).fetchall()
        states = await (await conn.execute(
            "select user_id, status, paused_reason, override from project_contributors where project_id = %s",
            (pid,),
        )).fetchall()
        user_ids = list({j["user_id"] for j in judgments} | {s["user_id"] for s in states})
        if only_user is not None:
            user_ids = [only_user]
        profiles = await (await conn.execute(
            "select id, email, full_name from profiles where id = any(%s)", (user_ids,)
        )).fetchall() if user_ids else []

    prefs_by_item: dict = defaultdict(list)
    by_user: dict = defaultdict(list)
    for j in judgments:
        by_user[j["user_id"]].append(j)
        if not j["is_gold"]:
            prefs_by_item[j["item_id"]].append((j["user_id"], int(j["preference"])))
    state_by = {s["user_id"]: s for s in states}
    rows = []
    for p in profiles:
        m = st.contributor_metrics(by_user.get(p["id"], []), prefs_by_item)
        s = state_by.get(p["id"])
        rows.append({
            "user_id": p["id"],
            "email": p["email"],
            "full_name": p["full_name"],
            "judgments": m["judgments"],
            "golds": m["golds"],
            "gold_accuracy": m["gold_accuracy"],
            "too_fast_rate": m["too_fast_rate"],
            "median_seconds": m["median_seconds"],
            "agreement_rate": m["agreement_rate"],
            "left_bias": m["left_bias"],
            "status": s["status"] if s else "active",
            "paused_reason": s["paused_reason"] if s else None,
            "override": bool(s["override"]) if s else False,
            "last_active_at": m["last_active_at"],
        })
    rows.sort(key=lambda r: (-r["judgments"], r["email"] or ""))
    return rows


@router.get("/projects/{project_id}/contributors")
async def list_contributors(project_id: str, _: dict = Depends(require_staff)):
    project = await get_project(project_id)
    return await contributor_rows(project)


@router.patch("/projects/{project_id}/contributors/{user_id}")
async def update_contributor(project_id: str, user_id: str, body: ContributorUpdate, _: dict = Depends(require_admin)):
    project = await get_project(project_id)
    uid = parse_uuid(user_id, "User")
    if not await db.fetch_one("select 1 from profiles where id = %s", (uid,)):
        raise HTTPException(status_code=404, detail="User not found")
    reason = None if body.status == "active" else "paused by an admin"
    await db.execute(
        """insert into project_contributors (project_id, user_id, status, paused_reason, override, updated_at)
           values (%(pid)s, %(uid)s, %(status)s, %(reason)s, coalesce(%(override)s, false), now())
           on conflict (project_id, user_id) do update set
             status = excluded.status,
             paused_reason = excluded.paused_reason,
             override = coalesce(%(override)s, project_contributors.override),
             updated_at = now()""",
        {"pid": project["id"], "uid": uid, "status": body.status, "reason": reason, "override": body.override},
    )
    rows = await contributor_rows(project, only_user=uid)
    return rows[0]
