-- Arbiter — human evaluation workbench
-- Run this once in the Supabase SQL editor (Dashboard -> SQL Editor -> New query -> paste -> Run).
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE where possible.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Profiles (one row per auth user, created by trigger)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  role        text not null default 'contributor' check (role in ('admin','reviewer','contributor')),
  status      text not null default 'active' check (status in ('active','suspended')),
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url',
    -- the very first user becomes admin
    case when not exists (select 1 from public.profiles) then 'admin' else 'contributor' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Projects
-- rubric: [{ "key": "helpfulness", "label": "Helpfulness", "description": "..." }, ...]
-- ---------------------------------------------------------------------------
create table if not exists public.projects (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  description          text not null default '',
  instructions         text not null default '',
  rubric               jsonb not null default '[]'::jsonb,
  status               text not null default 'draft' check (status in ('draft','active','paused','completed')),
  judgments_per_item   int  not null default 3 check (judgments_per_item between 1 and 10),
  min_reason_chars     int  not null default 20,
  min_seconds          int  not null default 8,      -- faster than this => flagged too_fast
  gold_rate            numeric not null default 0.1, -- probability a served task is a gold item
  gold_min_accuracy    numeric not null default 0.6, -- auto-pause below this after gold_min_count golds
  gold_min_count       int  not null default 5,
  judge_model          text not null default 'openai/gpt-oss-120b',
  created_by           uuid references public.profiles(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Items: one prompt + two responses. Canonical order is A/B as stored.
-- preference convention everywhere: -2 A much better, -1 A better, 0 tie, 1 B better, 2 B much better
-- gold_preference: -1 (A), 0 (tie), 1 (B)
-- ---------------------------------------------------------------------------
create table if not exists public.items (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  prompt           text not null,
  response_a       text,
  response_b       text,
  model_a          text,
  model_b          text,
  is_gold          boolean not null default false,
  gold_preference  smallint check (gold_preference in (-1,0,1)),
  gold_explanation text,
  metadata         jsonb not null default '{}'::jsonb,
  judgments_count  int not null default 0,
  created_at       timestamptz not null default now()
);
create index if not exists items_project_idx on public.items(project_id);
create index if not exists items_project_count_idx on public.items(project_id, judgments_count);

-- ---------------------------------------------------------------------------
-- Assignments: an item handed to a contributor. swapped=true means B shown on the left.
-- ---------------------------------------------------------------------------
create table if not exists public.assignments (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  item_id       uuid not null references public.items(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  swapped       boolean not null default false,
  status        text not null default 'assigned' check (status in ('assigned','submitted','skipped','expired')),
  assigned_at   timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '30 minutes',
  submitted_at  timestamptz,
  unique (item_id, user_id)
);
create index if not exists assignments_user_idx on public.assignments(user_id, project_id, status);
create index if not exists assignments_item_idx on public.assignments(item_id, status);

-- ---------------------------------------------------------------------------
-- Human judgments (always stored in canonical A/B terms, never screen position)
-- criteria: { "<rubric key>": -1 | 0 | 1 }
-- ---------------------------------------------------------------------------
create table if not exists public.judgments (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null unique references public.assignments(id) on delete cascade,
  project_id     uuid not null references public.projects(id) on delete cascade,
  item_id        uuid not null references public.items(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  preference     smallint not null check (preference between -2 and 2),
  criteria       jsonb not null default '{}'::jsonb,
  reason         text not null default '',
  duration_ms    int not null default 0,
  swapped        boolean not null default false,
  too_fast       boolean not null default false,
  is_gold        boolean not null default false,
  gold_correct   boolean,
  flagged        boolean not null default false,
  flag_note      text,
  created_at     timestamptz not null default now()
);
create index if not exists judgments_project_idx on public.judgments(project_id, created_at);
create index if not exists judgments_item_idx on public.judgments(item_id);
create index if not exists judgments_user_idx on public.judgments(user_id, project_id);

-- ---------------------------------------------------------------------------
-- LLM judge verdicts (one per item per judge model)
-- consistent=false when the judge flipped its answer after swapping order
-- ---------------------------------------------------------------------------
create table if not exists public.llm_judgments (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  item_id     uuid not null references public.items(id) on delete cascade,
  model       text not null,
  preference  smallint not null check (preference between -2 and 2),
  criteria    jsonb not null default '{}'::jsonb,
  rationale   text not null default '',
  consistent  boolean not null default true,
  raw         jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  unique (item_id, model)
);
create index if not exists llm_judgments_project_idx on public.llm_judgments(project_id);

-- ---------------------------------------------------------------------------
-- Reviewer decisions that resolve disputed items
-- ---------------------------------------------------------------------------
create table if not exists public.reviews (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.projects(id) on delete cascade,
  item_id           uuid not null unique references public.items(id) on delete cascade,
  reviewer_id       uuid references public.profiles(id) on delete set null,
  final_preference  smallint not null check (final_preference between -2 and 2),
  note              text not null default '',
  created_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Per-project contributor state (auto-pause on low gold accuracy)
-- ---------------------------------------------------------------------------
create table if not exists public.project_contributors (
  project_id    uuid not null references public.projects(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  status        text not null default 'active' check (status in ('active','paused')),
  paused_reason text,
  override      boolean not null default false, -- admin reinstated: ignore auto-pause
  updated_at    timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Background jobs (response generation, LLM judging) for progress bars
-- ---------------------------------------------------------------------------
create table if not exists public.jobs (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  kind         text not null check (kind in ('generate','judge')),
  status       text not null default 'queued' check (status in ('queued','running','completed','failed','cancelled')),
  total        int not null default 0,
  done         int not null default 0,
  failed       int not null default 0,
  error        text,
  params       jsonb not null default '{}'::jsonb,
  created_by   uuid references public.profiles(id) on delete set null,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index if not exists jobs_project_idx on public.jobs(project_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- The FastAPI backend connects with the Postgres connection string (bypasses RLS).
-- The browser only reads directly for Realtime change notifications, so we expose
-- minimal SELECT policies and no direct writes.
-- ---------------------------------------------------------------------------
alter table public.profiles             enable row level security;
alter table public.projects             enable row level security;
alter table public.items                enable row level security;
alter table public.assignments          enable row level security;
alter table public.judgments            enable row level security;
alter table public.llm_judgments        enable row level security;
alter table public.reviews              enable row level security;
alter table public.project_contributors enable row level security;
alter table public.jobs                 enable row level security;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','reviewer'));
$$;

drop policy if exists "own profile" on public.profiles;
create policy "own profile" on public.profiles for select using (id = auth.uid() or public.is_staff());

drop policy if exists "read projects" on public.projects;
create policy "read projects" on public.projects for select to authenticated using (true);

drop policy if exists "staff read judgments" on public.judgments;
create policy "staff read judgments" on public.judgments for select using (public.is_staff() or user_id = auth.uid());

drop policy if exists "staff read jobs" on public.jobs;
create policy "staff read jobs" on public.jobs for select using (public.is_staff());

drop policy if exists "staff read llm" on public.llm_judgments;
create policy "staff read llm" on public.llm_judgments for select using (public.is_staff());

drop policy if exists "staff read reviews" on public.reviews;
create policy "staff read reviews" on public.reviews for select using (public.is_staff());

-- ---------------------------------------------------------------------------
-- Realtime: dashboard subscribes to new judgments and job progress
-- ---------------------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.judgments; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.jobs;      exception when duplicate_object then null; end;
end $$;
