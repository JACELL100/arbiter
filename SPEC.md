# Arbiter — Human Evaluation Workbench (build spec)

Arbiter lets an AI lab run side-by-side (pairwise) human evaluations of model outputs:
admins upload prompts (or generate responses with Groq), contributors compare Response A vs B
with a rubric, the system enforces quality (gold items, agreement, too-fast detection), an LLM
judge pre-scores items, disputes go to a reviewer queue, and the result exports as DPO/RLHF JSONL.

```
web/      Next.js 15+ App Router, TypeScript, Tailwind, shadcn/ui  (port 3000)
api/      FastAPI, Python 3.11, psycopg 3 (direct Postgres)        (port 8000)
supabase/schema.sql   the single source of truth for the database
```

## Conventions (everyone must follow)

- **Preference scale**: integer `-2..2`. `-2` A much better, `-1` A better, `0` tie, `1` B better, `2` B much better.
  Always stored/returned in **canonical A/B** terms. The screen may show B on the left (`swapped=true`);
  the backend translates. The frontend sends what the user picked **in screen terms** (`left`/`right`) — see `/submit`.
- **Criteria value**: `-1` A better, `0` tie, `1` B better (canonical).
- **Gold preference**: `-1 | 0 | 1`. A gold judgment is correct when `sign(preference) == gold_preference`.
- JSON is **snake_case**. Timestamps ISO-8601 strings. IDs are UUID strings.
- Auth: browser gets a Supabase session; every API call sends `Authorization: Bearer <supabase access_token>`.
- Roles: `admin` (everything), `reviewer` (read all projects, stats, review queue), `contributor` (annotate only).
  The first user to sign up becomes `admin` (DB trigger).
- Errors: FastAPI `HTTPException` -> `{"detail": "human readable message"}`.

## Environment

`api/.env`
```
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_JWT_SECRET=...          # optional; legacy HS256 secret. If absent, JWKS / auth endpoint is used
GROQ_API_KEY=...
CORS_ORIGINS=http://localhost:3000
```

`web/.env.local`
```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_API_URL=http://localhost:8000
```

## API (all under `/api/v1`, all require auth unless noted)

Role legend: [A] admin, [R] admin or reviewer, [C] any signed-in user.

### Health / me
- `GET /health` (no auth) -> `{"ok": true}`
- `GET /me` [C] -> `Profile`
- `PATCH /me` [C] body `{full_name?}` -> `Profile`

`Profile = {id, email, full_name, avatar_url, role, status, created_at}`

### Users
- `GET /users` [A] -> `UserRow[]` where `UserRow = Profile & {judgments_count, last_active_at|null}`
- `PATCH /users/{id}` [A] body `{role?, status?}` -> `Profile` (cannot demote yourself)

### Projects
- `GET /projects` [C]
  - staff: all projects; contributors: only `status='active'`.
  - -> `ProjectSummary[]`
  `ProjectSummary = Project & {items_count, gold_count, ready_items_count, judgments_count, target_judgments, progress (0..1), my_judgments_count, contributors_count}`
  (`ready_items_count` = non-gold items with both responses present; `target_judgments` = ready non-gold items × judgments_per_item)
- `POST /projects` [A] body `ProjectInput` -> `Project`
- `GET /projects/{id}` [C] -> `ProjectSummary`
- `PATCH /projects/{id}` [A] body partial `ProjectInput` (+ `status`) -> `Project`
- `DELETE /projects/{id}` [A] -> `{"ok": true}`

```
Project = {
  id, name, description, instructions,
  rubric: [{key, label, description}],
  status: 'draft'|'active'|'paused'|'completed',
  judgments_per_item, min_reason_chars, min_seconds,
  gold_rate, gold_min_accuracy, gold_min_count, judge_model,
  created_by, created_at, updated_at
}
ProjectInput = Project minus {id, created_by, created_at, updated_at, status}
```

### Items
- `GET /projects/{id}/items?limit=50&offset=0&filter=all|gold|pending|disputed&q=` [R]
  -> `{items: ItemRow[], total}`
  `ItemRow = Item & {human_votes: {a: n, tie: n, b: n}, human_mean: number|null, llm_preference: number|null, llm_consistent: bool|null, review_preference: number|null, disputed: bool}`
  `Item = {id, project_id, prompt, response_a, response_b, model_a, model_b, is_gold, gold_preference, gold_explanation, metadata, judgments_count, created_at}`
  `pending` = missing a response.
