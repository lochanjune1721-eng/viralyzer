-- ============================================================================
-- 0007  `research` schema: Monid connector calls and the sources they return
-- ----------------------------------------------------------------------------
-- Monid addresses every tool as '<provider>#<endpoint>' (octen#search,
-- tinyfish#fetch, exa#search, akta#news, ...) and meters each call in
-- provider-specific units. The storage model is therefore three layers:
--
--   research.connectors    registry of endpoints we call (one row per slug)
--   research.calls         one row per invocation: params, status, usage, cost,
--                          raw response (cache + audit)
--   research.sources       deduplicated documents across all connectors
--   research.call_results  ranked link call -> source with the connector's
--                          verbatim result item in `raw`
--
-- A connector whose results deserve typed columns gets an extension table
-- keyed by source_id (research.social_posts is the first) and registers it in
-- connectors.result_table. Adding a connector = one insert; adding typed
-- columns for it = one new table; nothing else changes.
-- ============================================================================

create schema if not exists research;

comment on schema research is
  'Search-source storage for Monid connectors. Shared across tenants; only research.calls is creator-attributed.';

create table research.connectors (
  slug                   text primary key check (slug ~ '^[a-z0-9-]+#[a-z0-9-]+$'),
  provider               text not null,
  endpoint               text not null,
  kind                   text not null
                         check (kind in ('web_search', 'fetch', 'extract', 'embedding', 'social', 'news', 'company', 'other')),
  -- Fully-qualified extension table holding typed results, if any.
  result_table           text,
  result_schema_version  smallint not null default 1,
  -- How to turn `usage` into money, e.g. {"unit": "credits", "usd_per_unit": 0.05}.
  pricing                jsonb not null default '{}'::jsonb,
  default_params         jsonb not null default '{}'::jsonb,
  is_enabled             boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (provider, endpoint)
);

create trigger research_connectors_set_updated_at
  before update on research.connectors
  for each row execute function public.set_updated_at();

insert into research.connectors (slug, provider, endpoint, kind, pricing) values
  ('octen#search',       'octen',    'search',       'web_search', '{"unit": "calls"}'),
  ('octen#broad-search', 'octen',    'broad-search', 'web_search', '{"unit": "calls"}'),
  ('octen#extract',      'octen',    'extract',      'extract',    '{"unit": "urls"}'),
  ('octen#embedding',    'octen',    'embedding',    'embedding',  '{"unit": "tokens"}'),
  ('exa#search',         'exa',      'search',       'web_search', '{"unit": "usd"}'),
  ('exa#contents',       'exa',      'contents',     'fetch',      '{"unit": "usd"}'),
  ('tinyfish#search',    'tinyfish', 'search',       'web_search', '{"unit": "calls", "usd_per_unit": 0}'),
  ('tinyfish#fetch',     'tinyfish', 'fetch',        'fetch',      '{"unit": "calls", "usd_per_unit": 0}'),
  ('akta#news',          'akta',     'news',         'news',       '{"unit": "credits", "usd_per_unit": 0.05}')
on conflict (slug) do nothing;

-- ----------------------------------------------------------------------------
create table research.calls (
  id               uuid primary key default public.uuid_generate_v7(),
  connector_slug   text not null references research.connectors (slug),
  -- Monid's own run id (monid_get_run) for support / reconciliation.
  monid_run_id     text,
  purpose          text not null
                   check (purpose in ('niche_research', 'ideation', 'voice_profile', 'creator_posts', 'eval', 'adhoc')),
  run_id           uuid references public.runs (id) on delete set null,
  creator_id       uuid references public.creators (id) on delete set null,
  niche            text references public.niches (key),
  query            text,
  params           jsonb not null default '{}'::jsonb check (jsonb_typeof(params) = 'object'),
  -- Cache key: same connector + same normalised params = same answer for a while.
  params_hash      text generated always as (public.sha256_hex(connector_slug || ':' || params::text)) stored,
  status           text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  error            text,
  -- Provider-specific metering exactly as returned (calls, credits, tokens, usd ...).
  usage            jsonb not null default '{}'::jsonb,
  -- Normalised cost in micro-dollars so spend is summable across providers.
  cost_usd_micros  bigint check (cost_usd_micros is null or cost_usd_micros >= 0),
  result_count     integer,
  -- Full payload for replay/debug. TOASTed; research.prune_call_payloads() nulls it later.
  raw_response     jsonb,
  latency_ms       integer,
  requested_at     timestamptz not null default now(),
  completed_at     timestamptz,
  expires_at       timestamptz
);

comment on table research.calls is
  'One row per connector invocation. (connector_slug, params_hash) is the cache key; usage/cost make Monid spend attributable to runs.';

create index research_calls_cache_idx
  on research.calls (connector_slug, params_hash, requested_at desc) where status = 'succeeded';
create index research_calls_run_idx on research.calls (run_id) where run_id is not null;
create index research_calls_creator_idx on research.calls (creator_id, requested_at desc) where creator_id is not null;
create index research_calls_niche_idx on research.calls (niche, requested_at desc) where niche is not null;

-- ----------------------------------------------------------------------------
create table research.sources (
  id                  uuid primary key default public.uuid_generate_v7(),
  -- Canonicalised by the application (scheme+host lowercased, tracking params
  -- and fragments stripped) before insert; url_hash is the dedupe key.
  url                 text not null check (url ~ '^https?://'),
  url_hash            text generated always as (public.sha256_hex(url)) stored,
  domain              text generated always as (lower(substring(url from '^[a-zA-Z][a-zA-Z0-9+.-]*://([^/?#]+)'))) stored,
  kind                text not null default 'web'
                      check (kind in ('web', 'video', 'social_post', 'news', 'paper', 'other')),
  title               text,
  author              text,
  published_at        timestamptz,
  language            text,
  snippet             text,
  -- Full text when a fetch/extract connector has been run on it.
  content             text,
  content_hash        text,
  content_fetched_at  timestamptz,
  embedding           extensions.vector(1536),
  embedding_model     text,
  metadata            jsonb not null default '{}'::jsonb,
  first_seen_at       timestamptz not null default now(),
  last_seen_at        timestamptz not null default now(),
  seen_count          integer not null default 1,
  unique (url_hash)
);

comment on table research.sources is
  'Deduplicated documents across connectors. Product tables cite these (idea_sources, niche_research_sources).';

create index research_sources_domain_idx on research.sources (domain);
create index research_sources_published_idx on research.sources (published_at desc nulls last);
create index research_sources_embedding_idx
  on research.sources using hnsw (embedding extensions.vector_cosine_ops);

-- ----------------------------------------------------------------------------
create table research.call_results (
  call_id     uuid not null references research.calls (id) on delete cascade,
  source_id   uuid not null references research.sources (id) on delete cascade,
  rank        integer not null check (rank >= 1),
  score       real,
  snippet     text,
  highlights  text[],
  -- The connector's result item verbatim. Promote keys to typed columns (an
  -- extension table) once they are queried, not before.
  raw         jsonb not null default '{}'::jsonb,
  primary key (call_id, rank),
  unique (call_id, source_id)
);

