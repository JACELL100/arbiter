"""Task assignment and submission for the contributor annotation flow."""
from __future__ import annotations

import random
from typing import Any

from fastapi import HTTPException
from psycopg import AsyncConnection

from .. import db
from ..common import PROJECT_COLS, parse_uuid, serialize_project
from ..db import Jsonb
from .stats import sign

ASSIGNMENT_TTL = "30 minutes"

_READY = "coalesce(i.response_a, '') <> '' and coalesce(i.response_b, '') <> ''"


def _task(project: dict, a: dict, my_judgments: int, remaining: int) -> dict:
    left, right = (a["response_b"], a["response_a"]) if a["swapped"] else (a["response_a"], a["response_b"])
    return {
        "assignment_id": a["assignment_id"],
        "item_id": a["item_id"],
        "project": {k: project[k] for k in ("id", "name", "instructions", "rubric", "min_reason_chars", "min_seconds")},
        "prompt": a["prompt"],
        "left": {"text": left},
        "right": {"text": right},
        "assigned_at": a["assigned_at"],
        "expires_at": a["expires_at"],
        "progress": {"my_judgments": my_judgments, "remaining_items": remaining},
    }


async def _progress(conn: AsyncConnection, project: dict, user_id: Any) -> tuple[int, int]:
    cur = await conn.execute(
        f"""select
              (select count(*) from judgments where project_id = %(pid)s and user_id = %(uid)s)::int as mine,
              (select count(*) from items i
                where i.project_id = %(pid)s and not i.is_gold and {_READY}
                  and not exists (select 1 from assignments a where a.item_id = i.id and a.user_id = %(uid)s)
                  and (select count(*) from assignments a where a.item_id = i.id
                        and a.status in ('assigned', 'submitted')) < %(cap)s)::int as remaining""",
        {"pid": project["id"], "uid": user_id, "cap": project["judgments_per_item"]},
    )
    row = await cur.fetchone()
    return row["mine"], row["remaining"]


_OPEN_SQL = """
select a.id as assignment_id, a.item_id, a.swapped, a.assigned_at, a.expires_at,
       i.prompt, i.response_a, i.response_b
  from assignments a join items i on i.id = a.item_id
 where a.project_id = %s and a.user_id = %s and a.status = 'assigned' and a.expires_at > now()
 order by a.assigned_at desc limit 1
"""


async def _pick(conn: AsyncConnection, project: dict, user_id: Any, gold: bool) -> dict | None:
    cap_cond = "" if gold else (
        "and (select count(*) from assignments a where a.item_id = i.id "
        "and a.status in ('assigned', 'submitted')) < %(cap)s")
    cur = await conn.execute(
        f"""select i.id from items i
             where i.project_id = %(pid)s and i.is_gold = %(gold)s and {_READY}
               and not exists (select 1 from assignments a where a.item_id = i.id and a.user_id = %(uid)s)
               {cap_cond}
             order by i.judgments_count asc, random()
             limit 1
             for update of i skip locked""",
        {"pid": project["id"], "gold": gold, "uid": user_id, "cap": project["judgments_per_item"]},
    )
    return await cur.fetchone()


async def next_task(project: dict, user: dict) -> dict:
    uid = user["id"]
    staff = user["role"] in ("admin", "reviewer")
    if not (project["status"] == "active" or (staff and project["status"] == "draft")):
        raise HTTPException(status_code=409, detail=f"Project is {project['status']}; annotation is not open")

    async with db.connection() as conn:
        await conn.execute(
            "update assignments set status = 'expired' "
            "where project_id = %s and status = 'assigned' and expires_at < now()",
            (project["id"],),
        )
        pc = await (await conn.execute(
            "select status, paused_reason from project_contributors where project_id = %s and user_id = %s",
            (project["id"], uid),
        )).fetchone()
        if pc and pc["status"] == "paused":
            raise HTTPException(status_code=403, detail=f"paused: {pc['paused_reason'] or 'paused by an admin'}")

        async with conn.transaction():
            # serialize concurrent /next calls from the same user on this project
            await conn.execute("select pg_advisory_xact_lock(hashtext(%s))", (f"next:{project['id']}:{uid}",))
            existing = await (await conn.execute(_OPEN_SQL, (project["id"], uid))).fetchone()
            if existing:
                assignment = existing
            else:
                prefer_gold = random.random() < float(project["gold_rate"])
                picked = await _pick(conn, project, uid, prefer_gold) or await _pick(conn, project, uid, not prefer_gold)
                if not picked:
                    return {"done": True}
                cur = await conn.execute(
                    f"""insert into assignments (project_id, item_id, user_id, swapped, expires_at)
                        values (%s, %s, %s, %s, now() + interval '{ASSIGNMENT_TTL}')
                        returning id as assignment_id, item_id, swapped, assigned_at, expires_at""",
                    (project["id"], picked["id"], uid, random.random() < 0.5),
                )
                assignment = await cur.fetchone()
                item = await (await conn.execute(
                    "select prompt, response_a, response_b from items where id = %s", (picked["id"],)
                )).fetchone()
                assignment = {**assignment, **item}
        mine, remaining = await _progress(conn, project, uid)
    return _task(project, assignment, mine, remaining)


