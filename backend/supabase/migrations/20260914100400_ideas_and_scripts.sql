-- ============================================================================
-- 0005  Ideas and scripts (product artifacts written by graph nodes / worker)
-- ============================================================================

create table public.ideas (
  id              uuid primary key default public.uuid_generate_v7(),
  creator_id      uuid not null references public.creators (id) on delete cascade,
  -- Provenance. Nullable + set null so pruning old runs never deletes ideas.
  run_id          uuid references public.runs (id) on delete set null,
  rank            smallint check (rank is null or rank >= 1),
  hook            text not null check (length(hook) between 1 and 500),
  angle           text not null,
  format          text not null,
  rationale       text not null,
  score           numeric(5, 2),
  status          text not null default 'proposed'
                  check (status in ('proposed', 'picked', 'dismissed', 'scripted', 'archived')),
  picked_at       timestamptz,
  dismissed_at    timestamptz,
  prompt_version  text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.ideas is
  'Ranked ideas from an ideation run. status is derived state maintained by feedback_events triggers.';

create index ideas_creator_status_idx on public.ideas (creator_id, status, created_at desc);
create index ideas_run_rank_idx on public.ideas (run_id, rank);

create trigger ideas_set_updated_at
  before update on public.ideas
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Scripts: append-only revisions. One row per version, `is_current` marks the
-- head. Updating a script means inserting a new version, never rewriting body.
-- ----------------------------------------------------------------------------
create table public.scripts (
  id                   uuid primary key default public.uuid_generate_v7(),
  idea_id              uuid not null references public.ideas (id) on delete cascade,
  creator_id           uuid not null references public.creators (id) on delete cascade,
  run_id               uuid references public.runs (id) on delete set null,
  -- Assigned by trigger when null: max(version) + 1 for the idea.
  version              integer not null check (version >= 1),
  parent_script_id     uuid references public.scripts (id) on delete set null,
  revision_kind        text not null
                       check (revision_kind in ('draft', 'critique_revision', 'human_edit', 'regenerate')),
  is_current           boolean not null default true,
  platform             text references public.platforms (key),
  target_seconds       integer check (target_seconds is null or target_seconds > 0),
  aspect               text,
  -- Structured script: {hook, beats[], broll[], cta, meta}. Shape is versioned
  -- by body_schema_version so old rows stay readable after prompt changes.
  body                 jsonb not null
                       check (jsonb_typeof(body) = 'object' and body ? 'hook' and body ? 'beats' and body ? 'cta'),
  body_schema_version  smallint not null default 1,
  -- Critique that produced (or will produce) the next revision.
  critique             jsonb,
  status               text not null default 'draft'
                       check (status in ('draft', 'awaiting_approval', 'approved', 'rejected', 'final', 'shipped')),
  approved_at          timestamptz,
  shipped_at           timestamptz,
  shipped_unedited     boolean,
  prompt_version       text,
  model                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (idea_id, version)
);

comment on table public.scripts is
  'Script revisions. Append a row per draft/critique/human edit; is_current marks the head (one per idea).';

create unique index scripts_one_current_per_idea_idx on public.scripts (idea_id) where is_current;
create index scripts_creator_idx on public.scripts (creator_id, created_at desc);
create index scripts_run_idx on public.scripts (run_id);

create trigger scripts_set_updated_at
  before update on public.scripts
  for each row execute function public.set_updated_at();

create or replace function public.scripts_before_insert()
returns trigger
language plpgsql
as $$
begin
  if new.version is null then
    select coalesce(max(version), 0) + 1 into new.version
      from public.scripts where idea_id = new.idea_id;
  end if;
  if new.is_current then
    update public.scripts
       set is_current = false
     where idea_id = new.idea_id and is_current and id <> new.id;
  end if;
  return new;
end
$$;

create trigger scripts_before_insert
  before insert on public.scripts
  for each row execute function public.scripts_before_insert();

-- Head revision per idea. security_invoker keeps RLS of the caller.
create view public.script_heads
with (security_invoker = true)
as
select * from public.scripts where is_current;

-- ----------------------------------------------------------------------------
-- Back-references that had to wait for these tables to exist.
-- ----------------------------------------------------------------------------
alter table public.runs
  add column idea_id uuid references public.ideas (id) on delete set null;
create index runs_idea_idx on public.runs (idea_id) where idea_id is not null;
comment on column public.runs.idea_id is 'Chosen idea for scripting runs; null for ideation runs.';

alter table public.voice_samples
  add constraint voice_samples_source_script_id_fkey
  foreign key (source_script_id) references public.scripts (id) on delete set null;
