"""Shared query helpers and serializers."""
from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any

from fastapi import HTTPException

from . import db
from .services import stats as st

PROJECT_COLS = (
    "id, name, description, instructions, rubric, status, judgments_per_item, min_reason_chars, min_seconds, "
    "gold_rate, gold_min_accuracy, gold_min_count, judge_model, created_by, created_at, updated_at"
)
ITEM_COLS = (
    "id, project_id, prompt, response_a, response_b, model_a, model_b, is_gold, gold_preference, "
    "gold_explanation, metadata, judgments_count, created_at"
)
JUDGMENT_COLS = (
    "id, assignment_id, project_id, item_id, user_id, preference, criteria, reason, duration_ms, swapped, "
    "too_fast, is_gold, gold_correct, flagged, flag_note, created_at"
)
LLM_COLS = "id, project_id, item_id, model, preference, criteria, rationale, consistent, created_at"
REVIEW_COLS = "id, project_id, item_id, reviewer_id, final_preference, note, created_at"


def parse_uuid(value: str, what: str = "Resource") -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, TypeError):
        raise HTTPException(status_code=404, detail=f"{what} not found")


def serialize_project(p: dict) -> dict:
    out = dict(p)
    for k in ("gold_rate", "gold_min_accuracy"):
        if isinstance(out.get(k), Decimal):
            out[k] = float(out[k])
    if out.get("rubric") is None:
        out["rubric"] = []
    return out


async def get_project(project_id: str) -> dict:
    pid = parse_uuid(project_id, "Project")
    row = await db.fetch_one(f"select {PROJECT_COLS} from projects where id = %s", (pid,))
    if not row:
        raise HTTPException(status_code=404, detail="Project not found")
    return serialize_project(row)


async def get_item(project_id: Any, item_id: str) -> dict:
    iid = parse_uuid(item_id, "Item")
    row = await db.fetch_one(f"select {ITEM_COLS} from items where id = %s and project_id = %s", (iid, project_id))
    if not row:
        raise HTTPException(status_code=404, detail="Item not found")
    return row


async def load_item_context(project: dict, item_ids: list | None = None) -> tuple[dict, dict, dict]:
    """Judgments / LLM verdict / review per item for a project (optionally restricted to item_ids)."""
    pid = project["id"]
    if item_ids is not None and not item_ids:
        return {}, {}, {}
    where = "project_id = %s" + (" and item_id = any(%s)" if item_ids is not None else "")
    params: tuple = (pid, item_ids) if item_ids is not None else (pid,)
    async with db.connection() as conn:
        js = await (await conn.execute(
            f"select item_id, preference, flagged from judgments where {where}", params)).fetchall()
        llms = await (await conn.execute(f"select {LLM_COLS} from llm_judgments where {where}", params)).fetchall()
        revs = await (await conn.execute(f"select {REVIEW_COLS} from reviews where {where}", params)).fetchall()
    j_by: dict = {}
    for j in js:
        j_by.setdefault(j["item_id"], []).append(j)
    l_by: dict = {}
    for r in llms:
        l_by.setdefault(r["item_id"], []).append(r)
    llm_by = {k: st.pick_llm(v, project.get("judge_model")) for k, v in l_by.items()}
    rev_by = {r["item_id"]: r for r in revs}
    return j_by, llm_by, rev_by


def item_row(project: dict, item: dict, j_by: dict, llm_by: dict, rev_by: dict, with_reasons: bool = False) -> dict:
    agg = st.aggregate_item(item, j_by.get(item["id"], []), llm_by.get(item["id"]), rev_by.get(item["id"]),
                            int(project["judgments_per_item"]))
    reasons = agg.pop("reasons")
    out = {**item, **agg}
    if with_reasons:
        out["reasons"] = reasons
    return out
