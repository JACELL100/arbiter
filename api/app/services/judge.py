"""LLM-as-judge: pairwise verdicts with optional order swapping to detect position bias."""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from . import groq

log = logging.getLogger("arbiter.judge")

SYSTEM_PROMPT = (
    "You are a meticulous, impartial evaluator comparing two AI assistant responses to the same user prompt. "
    "Judge only on quality as defined by the instructions and rubric. Ignore response order and length "
    "unless length affects quality. Respond with a single JSON object and nothing else."
)


def build_prompt(instructions: str, rubric: list[dict], prompt: str, r1: str, r2: str) -> str:
    rubric_lines = "\n".join(
        f'- "{c.get("key")}": {c.get("label") or c.get("key")}'
        + (f" - {c.get('description')}" if c.get("description") else "")
        for c in rubric
        if isinstance(c, dict) and c.get("key")
    ) or "(no specific criteria)"
    keys = [c["key"] for c in rubric if isinstance(c, dict) and c.get("key")]
    criteria_schema = ", ".join(f'"{k}": -1|0|1' for k in keys)
    return f"""## Evaluation instructions
{instructions.strip() or "Decide which response better serves the user."}

## Rubric criteria
{rubric_lines}

## User prompt
<prompt>
{prompt}
</prompt>

## Response 1
<response_1>
{r1}
</response_1>

## Response 2
<response_2>
{r2}
</response_2>

## Output format
Return strict JSON: {{"preference": <integer -2..2>, "criteria": {{{criteria_schema}}}, "rationale": "<1-3 sentences>"}}
- preference: -2 = Response 1 much better, -1 = Response 1 better, 0 = tie, 1 = Response 2 better, 2 = Response 2 much better.
- criteria values: -1 = Response 1 better, 0 = tie, 1 = Response 2 better on that criterion.
"""


def _clamp_int(v: Any, lo: int, hi: int) -> int | None:
    try:
        x = int(round(float(v)))
    except (TypeError, ValueError):
        return None
    return max(lo, min(hi, x))


def _extract_json(text: str) -> dict | None:
    text = text.strip()
    # strip code fences
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
    try:
        obj = json.loads(text)
        if isinstance(obj, dict):
            return obj
    except ValueError:
        pass
    start = text.find("{")
    while start != -1:
        depth = 0
        in_str = esc = False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = json.loads(text[start : i + 1])
                        if isinstance(obj, dict):
                            return obj
                    except ValueError:
                        pass
                    break
        start = text.find("{", start + 1)
    return None


def parse_verdict(text: str, keys: list[str]) -> dict | None:
    obj = _extract_json(text)
    if not obj:
        return None
    pref = _clamp_int(obj.get("preference"), -2, 2)
    if pref is None:
        return None
    crit_in = obj.get("criteria") if isinstance(obj.get("criteria"), dict) else {}
    criteria = {}
    for k in keys:
        v = _clamp_int(crit_in.get(k), -1, 1)
        criteria[k] = v if v is not None else 0
    rationale = obj.get("rationale")
    return {"preference": pref, "criteria": criteria, "rationale": str(rationale or "").strip()[:4000]}


async def _ask(model: str, instructions: str, rubric: list[dict], prompt: str, r1: str, r2: str) -> tuple[dict, str]:
    keys = [c["key"] for c in rubric if isinstance(c, dict) and c.get("key")]
    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": build_prompt(instructions, rubric, prompt, r1, r2)},
    ]
    last_text = ""
    for _ in range(2):  # one retry on unparseable output
        last_text = await groq.chat(model, messages, temperature=0, max_tokens=600, json_mode=True)
        verdict = parse_verdict(last_text, keys)
        if verdict is not None:
            return verdict, last_text
    raise groq.GroqError(f"Judge returned unparseable output: {last_text[:200]}")


def combine(first: dict, second_swapped: dict) -> dict:
    """Combine an A/B verdict with a B/A verdict (the latter already negated to canonical)."""
    p1, p2 = first["preference"], second_swapped["preference"]
    s1, s2 = (p1 > 0) - (p1 < 0), (p2 > 0) - (p2 < 0)
    keys = set(first["criteria"]) | set(second_swapped["criteria"])
    if s1 != s2:
        criteria = {
            k: first["criteria"].get(k, 0) if first["criteria"].get(k, 0) == second_swapped["criteria"].get(k, 0) else 0
            for k in keys
        }
        return {"preference": 0, "criteria": criteria, "consistent": False}
    avg = (p1 + p2) / 2
    # round half away from zero so (1, 2) -> 2 and (-1, -2) -> -2
    pref = int(avg + 0.5) if avg >= 0 else -int(-avg + 0.5)
    criteria = {}
    for k in keys:
        a, b = first["criteria"].get(k, 0), second_swapped["criteria"].get(k, 0)
        criteria[k] = a if a == b else 0
    return {"preference": pref, "criteria": criteria, "consistent": True}


async def judge_item(
    model: str,
    instructions: str,
    rubric: list[dict],
    prompt: str,
    response_a: str,
    response_b: str,
    both_orders: bool = True,
) -> dict:
    """Return {preference, criteria, rationale, consistent, raw} in canonical A/B terms."""
    first, text1 = await _ask(model, instructions, rubric, prompt, response_a, response_b)
    raw: dict[str, Any] = {"ab": {"verdict": first, "text": text1}}
    if not both_orders:
        return {**first, "consistent": True, "raw": raw}
    second, text2 = await _ask(model, instructions, rubric, prompt, response_b, response_a)
    raw["ba"] = {"verdict": second, "text": text2}
    negated = {
        "preference": -second["preference"],
        "criteria": {k: -v for k, v in second["criteria"].items()},
    }
    combined = combine(first, negated)
    rationale = first["rationale"]
    if not combined["consistent"]:
        rationale = f"[Inconsistent across orderings] {rationale}"
    return {**combined, "rationale": rationale, "raw": raw}