create index research_call_results_source_idx on research.call_results (source_id);

-- ----------------------------------------------------------------------------
-- Typed extension table #1: social posts (trend research, top performers).
-- Register a connector with result_table = 'research.social_posts' and the
-- worker writes here in addition to call_results.
-- ----------------------------------------------------------------------------
create table research.social_posts (
  source_id         uuid primary key references research.sources (id) on delete cascade,
  platform          text not null references public.platforms (key),
  external_id       text not null,
  author_handle     text,
  author_followers  bigint,
  posted_at         timestamptz,
  caption           text,
  transcript        text,
  duration_seconds  integer,
  views             bigint,
  likes             bigint,
  comments          bigint,
  shares            bigint,
  engagement_rate   real,
  hashtags          text[],
  metrics           jsonb not null default '{}'::jsonb,
  connector_slug    text references research.connectors (slug),
  fetched_at        timestamptz not null default now(),
  unique (platform, external_id)
);

create index research_social_posts_platform_posted_idx
  on research.social_posts (platform, posted_at desc);
create index research_social_posts_views_idx
  on research.social_posts (platform, views desc nulls last);

-- ----------------------------------------------------------------------------
-- Citations from product data into sources (both carry creator scoping data
-- or are shared, so RLS stays a plain predicate).
-- ----------------------------------------------------------------------------
create table public.idea_sources (
  idea_id     uuid not null references public.ideas (id) on delete cascade,
  source_id   uuid not null references research.sources (id) on delete cascade,
  creator_id  uuid not null references public.creators (id) on delete cascade,
  note        text,
  primary key (idea_id, source_id)
);

create index idea_sources_creator_idx on public.idea_sources (creator_id);

create table public.niche_research_sources (
  niche_research_id  uuid not null references public.niche_research (id) on delete cascade,
  source_id          uuid not null references research.sources (id) on delete cascade,
  weight             real,
  primary key (niche_research_id, source_id)
);

-- ----------------------------------------------------------------------------
-- Retention: keep the rows, drop the heavy payloads.
-- ----------------------------------------------------------------------------
create or replace function research.prune_call_payloads(retention interval default '30 days')
returns integer
language plpgsql
set search_path = ''
as $$
declare
  touched integer;
begin
  update research.calls
     set raw_response = null
   where raw_response is not null
     and requested_at < now() - retention;
  get diagnostics touched = row_count;
  return touched;
end
$$;
