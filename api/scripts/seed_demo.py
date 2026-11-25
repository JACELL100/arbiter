"""Seed demo projects for Arbiter.

Creates two projects with REAL model responses (Groq) and REAL LLM-judge verdicts.
Project 1 additionally gets votes from 4 SIMULATED demo annotators (clearly named as such)
so the dashboard, agreement metrics, gold checks and auto-pause have data to show.
A handful of items are left without simulated votes so real people can annotate live.

Run from the api/ folder:
    .venv/Scripts/python scripts/seed_demo.py            # Windows
    .venv/bin/python scripts/seed_demo.py                # macOS/Linux
Re-running deletes and recreates the two demo projects.
"""

from __future__ import annotations

import asyncio
import csv
import random
import secrets
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

import httpx  # noqa: E402
import psycopg  # noqa: E402
from dotenv import dotenv_values  # noqa: E402
from psycopg.rows import dict_row  # noqa: E402
from psycopg.types.json import Jsonb  # noqa: E402

from app.services import groq, judge  # noqa: E402

ENV = dotenv_values(ROOT / ".env")
rng = random.Random(7)

RUBRIC = [
    {"key": "helpfulness", "label": "Helpfulness", "description": "Directly addresses what the user asked and gives them something they can use."},
    {"key": "correctness", "label": "Correctness", "description": "Facts, code and reasoning are accurate. Penalise confident mistakes heavily."},
    {"key": "clarity", "label": "Clarity", "description": "Well organised, concise, easy to follow. No padding or repetition."},
    {"key": "safety", "label": "Safety", "description": "Avoids harmful, misleading or overconfident advice; flags uncertainty where appropriate."},
]

INSTRUCTIONS = """You will see a user prompt and two AI responses. Decide which response better serves the user.

1. Read the prompt first and note what a great answer must include.
2. Read both responses fully. Check facts, code and arithmetic — a fluent answer that is wrong loses.
3. Rate each rubric criterion (A / Tie / B), then give an overall preference.
4. Use "much better" only when one response is clearly superior (e.g. the other is wrong or unhelpful).
5. Ignore length unless it hurts clarity. Longer is not automatically better.
6. Write a short reason that names the specific difference (e.g. "B's code handles the empty list; A's crashes").
Flag the item if a prompt or response is broken, unsafe or off-topic."""

SYSTEM_PROMPT = "You are a helpful assistant. Answer clearly and accurately. Keep answers focused; use short code blocks where useful."

CODING_PROMPTS = [
    "Write a SQL query that returns the second-highest salary from an `employees(id, name, salary)` table. Handle the case where it doesn't exist.",
    "Explain what a race condition is and show a minimal Python example plus the fix.",
    "In React, why does my `useEffect` run twice in development? Is it a bug?",
    "Write a TypeScript function `debounce(fn, ms)` with correct typing for the arguments.",
    "What's the difference between `git merge` and `git rebase`? When should I use each?",
    "Implement an LRU cache in Python with O(1) get and put.",
    "Explain Big-O of binary search and why it requires a sorted array.",
    "How do I safely store passwords in a database? Name the algorithms and what to avoid.",
    "Write a regex that validates an Indian PIN code (6 digits, first digit non-zero) and explain it.",
    "What is the N+1 query problem in ORMs and how do I fix it in SQLAlchemy?",
    "Explain CORS in two paragraphs to a junior developer, and what the preflight request is.",
    "Write a bash one-liner that finds the 10 largest files under the current directory.",
    "What does `SELECT ... FOR UPDATE SKIP LOCKED` do in Postgres and when is it useful?",
    "Convert this callback code to async/await: `fs.readFile('a.txt', (err, data) => { if (err) throw err; console.log(data); })`",
    "Explain the difference between a process and a thread, with one practical consequence for web servers.",
    "Write a Python function to check if a string is a valid palindrome ignoring punctuation and case.",
]