- `POST /projects/{id}/items/upload` [A] multipart `file` (.csv or .jsonl)
  - columns/keys: `prompt` (required), `response_a`, `response_b`, `model_a`, `model_b`,
    `is_gold` (true/false/1/0/yes), `gold` (`A`|`B`|`tie`), `gold_explanation`; any other columns -> `metadata`.
  - -> `{inserted, skipped, errors: [{row, message}]}`
- `POST /projects/{id}/items` [A] body `{prompt, response_a?, response_b?, model_a?, model_b?, is_gold?, gold_preference?, gold_explanation?}` -> `Item`
- `GET /projects/{id}/items/{item_id}` [R] -> `ItemDetail`
  `ItemDetail = ItemRow & {judgments: [Judgment & {user_email, user_name}], llm_judgment: LlmJudgment|null, review: Review|null}`
- `DELETE /projects/{id}/items/{item_id}` [A]
- `POST /projects/{id}/items/{item_id}/review` [R] body `{final_preference, note}` -> `Review`

### LLM (Groq)
- `GET /llm/models` [A] -> `[{id, owned_by}]` (proxied from Groq `/openai/v1/models`, chat models only, cached 10 min).
  If no key, return a static fallback list: `llama-3.1-8b-instant`, `llama-3.3-70b-versatile`, `openai/gpt-oss-20b`, `openai/gpt-oss-120b`.
- `POST /projects/{id}/generate` [A] body `{model_a, model_b, overwrite: false, system_prompt?: string, max_tokens?: 700}`
  Fills `response_a/response_b/model_a/model_b` for items missing responses (or all non-gold if overwrite). Background job. -> `Job`
- `POST /projects/{id}/judge` [A] body `{model?: string (default project.judge_model), both_orders: true, overwrite: false}`
  Runs the LLM judge on every item with both responses. With `both_orders`, the judge is asked twice (A/B and B/A);
  if the two verdicts disagree in sign, `consistent=false` and `preference=0`. Background job. -> `Job`
- `GET /projects/{id}/jobs` [R] -> `Job[]` (latest 20)
- `POST /jobs/{job_id}/cancel` [A] -> `Job`

`Job = {id, project_id, kind, status, total, done, failed, error, params, created_at, finished_at}`

### Annotation (contributor flow)
- `POST /projects/{id}/next` [C]
  - Project must be `active` (staff may annotate draft projects to test).
  - If the user is paused for this project (low gold accuracy, no override) -> `403 {"detail": "paused: ..."}`.
  - Returns the user's open unexpired assignment if one exists; otherwise picks a new item in one transaction:
    ready items (both responses), not previously assigned to this user, fewer than `judgments_per_item`
    active+submitted assignments (gold items have no cap), with probability `gold_rate` prefer a gold item;
    order by `judgments_count asc, random()`; `FOR UPDATE SKIP LOCKED`.
    Inserts assignment with random `swapped`, `expires_at = now()+30min`.
  - -> `Task` or `{"done": true}` when nothing left.
  ```
  Task = {
    assignment_id, item_id, project: {id, name, instructions, rubric, min_reason_chars, min_seconds},
    prompt, left: {text}, right: {text},     // already in screen order; NO model names, NO gold info
    assigned_at, expires_at,
    progress: {my_judgments, remaining_items}
  }
  ```
- `POST /assignments/{assignment_id}/submit` [C] (owner only, status must be `assigned`)
  body
  ```
  { choice: -2..2,              // SCREEN terms: -2 left much better ... 2 right much better
    criteria: {key: -1|0|1},     // SCREEN terms: -1 left, 0 tie, 1 right
    reason: string,              // must be >= project.min_reason_chars after trim
    duration_ms: int,
    flagged?: bool, flag_note?: string }
  ```
  Backend converts to canonical (`if swapped: negate`), computes `too_fast = duration_ms < min_seconds*1000`,
  gold correctness, increments `items.judgments_count`, marks assignment submitted, then re-evaluates gold accuracy
  and auto-pauses the user for the project if `golds >= gold_min_count and accuracy < gold_min_accuracy` and no override.
  -> `{ok: true, gold_feedback: null | {correct: bool, expected: -1|0|1, explanation: string|null}, paused: bool}`
  (Gold feedback is shown to the contributor after submitting a gold item — this is how they learn the guidelines.)
- `POST /assignments/{assignment_id}/skip` [C] body `{reason?}` -> `{ok: true}`
- `GET /me/stats` [C] -> `{total_judgments, projects: [{project_id, project_name, judgments, gold_accuracy|null, golds, too_fast_rate, agreement_rate|null, median_seconds|null, status}]}`

