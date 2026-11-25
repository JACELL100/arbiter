"""Background jobs: a `jobs` row tracks progress; work runs in an asyncio task in this process."""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Awaitable, Callable, Sequence

from .. import db
from ..db import Jsonb

log = logging.getLogger("arbiter.jobs")

JOB_COLS = "id, project_id, kind, status, total, done, failed, error, params, created_at, finished_at"
CONCURRENCY = 4

_tasks: set[asyncio.Task] = set()


async def create_job(project_id: Any, kind: str, total: int, params: dict, created_by: Any) -> dict:
    return await db.fetch_one(
        f"""insert into jobs (project_id, kind, status, total, params, created_by)
            values (%s, %s, 'queued', %s, %s, %s) returning {JOB_COLS}""",
        (project_id, kind, total, Jsonb(params), created_by),
    )


async def _status(job_id: Any) -> str | None:
    row = await db.fetch_one("select status from jobs where id = %s", (job_id,))
    return row["status"] if row else None


async def _run(job_id: Any, items: Sequence[dict], worker: Callable[[dict], Awaitable[None]]) -> None:
    sem = asyncio.Semaphore(CONCURRENCY)
    stop = False

    async def one(item: dict) -> None:
        nonlocal stop
        async with sem:
            if stop:
                return
            if await _status(job_id) != "running":  # cancelled (or deleted)
                stop = True
                return
            try:
                await worker(item)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                log.warning("job %s item %s failed: %s", job_id, item.get("id"), exc)
                await db.execute(
                    "update jobs set failed = failed + 1, error = coalesce(error, %s) where id = %s",
                    (str(exc)[:1000], job_id),
                )
            else:
                await db.execute("update jobs set done = done + 1 where id = %s", (job_id,))

    try:
        await db.execute("update jobs set status = 'running' where id = %s and status = 'queued'", (job_id,))
        await asyncio.gather(*(one(i) for i in items))
        await db.execute(
            """update jobs set
                 status = case when status = 'running' then
                            case when total > 0 and failed >= total then 'failed' else 'completed' end
                          else status end,
                 finished_at = now()
               where id = %s""",
            (job_id,),
        )
    except asyncio.CancelledError:
        try:
            await asyncio.shield(db.execute(
                "update jobs set status = 'failed', error = coalesce(error, 'Server shut down'), finished_at = now() "
                "where id = %s and status in ('queued','running')",
                (job_id,),
            ))
        except Exception:
            pass
        raise
    except Exception as exc:
        log.exception("job %s crashed", job_id)
        try:
            await db.execute(
                "update jobs set status = 'failed', error = %s, finished_at = now() where id = %s",
                (str(exc)[:1000], job_id),
            )
        except Exception:
            pass


def start_job(job_id: Any, items: Sequence[dict], worker: Callable[[dict], Awaitable[None]]) -> None:
    task = asyncio.create_task(_run(job_id, items, worker), name=f"job-{job_id}")
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


async def shutdown() -> None:
    for t in list(_tasks):
        t.cancel()
    if _tasks:
        await asyncio.gather(*_tasks, return_exceptions=True)