CODING_GOLD = [
    {
        "prompt": "What does `len([1, [2, 3], 4])` return in Python?",
        "response_a": "It returns 3: the list has three top-level elements (1, the nested list [2, 3], and 4). `len` doesn't count nested elements.",
        "response_b": "It returns 4, because `len` counts every number in the list including the nested ones.",
        "gold": -1,
        "explanation": "Response B is wrong: len() only counts top-level elements, so the answer is 3.",
    },
    {
        "prompt": "Is HTTP GET supposed to be idempotent?",
        "response_a": "No. GET requests can change server state freely; idempotency only applies to POST.",
        "response_b": "Yes. GET is defined as safe and idempotent: repeating it should not change server state. POST is the method that is not idempotent.",
        "gold": 1,
        "explanation": "Response A reverses the HTTP semantics. GET is safe and idempotent; POST is not idempotent.",
    },
]

REASONS = {
    "strong": [
        "The preferred response is correct and complete; the other one gets a key fact wrong.",
        "Clear winner: it actually answers the question and the code works, the other misses the main point.",
        "The other answer contains an error that would mislead the user. This one is accurate and well structured.",
    ],
    "mild": [
        "Both are reasonable, but the preferred one is more precise and easier to follow.",
        "Slightly better: covers the edge case the other skips and has a cleaner explanation.",
        "Preferred answer is more concise and gives a usable example; the other is a bit vague.",
        "Both correct; the preferred one explains the why, not just the what.",
    ],
    "tie": [
        "Both answers are correct and similarly clear; neither is meaningfully better.",
        "Equivalent quality. Different wording but the same key points and no errors.",
    ],
}

SIM_ANNOTATORS = [
    {"name": "Demo annotator 1 (simulated)", "accuracy": 0.82, "sloppy": False},
    {"name": "Demo annotator 2 (simulated)", "accuracy": 0.78, "sloppy": False},
    {"name": "Demo annotator 3 (simulated)", "accuracy": 0.74, "sloppy": False},
    {"name": "Demo annotator 4 (simulated)", "accuracy": 0.40, "sloppy": True},
]


def sign(v: float) -> int:
    return -1 if v < 0 else (1 if v > 0 else 0)


async def create_sim_users(conn: psycopg.AsyncConnection) -> list[dict]:
    """Create (or reuse) the simulated annotator accounts via the Supabase admin API."""
    url = ENV["SUPABASE_URL"].rstrip("/") + "/auth/v1/admin/users"
    key = ENV.get("SUPABASE_SERVICE_KEY") or ""
    users = []
    async with httpx.AsyncClient(timeout=30) as http:
        for i, a in enumerate(SIM_ANNOTATORS, start=1):
            email = f"demo-annotator-{i}@arbiter.demo"
            row = await (await conn.execute("select id from public.profiles where email=%s", (email,))).fetchone()
            if not row:
                body = {
                    "email": email,
                    "password": secrets.token_urlsafe(18),
                    "email_confirm": True,
                    "user_metadata": {"full_name": a["name"]},
                }
                r = await http.post(url, json=body, headers={"apikey": key})
                if r.status_code == 401:
                    r = await http.post(url, json=body, headers={"apikey": key, "Authorization": f"Bearer {key}"})
                if r.status_code >= 300:
                    raise SystemExit(f"Could not create {email}: {r.status_code} {r.text[:300]}")
                uid = r.json()["id"]
                for _ in range(20):  # wait for the trigger
                    row = await (await conn.execute("select id from public.profiles where id=%s", (uid,))).fetchone()
                    if row:
                        break
                    await asyncio.sleep(0.3)
                if not row:
                    await conn.execute(
                        "insert into public.profiles (id,email,full_name,role) values (%s,%s,%s,'contributor') on conflict do nothing",
                        (uid, email, a["name"]),
                    )
                row = {"id": uid}
            await conn.execute(
                "update public.profiles set full_name=%s, role='contributor', status='active' where id=%s",
                (a["name"], row["id"]),
            )
            users.append({**a, "id": row["id"], "email": email})
    return users


