# Arbiter — human evaluation workbench for AI models

Run side-by-side (pairwise) human evaluations of model outputs, with the quality controls an AI lab
actually needs, and export the result as preference data for RLHF/DPO.

- **Setup**: upload prompts (CSV/JSONL) or generate responses from two models with Groq; define a rubric.
- **Annotate**: keyboard-first comparison screen; left/right order is randomised per contributor to cancel position bias.
- **Quality**: hidden gold items with feedback, auto-pause on low gold accuracy, too-fast detection,
  inter-annotator agreement (Krippendorff's α, Fleiss' κ), per-contributor agreement and left-bias.
- **LLM judge**: pre-scores every item, asked twice with swapped order to measure its own position bias;
  items where humans split, or the judge disagrees with the human majority, go to a **review queue**.
- **Results**: live dashboard (Supabase Realtime) with Bradley–Terry ratings + bootstrap CIs, win rates with Wilson CIs.
- **Export**: `{"prompt","chosen","rejected"}` JSONL for DPO, raw judgments, or per-item aggregates.

```
web/        Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui
api/        FastAPI · psycopg 3 · numpy · Groq (OpenAI-compatible API)
supabase/   schema.sql (tables, trigger, RLS, Realtime publication)
SPEC.md     API contract and conventions
```

## Architecture

```
Browser ── Supabase Auth (email/password, Google) ──► access token (JWT)
   │
   ├── REST + Bearer JWT ─► FastAPI ── psycopg pool ─► Supabase Postgres
   │                          └── httpx ─► Groq API (generation, LLM judge)
   └── Realtime (judgments, jobs) ◄──────────────────── Supabase Postgres
```

Task assignment uses `SELECT … FOR UPDATE SKIP LOCKED` so concurrent contributors never receive the same
slot, and each item stops being served once it reaches its target number of judgments.

## Setup

### 1. Supabase
1. Create a project at supabase.com.
2. SQL Editor → paste `supabase/schema.sql` → Run.
3. Authentication → Providers → **Google**: enable, paste your Google OAuth client ID/secret
   (Google Cloud Console → Credentials → OAuth client → Web; authorised redirect URI =
   `https://<ref>.supabase.co/auth/v1/callback`).
4. Authentication → URL Configuration: Site URL `http://localhost:3000`, add redirect URL
   `http://localhost:3000/auth/callback` (add your production URL later).
5. Optional for quick local testing: Authentication → Providers → Email → turn off "Confirm email".

The **first account that signs up becomes admin**. Everyone after that is a contributor; promote people in *Team*.

### 2. API
```bash
cd api
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt      # macOS/Linux: .venv/bin/pip
cp .env.example .env                                # fill in values
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```
`DATABASE_URL`: Supabase → Connect → "Session pooler" connection string (port 5432).

### 3. Web
```bash
cd web
npm install
cp .env.example .env.local                          # fill in values
npm run dev                                         # http://localhost:3000
```

### 4. Try it
1. Sign up (you become admin) → **New project**.
2. Items → upload `api/sample/prompts.csv` → **Generate responses** (e.g. `llama-3.1-8b-instant` vs `llama-3.3-70b-versatile`).
3. **Run LLM judge** → Settings → set status **Active**.
4. Have a few people sign up and annotate; watch the Overview update live.
5. Review queue → resolve disputes → Overview → **Export** preference pairs.

## Deploy (free tiers)
- **web** → Vercel (root directory `web`, env vars from `.env.example`).
- **api** → Render web service (root `api`, start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`), set `CORS_ORIGINS` to the Vercel URL.
- Add the Vercel URL + `/auth/callback` to Supabase redirect URLs.