### Contributors (per project)
- `GET /projects/{id}/contributors` [R] -> `ContributorRow[]`
  `ContributorRow = {user_id, email, full_name, judgments, golds, gold_accuracy|null, too_fast_rate, median_seconds|null, agreement_rate|null, left_bias|null, status: 'active'|'paused', paused_reason|null, override, last_active_at}`
  `agreement_rate` = share of their non-gold judgments whose sign matches the item's majority sign excluding themselves (items with ≥2 other votes).
  `left_bias` = share of their non-tie judgments that chose the left side.
- `PATCH /projects/{id}/contributors/{user_id}` [A] body `{status: 'active'|'paused', override?: bool}` -> `ContributorRow`

### Stats (live dashboard)
- `GET /projects/{id}/stats` [R] ->
```
{
  totals: {items, gold_items, ready_items, judgments, contributors, target_judgments, progress, disputed, reviewed, llm_judged},
  models: [{model, wins, losses, ties, comparisons, win_rate, win_rate_ci: [lo, hi], bt_score, bt_ci: [lo, hi]}],
     // win_rate = (wins + 0.5*ties)/comparisons, Wilson 95% CI on wins+half ties.
     // bt_score: Bradley–Terry strength on an Elo-like scale (1000 + 400*log10(p)), ties count half; 95% CI via 200 bootstrap resamples over items.
  agreement: {
     krippendorff_alpha: number|null,      // interval metric on -2..2, items with >=2 non-gold votes
     fleiss_kappa: number|null,            // 3 categories: A / tie / B
     pairwise_agreement: number|null,      // share of rater pairs on the same item that agree on sign
     llm_human_agreement: number|null,     // share of items where sign(llm) == human majority sign
     llm_human_kappa: number|null,         // Cohen's kappa on 3 categories
     llm_consistency: number|null          // share of llm judgments with consistent=true
  },
  position_bias: {left_rate: number|null, n: int},   // humans; 0.5 is unbiased
  quality: {too_fast_rate, gold_accuracy|null, flagged_count, paused_contributors},
  criteria: [{key, label, models: [{model, win_rate, n}]}],
  timeline: [{bucket: ISO hour, judgments: n}],    // last 48 hours, hourly
  preference_histogram: [{value: -2..2, count}]
}
```

### Review queue
- `GET /projects/{id}/review-queue?limit=50&offset=0` [R] -> `{items: ReviewQueueRow[], total}`
  An item is **disputed** (and appears here until reviewed) when it is non-gold, has ≥ min(2, judgments_per_item) human votes, and any of:
  1. humans split: no sign category has a strict majority, or
  2. LLM disagrees: llm judgment exists and `sign(llm) != human majority sign`, or
  3. any judgment on it is `flagged`.
  `ReviewQueueRow = ItemRow & {reasons: ('human_split'|'llm_disagrees'|'flagged')[]}`

### Export
- `GET /projects/{id}/export?format=dpo|raw|items` [R] -> streamed `application/x-ndjson` with `Content-Disposition: attachment`.
  - `dpo`: one line per non-gold item with a decided winner (review decision wins; else human majority sign with strict majority; ties dropped):
    `{"prompt", "chosen", "rejected", "chosen_model", "rejected_model", "margin" (abs mean preference), "votes", "agreement" (share of votes agreeing with winner), "source": "review"|"human_majority", "item_id"}`
  - `raw`: every human judgment in canonical terms with item_id, user_id, preference, criteria, reason, duration_ms, swapped, too_fast, is_gold, gold_correct, created_at.
  - `items`: every item with aggregated votes and llm verdict.

## Frontend routes

```
/                         marketing-light landing (signed-in users -> /app)
/login  /signup           email+password and "Continue with Google"
/auth/callback            Supabase OAuth code exchange (route handler)
/app                      home: contributor => available projects + my stats; staff => projects overview
/app/projects/new         [A] create project (rubric builder)
/app/projects/[id]        project workspace, tabs:
      overview (live dashboard) | items | contributors | review | settings
/app/projects/[id]/annotate   focused annotation screen (keyboard-first)
/app/team                 [A] users & roles
```

## UI direction (important)

Professional data-tool aesthetic — think Linear / Vercel / Stripe dashboard. NOT "AI slop":
- Neutral zinc palette, white background, 1px borders, small radii (6px), no gradients, no glow, no emoji, no purple.
  One accent color only: near-black primary buttons; semantic colors only for status (emerald ok, amber warn, red error).
- Font: Geist Sans (already in Next scaffold) + Geist Mono for numbers, IDs, keyboard hints.
- Dense, aligned tables; tabular-nums for numbers; sentence case labels; concise copy.
- Every async state handled: skeletons for loading, empty states with one clear action, toast (sonner) on errors.
- Keyboard hints rendered as `<kbd>` chips.
