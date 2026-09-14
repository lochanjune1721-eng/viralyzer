-- ============================================================================
-- 0009  Row Level Security for product tables and grants for `research`
-- ----------------------------------------------------------------------------
-- Rules:
--   * Tenant rows carry creator_id; the policy is one equality against
--     (select public.current_creator_id()), wrapped in select so Postgres
--     evaluates it once per statement instead of once per row.
--   * Policies target `authenticated` explicitly; anon gets reference data only.
--   * Clients read. All writes go through the API / worker, which connect as
--     the table owner (postgres via the pooler) or service_role, both of which
--     bypass RLS. Exception: a creator may insert/update their own creators row
--     and voice_profiles row (onboarding, manual tone edits).
--   * Policy columns are indexed (creator_id / user_id indexes exist above).
-- ============================================================================

create or replace function public.current_creator_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id from public.creators c where c.user_id = auth.uid()
$$;

comment on function public.current_creator_id() is
  'creators.id for the caller''s JWT subject. security definer so policies on other tables do not re-run creators RLS.';

revoke execute on function public.current_creator_id() from public;
grant execute on function public.current_creator_id() to authenticated, service_role;

-- ---------------------------------------------------------------- reference
alter table public.plans     enable row level security;
alter table public.niches    enable row level security;
alter table public.platforms enable row level security;

create policy plans_read     on public.plans     for select to anon, authenticated using (true);
create policy niches_read    on public.niches    for select to anon, authenticated using (true);
create policy platforms_read on public.platforms for select to anon, authenticated using (true);

-- ---------------------------------------------------------------- creators
alter table public.creators enable row level security;

create policy creators_select_own on public.creators
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy creators_insert_own on public.creators
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy creators_update_own on public.creators
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- tenant tables (read-only for clients)
alter table public.creator_platforms      enable row level security;
alter table public.creator_posts          enable row level security;
alter table public.voice_profile_versions enable row level security;
alter table public.voice_samples          enable row level security;
alter table public.runs                   enable row level security;
alter table public.run_usage              enable row level security;
alter table public.ideas                  enable row level security;
alter table public.scripts                enable row level security;
alter table public.idea_sources           enable row level security;
alter table public.feedback_events        enable row level security;

create policy creator_platforms_select_own on public.creator_platforms
  for select to authenticated using (creator_id = (select public.current_creator_id()));
create policy creator_posts_select_own on public.creator_posts
  for select to authenticated using (creator_id = (select public.current_creator_id()));
create policy voice_profile_versions_select_own on public.voice_profile_versions
  for select to authenticated using (creator_id = (select public.current_creator_id()));
create policy voice_samples_select_own on public.voice_samples
  for select to authenticated using (creator_id = (select public.current_creator_id()));
create policy runs_select_own on public.runs
  for select to authenticated using (creator_id = (select public.current_creator_id()));
create policy run_usage_select_own on public.run_usage
  for select to authenticated using (creator_id = (select public.current_creator_id()));
create policy ideas_select_own on public.ideas
  for select to authenticated using (creator_id = (select public.current_creator_id()));
create policy scripts_select_own on public.scripts
  for select to authenticated using (creator_id = (select public.current_creator_id()));
create policy idea_sources_select_own on public.idea_sources
  for select to authenticated using (creator_id = (select public.current_creator_id()));
create policy feedback_events_select_own on public.feedback_events
  for select to authenticated using (creator_id = (select public.current_creator_id()));

-- ---------------------------------------------------------------- voice profile (owner may edit)
alter table public.voice_profiles enable row level security;

create policy voice_profiles_select_own on public.voice_profiles
  for select to authenticated using (creator_id = (select public.current_creator_id()));
create policy voice_profiles_insert_own on public.voice_profiles
  for insert to authenticated with check (creator_id = (select public.current_creator_id()));
create policy voice_profiles_update_own on public.voice_profiles
  for update to authenticated
  using (creator_id = (select public.current_creator_id()))
  with check (creator_id = (select public.current_creator_id()));

-- ---------------------------------------------------------------- shared research cache
alter table public.niche_research         enable row level security;
alter table public.niche_research_sources enable row level security;

create policy niche_research_read on public.niche_research
  for select to authenticated using (true);
create policy niche_research_sources_read on public.niche_research_sources
  for select to authenticated using (true);

-- ---------------------------------------------------------------- evals: service only
alter table public.eval_cases  enable row level security;
alter table public.eval_runs   enable row level security;
alter table public.eval_scores enable row level security;
-- (no policies: only owner / service_role can read or write)

-- ---------------------------------------------------------------- research schema
-- Not exposed through PostgREST; grants + RLS are defence in depth for direct
-- database access. Sources are public web data and readable by any signed-in
-- user; calls carry creator attribution and stay service-only.
revoke all on schema research from public;
grant usage on schema research to authenticated, service_role;
grant all on all tables in schema research to service_role;
grant select on research.connectors, research.sources, research.social_posts to authenticated;
alter default privileges in schema research grant all on tables to service_role;
alter default privileges in schema research grant all on sequences to service_role;

alter table research.connectors   enable row level security;
alter table research.calls        enable row level security;
alter table research.sources      enable row level security;
alter table research.call_results enable row level security;
alter table research.social_posts enable row level security;

create policy connectors_read   on research.connectors   for select to authenticated using (true);
create policy sources_read      on research.sources      for select to authenticated using (true);
create policy social_posts_read on research.social_posts for select to authenticated using (true);
