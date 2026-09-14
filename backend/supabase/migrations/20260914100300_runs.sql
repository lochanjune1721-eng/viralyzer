-- ============================================================================
-- 0004  Runs: one row per graph execution, plus per-node usage
-- ----------------------------------------------------------------------------
-- The run row is the product-side handle for a LangGraph thread. Checkpoints
-- live in the `langgraph` schema and exist only to resume; everything a user
-- or a dashboard needs is here.
-- ============================================================================

create table public.runs (
  id               uuid primary key default public.uuid_generate_v7(),
  creator_id       uuid not null references public.creators (id) on delete cascade,
  -- Must match a key of viralyzer.graphs.GRAPHS. Extend the CHECK when the
  -- editing / posting graphs arrive.
  graph            text not null check (graph in ('ideation', 'scripting')),
  -- LangGraph thread id (configurable.thread_id). Never accepted from a client
  -- without joining back to creator_id -> user_id (see runs.assert_thread_owned).
  thread_id        uuid not null default gen_random_uuid(),
  status           text not null default 'queued'
                   check (status in ('queued', 'running', 'awaiting_input', 'complete', 'failed', 'cancelled')),
  -- Initial payload handed to graph.astream(); resume payloads go to resume_payload.
  input            jsonb not null default '{}'::jsonb check (jsonb_typeof(input) = 'object'),
  -- Value of the pending interrupt while status = awaiting_input.
  interrupt        jsonb,
  resume_payload   jsonb,
  resume_count     integer not null default 0,
  attempt          integer not null default 0,
  error            text,
  error_code       text,
  -- Cost instrumentation (rolled up from run_usage by trigger).
  tokens_in        bigint not null default 0,
  tokens_out       bigint not null default 0,
  cost_cents       numeric(12, 4) not null default 0,
  prompt_version   text,
  -- Client-supplied key for safe retries of POST /runs (Stripe-style).
  idempotency_key  text,
  worker_id        text,
  trace_id         text,
  queued_at        timestamptz not null default now(),
  started_at       timestamptz,
  finished_at      timestamptz,
  updated_at       timestamptz not null default now(),
  constraint runs_thread_id_key unique (thread_id)
);

comment on table public.runs is
  'One graph execution. status machine: queued -> running -> (awaiting_input -> queued -> running)* -> complete | failed | cancelled.';
comment on column public.runs.thread_id is
  'LangGraph thread id. Ownership check: runs.thread_id -> runs.creator_id -> creators.user_id = JWT sub.';

-- One active run per creator, enforced by the database rather than by a
-- check-then-insert in the API (which races).
create unique index runs_one_active_per_creator
  on public.runs (creator_id) where status in ('queued', 'running');

-- Idempotent POST /runs: same creator + same key -> same run.
create unique index runs_idempotency_key_idx
  on public.runs (creator_id, idempotency_key) where idempotency_key is not null;

create index runs_creator_queued_idx on public.runs (creator_id, queued_at desc);
create index runs_open_idx on public.runs (status, queued_at)
  where status in ('queued', 'running', 'awaiting_input');

create trigger runs_set_updated_at
  before update on public.runs
  for each row execute function public.set_updated_at();

-- Guard the status machine and stamp lifecycle timestamps in one place so
-- every writer (API, worker, ops SQL) gets the same behaviour.
create or replace function public.runs_guard_status()
returns trigger
language plpgsql
as $$
declare
  allowed boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  allowed := case old.status
    when 'queued'         then new.status in ('running', 'failed', 'cancelled')
    when 'running'        then new.status in ('awaiting_input', 'complete', 'failed', 'cancelled', 'queued')
    when 'awaiting_input' then new.status in ('queued', 'failed', 'cancelled')
    else false
  end;

  if not allowed then
    raise exception 'illegal run status transition % -> % for run %', old.status, new.status, old.id
      using errcode = 'check_violation';
  end if;

  if new.status = 'running' then
    new.started_at := coalesce(old.started_at, now());
    if old.status = 'queued' then
      new.attempt := old.attempt + 1;
    end if;
  end if;

  if old.status = 'awaiting_input' and new.status = 'queued' then
    new.resume_count := old.resume_count + 1;
    new.interrupt := null;
  end if;

  if new.status in ('complete', 'failed', 'cancelled') then
    new.finished_at := coalesce(new.finished_at, now());
  end if;

  return new;
end
$$;

create trigger runs_guard_status
  before update of status on public.runs
  for each row execute function public.runs_guard_status();

-- ----------------------------------------------------------------------------
-- Per-node, per-model usage. "Route models by node" only pays off if you can
-- see which node spends what. Totals roll up into runs.* by trigger.
-- ----------------------------------------------------------------------------
create table public.run_usage (
  id             bigint generated always as identity primary key,
  run_id         uuid not null references public.runs (id) on delete cascade,
  creator_id     uuid not null references public.creators (id) on delete cascade,
  node           text not null,
  model          text not null,
  provider       text,
  tokens_in      bigint not null default 0 check (tokens_in >= 0),
  tokens_out     bigint not null default 0 check (tokens_out >= 0),
  cached_tokens  bigint not null default 0 check (cached_tokens >= 0),
  cost_cents     numeric(12, 4) not null default 0 check (cost_cents >= 0),
  latency_ms     integer,
  recorded_at    timestamptz not null default now()
);

create index run_usage_run_idx on public.run_usage (run_id);
create index run_usage_creator_recorded_idx on public.run_usage (creator_id, recorded_at desc);

create or replace function public.run_usage_rollup()
returns trigger
language plpgsql
as $$
begin
  update public.runs
     set tokens_in  = tokens_in  + new.tokens_in,
         tokens_out = tokens_out + new.tokens_out,
         cost_cents = cost_cents + new.cost_cents
   where id = new.run_id;
  return new;
end
$$;

create trigger run_usage_rollup
  after insert on public.run_usage
  for each row execute function public.run_usage_rollup();

-- ----------------------------------------------------------------------------
-- Budget helpers. Spend is attributed to the month a run was queued.
-- ----------------------------------------------------------------------------
create or replace view public.creator_month_usage
with (security_invoker = true)
as
select
  creator_id,
  date_trunc('month', queued_at) as month,
  count(*)                                              as runs,
  count(*) filter (where status = 'complete')           as completed_runs,
  sum(tokens_in)                                        as tokens_in,
  sum(tokens_out)                                       as tokens_out,
  sum(cost_cents)                                       as cost_cents
from public.runs
group by creator_id, date_trunc('month', queued_at);

create or replace function public.budget_remaining_cents(p_creator_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select p.monthly_budget_cents
       - coalesce((
           select sum(r.cost_cents)
             from public.runs r
            where r.creator_id = c.id
              and r.queued_at >= date_trunc('month', now())
         ), 0)
    from public.creators c
    join public.plans p on p.key = c.plan_key
   where c.id = p_creator_id
$$;

comment on function public.budget_remaining_cents(uuid) is
  'Plan budget minus this calendar month''s spend. The worker refuses to start a run when this is <= 0.';
