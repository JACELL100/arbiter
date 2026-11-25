from __future__ import annotations

import json
import re
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterator, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from .. import db
from ..auth import require_staff
from ..common import ITEM_COLS, get_project, item_row, load_item_context
from ..services.stats import majority_sign, sign

router = APIRouter(tags=["export"])


def _default(o: Any):
    if isinstance(o, (datetime, date)):
        return o.isoformat()
    if isinstance(o, uuid.UUID):
        return str(o)
    if isinstance(o, Decimal):
        return float(o)
    raise TypeError(f"not JSON serializable: {type(o).__name__}")


def _line(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False, default=_default) + "\n"


def slugify(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "").lower()).strip("-")
    return s[:60].strip("-") or "project"


def _chunks(lines: Iterator[str], size: int = 200) -> Iterator[bytes]:
    buf: list[str] = []
    for line in lines:
        buf.append(line)
        if len(buf) >= size:
            yield "".join(buf).encode("utf-8")
            buf = []
    if buf:
        yield "".join(buf).encode("utf-8")


async def _dpo_lines(project: dict) -> list[str]:
    items = await db.fetch_all(
        f"select {ITEM_COLS} from items where project_id = %s and not is_gold order by created_at, id",
        (project["id"],),
    )
    j_by, _, rev_by = await load_item_context(project)
    out = []
    for it in items:
        if not it["response_a"] or not it["response_b"]:
            continue
        prefs = [int(j["preference"]) for j in j_by.get(it["id"], [])]
        review = rev_by.get(it["id"])
        if review is not None:
            winner, source = sign(review["final_preference"]), "review"
        else:
            winner, source = majority_sign([sign(p) for p in prefs]), "human_majority"
        if not winner:  # None (no strict majority) or 0 (tie)
            continue
        a_wins = winner < 0
        margin = abs(sum(prefs) / len(prefs)) if prefs else abs(int(review["final_preference"]))
        out.append(_line({
            "prompt": it["prompt"],
            "chosen": it["response_a"] if a_wins else it["response_b"],
            "rejected": it["response_b"] if a_wins else it["response_a"],
            "chosen_model": it["model_a"] if a_wins else it["model_b"],
            "rejected_model": it["model_b"] if a_wins else it["model_a"],
            "margin": round(margin, 4),
            "votes": len(prefs),
            "agreement": round(sum(1 for p in prefs if sign(p) == winner) / len(prefs), 4) if prefs else None,
            "source": source,
            "item_id": it["id"],
        }))
    return out


async def _raw_lines(project: dict) -> list[str]:
    rows = await db.fetch_all(
        """select item_id, user_id, preference, criteria, reason, duration_ms, swapped, too_fast, is_gold,
                  gold_correct, flagged, flag_note, created_at
             from judgments where project_id = %s order by created_at, id""",
        (project["id"],),
    )
    return [_line(r) for r in rows]


async def _items_lines(project: dict) -> list[str]:
    items = await db.fetch_all(
        f"select {ITEM_COLS} from items where project_id = %s order by created_at, id", (project["id"],)
    )
    j_by, llm_by, rev_by = await load_item_context(project)
    out = []
    for it in items:
        row = item_row(project, it, j_by, llm_by, rev_by, with_reasons=True)
        llm = llm_by.get(it["id"])
        prefs = [sign(j["preference"]) for j in j_by.get(it["id"], [])]
        out.append(_line({
            "item_id": it["id"],
            "prompt": it["prompt"],
            "response_a": it["response_a"],
            "response_b": it["response_b"],
            "model_a": it["model_a"],
            "model_b": it["model_b"],
            "is_gold": it["is_gold"],
            "gold_preference": it["gold_preference"],
            "gold_explanation": it["gold_explanation"],
            "metadata": it["metadata"],
            "judgments_count": len(prefs),
            "human_votes": row["human_votes"],
            "human_mean": row["human_mean"],
            "human_majority": majority_sign(prefs),
            "llm_model": llm["model"] if llm else None,
            "llm_preference": row["llm_preference"],
            "llm_consistent": row["llm_consistent"],
            "llm_rationale": llm["rationale"] if llm else None,
            "review_preference": row["review_preference"],
            "disputed": row["disputed"],
            "dispute_reasons": row["reasons"],
            "created_at": it["created_at"],
        }))
    return out


@router.get("/projects/{project_id}/export")
async def export(project_id: str, format: Literal["dpo", "raw", "items"] = "dpo", _: dict = Depends(require_staff)):
    project = await get_project(project_id)
    builder = {"dpo": _dpo_lines, "raw": _raw_lines, "items": _items_lines}[format]
    lines = await builder(project)  # load before streaming so DB errors still produce a proper status code
    filename = f"{slugify(project['name'])}-{format}.jsonl"
    return StreamingResponse(
        _chunks(iter(lines)),
        media_type="application/x-ndjson",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
