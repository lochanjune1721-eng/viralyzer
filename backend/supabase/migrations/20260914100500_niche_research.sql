-- ============================================================================
-- 0006  Shared niche research cache (nightly cron -> many creators)
-- ----------------------------------------------------------------------------
-- One row per fetch, never updated in place: the ideation agent reads the
-- newest fresh row, old rows remain for diffing trends and for evals, and a
-- retention job prunes them. ttl_seconds is stored (not a generated column)
-- because timestamptz + interval is not immutable in Postgres.
-- ============================================================================

create table public.niche_research (
  id                      uuid primary key default public.uuid_generate_v7(),
  niche                   text not null references public.niches (key),
  -- Synthesised digest: {trends[], hooks[], formats[], audience_notes, ...}.
  payload                 jsonb not null check (jsonb_typeof(payload) = 'object'),
  payload_schema_version  smallint not null default 1,
  fetched_at              timestamptz not null default now(),
  ttl_seconds             integer not null default 86400 check (ttl_seconds > 0),
  research_job_id         text,
  tokens_in               bigint not null default 0,
  tokens_out              bigint not null default 0,
  cost_cents              numeric(12, 4) not null default 0,
  created_at              timestamptz not null default now()
);

comment on table public.niche_research is
  'Cached trend research per niche. Fresh when fetched_at + ttl_seconds > now(); the ideation agent reads from cache below 24h.';

create index niche_research_niche_fetched_idx on public.niche_research (niche, fetched_at desc);

create view public.niche_research_latest
with (security_invoker = true)
as
select distinct on (niche)
  r.*,
  (r.fetched_at + make_interval(secs => r.ttl_seconds)) > now() as is_fresh
from public.niche_research r
order by niche, fetched_at desc, id desc;

create or replace function public.prune_niche_research(retention interval default '30 days')
returns integer
language plpgsql
set search_path = ''
as $$
declare
  deleted integer;
begin
  -- Keep the newest row per niche regardless of age so the cache never empties.
  with victims as (
    select id
      from public.niche_research r
     where r.fetched_at < now() - retention
       and r.id <> (select id from public.niche_research n
                     where n.niche = r.niche order by fetched_at desc, id desc limit 1)
  )
  delete from public.niche_research where id in (select id from victims);
  get diagnostics deleted = row_count;
  return deleted;
end
$$;