async def generate(items: list[dict], model_a: str, model_b: str) -> None:
    async def one(it: dict) -> None:
        if it.get("response_a") and it.get("response_b"):
            return
        msgs = [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": it["prompt"]}]
        try:
            a, b = await asyncio.gather(
                groq.chat(model_a, msgs, temperature=0.7, max_tokens=700),
                groq.chat(model_b, msgs, temperature=0.7, max_tokens=700),
            )
        except Exception as e:  # noqa: BLE001
            print(f"  ! generation failed: {str(e)[:120]}")
            return
        if a and b:
            it.update(response_a=a, response_b=b, model_a=model_a, model_b=model_b)

    done = 0

    async def tracked(it: dict) -> None:
        nonlocal done
        await one(it)
        done += 1
        if done % 5 == 0 or done == len(items):
            print(f"  generated {done}/{len(items)}")

    await asyncio.gather(*(tracked(it) for it in items))


async def run_judge(conn, project_id, judge_model: str, items: list[dict]) -> None:
    done = 0

    async def one(it: dict) -> None:
        nonlocal done
        try:
            v = await judge.judge_item(judge_model, INSTRUCTIONS, RUBRIC, it["prompt"], it["response_a"], it["response_b"], True)
        except Exception as e:  # noqa: BLE001
            print(f"  ! judge failed: {str(e)[:120]}")
            return
        it["llm"] = v
        await conn.execute(
            """insert into public.llm_judgments (project_id,item_id,model,preference,criteria,rationale,consistent,raw)
               values (%s,%s,%s,%s,%s,%s,%s,%s)
               on conflict (item_id, model) do update set preference=excluded.preference, criteria=excluded.criteria,
                 rationale=excluded.rationale, consistent=excluded.consistent, raw=excluded.raw""",
            (project_id, it["id"], judge_model, v["preference"], Jsonb(v["criteria"]), v["rationale"], v["consistent"], Jsonb(v.get("raw", {}))),
        )
        done += 1
        if done % 5 == 0:
            print(f"  judged {done}/{len(items)}")

    await asyncio.gather(*(one(it) for it in items))


async def create_project(conn, admin_id, *, name, description, judge_model, judgments_per_item) -> str:
    await conn.execute("delete from public.projects where name=%s", (name,))
    row = await (
        await conn.execute(
            """insert into public.projects (name,description,instructions,rubric,status,judgments_per_item,
                 min_reason_chars,min_seconds,gold_rate,gold_min_accuracy,gold_min_count,judge_model,created_by)
               values (%s,%s,%s,%s,'active',%s,20,8,0.12,0.6,5,%s,%s) returning id""",
            (name, description, INSTRUCTIONS, Jsonb(RUBRIC), judgments_per_item, judge_model, admin_id),
        )
    ).fetchone()
    return row["id"]


async def insert_items(conn, project_id, items: list[dict]) -> None:
    for it in items:
        row = await (
            await conn.execute(
                """insert into public.items (project_id,prompt,response_a,response_b,model_a,model_b,is_gold,
                     gold_preference,gold_explanation,metadata)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
                (
                    project_id, it["prompt"], it.get("response_a"), it.get("response_b"), it.get("model_a"), it.get("model_b"),
                    it.get("is_gold", False), it.get("gold"), it.get("explanation"), Jsonb(it.get("metadata", {})),
                ),
            )
        ).fetchone()
        it["id"] = row["id"]


def simulate_vote(truth: int, strength: int, annotator: dict) -> int:
    """Return a canonical preference -2..2 for a simulated annotator."""
    if rng.random() < annotator["accuracy"]:
        if truth == 0:
            return 0
        mag = 2 if (strength == 2 and rng.random() < 0.6) else 1
        return truth * mag
    return rng.choice([-1, 0, 1, -2, 2]) if not annotator["sloppy"] else rng.choice([-1, 1])


async def simulate(conn, project_id, users: list[dict], items: list[dict], gold_items: list[dict]) -> None:
    now = datetime.now(timezone.utc)
    rng.shuffle(items)
    voted = items[: max(0, len(items) - 6)]  # leave ~6 items for live annotation
    rows = []

    def add(user, it, pref: int, is_gold: bool):
        swapped = rng.random() < 0.5
        if user["sloppy"]:
            # sloppy annotator mostly clicks the left side quickly
            left = -1 if rng.random() < 0.75 else 1
            pref = left * (-1 if swapped else 1)
            duration = rng.randint(3000, 7000)
        else:
            duration = rng.randint(22000, 110000)
        criteria = {}
        for c in RUBRIC:
            s = sign(pref)
            criteria[c["key"]] = s if rng.random() < 0.8 else rng.choice([0, -s if s else 1])
        if rng.random() < 0.6:  # most items have no safety difference
            criteria["safety"] = 0
        kind = "tie" if pref == 0 else ("strong" if abs(pref) == 2 else "mild")
        gold_correct = (sign(pref) == it["gold"]) if is_gold else None
        created = now - timedelta(minutes=rng.randint(5, 30 * 60))
        flagged = (not is_gold) and rng.random() < 0.03
        rows.append(
            dict(
                project_id=project_id, item_id=it["id"], user_id=user["id"], swapped=swapped, pref=pref,
                criteria=criteria, reason=rng.choice(REASONS[kind]), duration=duration,
                too_fast=duration < 8000, is_gold=is_gold, gold_correct=gold_correct, created=created,
                flagged=flagged, flag_note="Response cites a figure that may be outdated." if flagged else None,
            )
        )

    for it in voted:
        llm = it.get("llm") or {}
        truth = sign(llm.get("preference", 0)) if llm.get("consistent", False) else rng.choice([-1, 0, 1])
        strength = abs(llm.get("preference", 1)) or 1
        for user in rng.sample(users, 3):
            add(user, it, simulate_vote(truth, strength, user), False)

    for user in users:
        n = 6 if user["sloppy"] else rng.randint(2, 4)
        for g in rng.sample(gold_items, min(n, len(gold_items))):
            correct_p = 0.25 if user["sloppy"] else 0.9
            pref = g["gold"] if rng.random() < correct_p else rng.choice([s for s in (-1, 0, 1) if s != g["gold"]])
            add(user, g, pref, True)

    async with conn.transaction():
        for r in rows:
            a = await (
                await conn.execute(
                    """insert into public.assignments (project_id,item_id,user_id,swapped,status,assigned_at,expires_at,submitted_at)
                       values (%s,%s,%s,%s,'submitted',%s,%s,%s) returning id""",
                    (
                        r["project_id"], r["item_id"], r["user_id"], r["swapped"],
                        r["created"] - timedelta(milliseconds=r["duration"]),
                        r["created"] + timedelta(minutes=30), r["created"],
                    ),
                )
            ).fetchone()
            await conn.execute(
                """insert into public.judgments (assignment_id,project_id,item_id,user_id,preference,criteria,reason,
                     duration_ms,swapped,too_fast,is_gold,gold_correct,flagged,flag_note,created_at)
                   values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                (
                    a["id"], r["project_id"], r["item_id"], r["user_id"], r["pref"], Jsonb(r["criteria"]), r["reason"],
                    r["duration"], r["swapped"], r["too_fast"], r["is_gold"], r["gold_correct"], r["flagged"],
                    r["flag_note"], r["created"],
                ),
            )
        await conn.execute(
            """update public.items i set judgments_count = (select count(*) from public.judgments j where j.item_id=i.id)
               where project_id=%s""",
            (project_id,),
        )
        for user in users:
            golds = [r for r in rows if r["user_id"] == user["id"] and r["is_gold"]]
            acc = sum(1 for r in golds if r["gold_correct"]) / len(golds) if golds else 1.0
            paused = len(golds) >= 5 and acc < 0.6
            await conn.execute(
                """insert into public.project_contributors (project_id,user_id,status,paused_reason)
                   values (%s,%s,%s,%s)
                   on conflict (project_id,user_id) do update set status=excluded.status, paused_reason=excluded.paused_reason""",
                (
                    project_id, user["id"], "paused" if paused else "active",
                    f"Gold accuracy {acc:.0%} is below 60% after {len(golds)} gold items" if paused else None,
                ),
            )
    print(f"  simulated {len(rows)} judgments on {len(voted)} items (+ gold)")


async def main() -> None:
    async with await psycopg.AsyncConnection.connect(
        ENV["DATABASE_URL"], prepare_threshold=None, autocommit=True, row_factory=dict_row
    ) as conn:
        admin = await (await conn.execute("select id from public.profiles where role='admin' order by created_at limit 1")).fetchone()
        if not admin:
            raise SystemExit("Sign up first — the first account becomes admin.")
        admin_id = admin["id"]

        # ---------------- Project 1: general assistant, with simulated annotators ----------------
        print("Project 1: general assistant")
        rows = list(csv.DictReader(open(ROOT / "sample" / "prompts.csv", encoding="utf-8-sig")))
        items, golds = [], []
        for r in rows:
            if r["is_gold"].strip().lower() == "true":
                golds.append(
                    {
                        "prompt": r["prompt"], "response_a": r["response_a"], "response_b": r["response_b"],
                        "is_gold": True, "gold": {"A": -1, "B": 1}.get(r["gold"].strip().upper(), 0),
                        "explanation": r["gold_explanation"], "metadata": {"category": r.get("category", "")},
                    }
                )
            else:
                items.append({"prompt": r["prompt"], "metadata": {"category": r.get("category", "")}})

        m_a, m_b, judge_model = "openai/gpt-oss-20b", "qwen/qwen3.8-27b", "openai/gpt-oss-120b"
        await generate(items, m_a, m_b)
        items = [it for it in items if it.get("response_a")]
        p1 = await create_project(
            conn, admin_id,
            name="General assistant: GPT-OSS 20B vs Qwen3.8 27B",
            description=(
                f"{len(items)} prompts across coding, reasoning, writing, factual and advice, plus {len(golds)} gold items. "
                "Responses and LLM-judge verdicts are real model outputs; human votes come from 4 simulated demo annotators."
            ),
            judge_model=judge_model, judgments_per_item=4,
        )
        await insert_items(conn, p1, items + golds)
        print(f"  inserted {len(items)} items + {len(golds)} gold")
        await run_judge(conn, p1, judge_model, items)
        users = await create_sim_users(conn)
        await simulate(conn, p1, users, items, golds)

        # ---------------- Project 2: coding, left empty for live annotation ----------------
        print("Project 2: coding help")
        c_items = [{"prompt": p, "metadata": {"category": "coding"}} for p in CODING_PROMPTS]
        c_a, c_b, c_judge = "allam-2-7b", "openai/gpt-oss-120b", "qwen/qwen3.8-27b"
        await generate(c_items, c_a, c_b)
        c_items = [it for it in c_items if it.get("response_a")]
        c_gold = [{**g, "is_gold": True, "metadata": {"category": "coding"}} for g in CODING_GOLD]
        p2 = await create_project(
            conn, admin_id,
            name="Coding help: Allam 2 7B vs GPT-OSS 120B",
            description=f"{len(c_items)} programming questions plus {len(c_gold)} gold checks. No votes yet — open for live annotation.",
            judge_model=c_judge, judgments_per_item=3,
        )
        await insert_items(conn, p2, c_items + c_gold)
        await run_judge(conn, p2, c_judge, c_items)
        print(f"Done. Project 1: {p1}  Project 2: {p2}")
    await groq.close_client()


if __name__ == "__main__":
    asyncio.run(main())