async def _load_assignment(conn: AsyncConnection, assignment_id: str, user: dict, lock: bool) -> dict:
    aid = parse_uuid(assignment_id, "Assignment")
    cur = await conn.execute(
        f"select id, project_id, item_id, user_id, swapped, status from assignments where id = %s"
        f"{' for update' if lock else ''}",
        (aid,),
    )
    a = await cur.fetchone()
    if not a:
        raise HTTPException(status_code=404, detail="Assignment not found")
    if a["user_id"] != user["id"]:
        raise HTTPException(status_code=403, detail="This assignment belongs to another user")
    if a["status"] != "assigned":
        raise HTTPException(status_code=409, detail=f"Assignment is already {a['status']}")
    return a


def validate_submission(project: dict, choice: int, criteria: dict, reason: str) -> dict:
    if not isinstance(choice, int) or isinstance(choice, bool) or not -2 <= choice <= 2:
        raise HTTPException(status_code=400, detail="choice must be an integer from -2 to 2")
    keys = {c["key"] for c in project["rubric"] or [] if isinstance(c, dict) and c.get("key")}
    clean = {}
    for k, v in (criteria or {}).items():
        if k not in keys:
            continue  # ignore unknown criteria keys
        if not isinstance(v, int) or isinstance(v, bool) or v not in (-1, 0, 1):
            raise HTTPException(status_code=400, detail=f"criteria.{k} must be -1, 0 or 1")
        clean[k] = v
    min_chars = int(project["min_reason_chars"])
    if len((reason or "").strip()) < min_chars:
        raise HTTPException(status_code=400, detail=f"Reason must be at least {min_chars} characters")
    return clean


async def submit(
    assignment_id: str, user: dict, choice: int, criteria: dict, reason: str, duration_ms: int,
    flagged: bool, flag_note: str | None,
) -> dict:
    async with db.connection() as conn:
        async with conn.transaction():
            a = await _load_assignment(conn, assignment_id, user, lock=True)
            project = serialize_project(await (await conn.execute(
                f"select {PROJECT_COLS} from projects where id = %s", (a["project_id"],))).fetchone())
            item = await (await conn.execute(
                "select id, is_gold, gold_preference, gold_explanation from items where id = %s for update",
                (a["item_id"],),
            )).fetchone()
            screen_criteria = validate_submission(project, choice, criteria, reason)
            factor = -1 if a["swapped"] else 1
            preference = choice * factor
            canon_criteria = {k: v * factor for k, v in screen_criteria.items()}
            duration_ms = max(0, int(duration_ms))
            too_fast = duration_ms < int(project["min_seconds"]) * 1000
            is_gold = bool(item["is_gold"])
            gold_correct = (sign(preference) == item["gold_preference"]) if is_gold and item["gold_preference"] is not None else None
            await conn.execute(
                """insert into judgments (assignment_id, project_id, item_id, user_id, preference, criteria, reason,
                                          duration_ms, swapped, too_fast, is_gold, gold_correct, flagged, flag_note)
                   values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (a["id"], a["project_id"], a["item_id"], user["id"], preference, Jsonb(canon_criteria),
                 reason.strip(), duration_ms, a["swapped"], too_fast, is_gold, gold_correct, bool(flagged),
                 (flag_note or "").strip() or None),
            )
            await conn.execute(
                "update assignments set status = 'submitted', submitted_at = now() where id = %s", (a["id"],))
            await conn.execute("update items set judgments_count = judgments_count + 1 where id = %s", (a["item_id"],))
            await conn.execute(
                """insert into project_contributors (project_id, user_id) values (%s, %s)
                   on conflict (project_id, user_id) do nothing""",
                (a["project_id"], user["id"]),
            )
            paused = await _maybe_auto_pause(conn, project, user["id"])

    gold_feedback = None
    if is_gold:
        gold_feedback = {
            "correct": bool(gold_correct),
            "expected": item["gold_preference"],
            "explanation": item["gold_explanation"],
        }
    return {"ok": True, "gold_feedback": gold_feedback, "paused": paused}


async def _maybe_auto_pause(conn: AsyncConnection, project: dict, user_id: Any) -> bool:
    pc = await (await conn.execute(
        "select status, override from project_contributors where project_id = %s and user_id = %s for update",
        (project["id"], user_id),
    )).fetchone()
    if pc["status"] == "paused":
        return True
    if pc["override"]:
        return False
    g = await (await conn.execute(
        """select count(*)::int as golds, count(*) filter (where gold_correct)::int as correct
             from judgments where project_id = %s and user_id = %s and is_gold""",
        (project["id"], user_id),
    )).fetchone()
    golds, correct = g["golds"], g["correct"]
    min_count, min_acc = int(project["gold_min_count"]), float(project["gold_min_accuracy"])
    if golds >= min_count and golds > 0 and correct / golds < min_acc:
        reason = (f"gold accuracy {correct / golds:.0%} ({correct}/{golds}) is below the "
                  f"{min_acc:.0%} minimum")
        await conn.execute(
            """update project_contributors set status = 'paused', paused_reason = %s, updated_at = now()
                where project_id = %s and user_id = %s""",
            (reason, project["id"], user_id),
        )
        return True
    return False


async def skip(assignment_id: str, user: dict) -> dict:
    async with db.connection() as conn:
        async with conn.transaction():
            a = await _load_assignment(conn, assignment_id, user, lock=True)
            await conn.execute("update assignments set status = 'skipped' where id = %s", (a["id"],))
    return {"ok": True}
