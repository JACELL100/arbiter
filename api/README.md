# Arbiter API

FastAPI backend for Arbiter (pairwise human evaluation). Contract: `../SPEC.md`. Database: `../supabase/schema.sql`.

## Setup (Windows, Python 3.11)

```bash
cd api
py -3.11 -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
cp .env.example .env    # then fill in the values
```

Run `supabase/schema.sql` once in the Supabase SQL editor.

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Supabase Postgres URL (session or transaction pooler; prepared statements are disabled) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | JWKS verification (ES256/RS256) and the `/auth/v1/user` fallback |
| `SUPABASE_JWT_SECRET` | optional, legacy HS256 projects only |
| `GROQ_API_KEY` | response generation + LLM judge |
| `OPENROUTER_API_KEY` | optional; adds free OpenRouter models (ids prefixed `openrouter/`) |
| `CORS_ORIGINS` | comma-separated, e.g. `http://localhost:3000` |

## Run

```bash
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
# or (also works without --reload on Windows)
.venv/Scripts/python run.py --reload
```

On Windows, psycopg's async driver needs a selector event loop. `uvicorn --reload` and `run.py` both use one.
Plain `uvicorn app.main:app` without `--reload` on Windows does not, so database calls would fail.

- Health: `GET http://localhost:8000/api/v1/health`
- Docs: `http://localhost:8000/docs`

The API starts without a reachable database. `/health` still answers, and endpoints that need the database return 503.

## Sample data

```bash
.venv/Scripts/python scripts/sample_data.py   # writes sample/prompts.csv (40 prompts + 6 gold items)
```

Upload it on a project's Items tab (or `POST /api/v1/projects/{id}/items/upload`), then run "Generate" to fill responses.

## Tests

```bash
.venv/Scripts/python -m pytest -q
```

## Layout

```
app/main.py            app, CORS, error handlers, /api/v1 router, lifespan (pool, jobs, http clients)
app/auth.py            Supabase JWT (HS256 secret | JWKS | /auth/v1/user fallback), role dependencies
app/db.py              psycopg AsyncConnectionPool (dict_row, prepare_threshold=None)
app/common.py          shared queries / item aggregation
app/routers/*          me, users, projects, items, llm, annotate, contributors, stats, review, export
app/services/stats.py  pure statistics (Wilson, Bradley-Terry + bootstrap, Krippendorff, Fleiss, Cohen, disputes)
app/services/judge.py  LLM judge (both orders, consistency check)
app/services/groq.py   Groq / OpenRouter client (semaphore, retries)
app/services/jobs.py   background jobs with progress rows
app/services/assignment.py  task assignment / submit / skip
app/services/upload.py CSV / JSONL parsing
```

## Notes on behavior

- Validation errors return **400** with a readable `detail` string (not FastAPI's default 422 list).
- `disputed` on items is true only while the item has no reviewer decision. Review-queue rows also carry `reasons`.
- When an item has LLM verdicts from several models, the project's `judge_model` verdict is used, otherwise the latest one.
- Fleiss' kappa with unequal rater counts: each item uses its own n_i. P_bar is the mean of the per-item agreements. Chance agreement uses pooled category proportions. With equal counts this is the classic Fleiss' kappa.
- Krippendorff's alpha is `null` when the pooled votes have no variance, because alpha is undefined then.
