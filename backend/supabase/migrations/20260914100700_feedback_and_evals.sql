-- ============================================================================
-- 0008  Product feedback loop (append-only) and the evaluation set
-- ----------------------------------------------------------------------------
-- feedback_events is the ledger: what creators picked, approved, edited and
-- shipped. It is never updated or deleted. Derived state (ideas.status,
-- scripts.status) is maintained from it by trigger so every writer agrees.
-- ============================================================================

create table public.feedback_events (
  id            bigint generated always as identity primary key,
  creator_id    uuid not null references public.creators (id) on delete cascade,
  subject_type  text not null check (subject_type in ('idea', 'script', 'voice_profile', 'run')),
  subject_id    uuid not null,
  event         text not null check (event in (
                  'idea_picked', 'idea_dismissed',
                  'script_approved', 'script_rejected', 'script_edited',
                  'script_shipped', 'script_shipped_unedited',
                  'run_rated', 'voice_refined')),
  -- {edit_distance, chars_changed, rating, platform, post_url, ...}
  payload       jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at   timestamptz not null default now(),
  recorded_by   text not null default 'api' check (recorded_by in ('api', 'worker', 'cron', 'backfill')),
  constraint feedback_events_subject_matches_event check (
    (event like 'idea\_%'   and subject_type = 'idea') or
    (event like 'script\_%' and subject_type = 'script') or
    (event like 'run\_%'    and subject_type = 'run') or
    (event like 'voice\_%'  and subject_type = 'voice_profile'))
);

comment on table public.feedback_events is
  'Append-only ledger of creator behaviour. Source of truth for ideas/scripts status and for voice-profile refinement.';

create index feedback_events_creator_idx on public.feedback_events (creator_id, occurred_at desc);
create index feedback_events_subject_idx on public.feedback_events (subject_type, subject_id, occurred_at desc);
create index feedback_events_event_idx on public.feedback_events (event, occurred_at desc);

-- security definer: derived-state updates must succeed whoever appended the
-- event, even a client role that has no UPDATE policy on ideas / scripts.
create or replace function public.apply_feedback_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  case new.event
    when 'idea_picked' then
      update public.ideas
         set status = 'picked', picked_at = new.occurred_at
       where id = new.subject_id and status in ('proposed', 'dismissed');
    when 'idea_dismissed' then
      update public.ideas
         set status = 'dismissed', dismissed_at = new.occurred_at
       where id = new.subject_id and status = 'proposed';
    when 'script_approved' then
      update public.scripts
         set status = 'approved', approved_at = new.occurred_at
       where id = new.subject_id;
    when 'script_rejected' then
      update public.scripts
         set status = 'rejected'
       where id = new.subject_id;
    when 'script_shipped', 'script_shipped_unedited' then
      update public.scripts
         set status = 'shipped',
             shipped_at = new.occurred_at,
             shipped_unedited = (new.event = 'script_shipped_unedited')
       where id = new.subject_id;
      update public.ideas i
         set status = 'scripted'
        from public.scripts s
       where s.id = new.subject_id and i.id = s.idea_id and i.status <> 'archived';
    else
      null;
  end case;
  return new;
end
$$;

create trigger feedback_events_apply
  after insert on public.feedback_events
  for each row execute function public.apply_feedback_event();

-- Ledger semantics: no updates, no deletes (creator cascade still works
-- because FK cascades bypass row triggers only for the referencing rows).
create or replace function public.reject_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end
$$;

create trigger feedback_events_append_only
  before update on public.feedback_events
  for each row execute function public.reject_mutation();

-- ----------------------------------------------------------------------------
-- Evaluation set: (creator profile, idea) pairs with a reference script, the
-- eval runs that scored a prompt version, and the per-case judge scores.
-- Snapshots are stored inline (jsonb) rather than by FK so a case is stable
-- even after the live creator's profile changes.
-- ----------------------------------------------------------------------------
create table public.eval_cases (
  id                uuid primary key default public.uuid_generate_v7(),
  slug              text not null unique,
  creator_profile   jsonb not null check (jsonb_typeof(creator_profile) = 'object'),
  idea              jsonb not null check (jsonb_typeof(idea) = 'object'),
  reference_script  jsonb not null check (jsonb_typeof(reference_script) = 'object'),
  notes             text,
  tags              text[] not null default '{}'::text[],
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger eval_cases_set_updated_at
  before update on public.eval_cases
  for each row execute function public.set_updated_at();

create table public.eval_runs (
  id               uuid primary key default public.uuid_generate_v7(),
  graph            text not null check (graph in ('ideation', 'scripting')),
  prompt_version   text not null,
  model_routing    jsonb not null default '{}'::jsonb,
  judge_model      text not null,
  git_sha          text,
  langsmith_ref    text,
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  -- Aggregates filled in when the run finishes: {hook_strength, voice_match, structure, n}.
  summary          jsonb not null default '{}'::jsonb
);

create index eval_runs_prompt_version_idx on public.eval_runs (graph, prompt_version, started_at desc);

create table public.eval_scores (
  eval_run_id      uuid not null references public.eval_runs (id) on delete cascade,
  eval_case_id     uuid not null references public.eval_cases (id) on delete cascade,
  candidate        jsonb not null,
  hook_strength    numeric(4, 2) check (hook_strength between 0 and 10),
  voice_match      numeric(4, 2) check (voice_match between 0 and 10),
  structure        numeric(4, 2) check (structure between 0 and 10),
  judge_rationale  text,
  judge_raw        jsonb,
  tokens_in        bigint not null default 0,
  tokens_out       bigint not null default 0,
  cost_cents       numeric(12, 4) not null default 0,
  created_at       timestamptz not null default now(),
  primary key (eval_run_id, eval_case_id)
);
