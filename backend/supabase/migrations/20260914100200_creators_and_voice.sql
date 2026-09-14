-- ============================================================================
-- 0003  Creators (tenants), their platform accounts and content, and the
--       voice profile (first-class, versioned, never only in a checkpoint)
-- ============================================================================

create table public.creators (
  id                 uuid primary key default public.uuid_generate_v7(),
  -- Supabase Auth subject. One creator per auth user; RLS pivots on this.
  user_id            uuid not null unique references auth.users (id) on delete cascade,
  display_name       text,
  handle             text,
  niche              text not null references public.niches (key),
  audience           text,
  plan_key           text not null default 'free' references public.plans (key),
  onboarding_status  text not null default 'pending'
                     check (onboarding_status in ('pending', 'profiling', 'complete')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on table public.creators is
  'One row per creator = one tenant. Every product row carries creator_id so RLS is a single equality check.';

create index creators_niche_idx on public.creators (niche);

create trigger creators_set_updated_at
  before update on public.creators
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Platform accounts (replaces a bare text[] so each account can carry a handle,
-- follower count and the external id the research connectors need).
-- ----------------------------------------------------------------------------
create table public.creator_platforms (
  creator_id           uuid not null references public.creators (id) on delete cascade,
  platform             text not null references public.platforms (key),
  handle               text,
  external_account_id  text,
  followers            bigint check (followers is null or followers >= 0),
  is_primary           boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  primary key (creator_id, platform)
);

create unique index creator_platforms_one_primary_idx
  on public.creator_platforms (creator_id) where is_primary;

create trigger creator_platforms_set_updated_at
  before update on public.creator_platforms
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- The creator's own published content ("recent top performers"). Ingested at
-- onboarding through a research connector, refreshed periodically. Hot metrics
-- are typed columns; the long tail stays in metrics jsonb.
-- ----------------------------------------------------------------------------
create table public.creator_posts (
  id                uuid primary key default public.uuid_generate_v7(),
  creator_id        uuid not null references public.creators (id) on delete cascade,
  platform          text not null references public.platforms (key),
  external_id       text not null,
  url               text,
  title             text,
  caption           text,
  transcript        text,
  posted_at         timestamptz,
  duration_seconds  integer check (duration_seconds is null or duration_seconds >= 0),
  views             bigint check (views is null or views >= 0),
  likes             bigint check (likes is null or likes >= 0),
  comments          bigint check (comments is null or comments >= 0),
  shares            bigint check (shares is null or shares >= 0),
  metrics           jsonb not null default '{}'::jsonb check (jsonb_typeof(metrics) = 'object'),
  engagement_rate   real,
  is_top_performer  boolean not null default false,
  -- '<provider>#<endpoint>' of the connector that fetched it, or 'manual'.
  ingested_via      text,
  fetched_at        timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (creator_id, platform, external_id)
);

create index creator_posts_top_idx
  on public.creator_posts (creator_id, posted_at desc) where is_top_performer;
create index creator_posts_views_idx
  on public.creator_posts (creator_id, views desc nulls last);

create trigger creator_posts_set_updated_at
  before update on public.creator_posts
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Voice profile: the product. Current row here, immutable history below.
-- ----------------------------------------------------------------------------
create table public.voice_profiles (
  creator_id       uuid primary key references public.creators (id) on delete cascade,
  version          integer not null default 1 check (version >= 1),
  status           text not null default 'pending'
                   check (status in ('pending', 'ready', 'failed')),
  -- Structured rules the graphs inject verbatim: tone, vocabulary, pacing,
  -- signature phrases, things to avoid. Object, never an array.
  tone_rules       jsonb not null default '{}'::jsonb check (jsonb_typeof(tone_rules) = 'object'),
  -- Prose description for prompts ("Speaks fast, dry humour, ...").
  summary          text,
  embedding        extensions.vector(1536),
  embedding_model  text,
  source           text not null default 'onboarding'
                   check (source in ('onboarding', 'refinement', 'manual')),
  change_reason    text,
  refined_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.voice_profiles is
  'Current voice profile per creator. Every change bumps version and is snapshotted into voice_profile_versions by trigger.';

create table public.voice_profile_versions (
  id               uuid primary key default public.uuid_generate_v7(),
  creator_id       uuid not null references public.creators (id) on delete cascade,
  version          integer not null,
  tone_rules       jsonb not null,
  summary          text,
  embedding        extensions.vector(1536),
  embedding_model  text,
  source           text not null,
  reason           text,
  created_at       timestamptz not null default now(),
  unique (creator_id, version)
);

comment on table public.voice_profile_versions is
  'Append-only history of voice_profiles. Written by trigger only; lets refinements be diffed and rolled back.';

create or replace function public.voice_profiles_bump_version()
returns trigger
language plpgsql
as $$
begin
  if new.tone_rules is distinct from old.tone_rules
     or new.summary is distinct from old.summary
     or new.embedding::text is distinct from old.embedding::text then
    new.version := old.version + 1;
    new.refined_at := now();
  end if;
  return new;
end
$$;

-- security definer: a creator may update their own voice_profiles row, but the
-- history table has no client INSERT policy, so the snapshot runs as the owner.
create or replace function public.voice_profiles_snapshot_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.voice_profile_versions
    (creator_id, version, tone_rules, summary, embedding, embedding_model, source, reason)
  values
    (new.creator_id, new.version, new.tone_rules, new.summary, new.embedding,
     new.embedding_model, new.source, new.change_reason)
  on conflict (creator_id, version) do nothing;
  return new;
end
$$;

create trigger voice_profiles_set_updated_at
  before update on public.voice_profiles
  for each row execute function public.set_updated_at();

create trigger voice_profiles_bump_version
  before update on public.voice_profiles
  for each row execute function public.voice_profiles_bump_version();

create trigger voice_profiles_snapshot_version
  after insert or update on public.voice_profiles
  for each row execute function public.voice_profiles_snapshot_version();

-- ----------------------------------------------------------------------------
-- Voice samples: the "sample_scripts" of the brief, one row each so they can
-- be embedded, weighted, traced to their origin and retrieved by similarity
-- for few-shot prompting. Shipped scripts feed back in here (feedback loop).
-- ----------------------------------------------------------------------------
create table public.voice_samples (
  id                uuid primary key default public.uuid_generate_v7(),
  creator_id        uuid not null references public.creators (id) on delete cascade,
  kind              text not null check (kind in ('existing_content', 'shipped_script', 'manual')),
  title             text,
  body              text not null check (length(body) > 0),
  platform          text references public.platforms (key),
  source_post_id    uuid references public.creator_posts (id) on delete set null,
  -- FK to public.scripts is added in 0005 (table does not exist yet).
  source_script_id  uuid,
  performance       jsonb not null default '{}'::jsonb,
  embedding         extensions.vector(1536),
  embedding_model   text,
  weight            real not null default 1.0 check (weight >= 0),
  created_at        timestamptz not null default now()
);

create index voice_samples_creator_idx on public.voice_samples (creator_id, created_at desc);
create index voice_samples_embedding_idx
  on public.voice_samples using hnsw (embedding extensions.vector_cosine_ops);
