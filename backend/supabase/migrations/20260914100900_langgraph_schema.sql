-- ============================================================================
-- 0010  `langgraph` schema for checkpoint tables
-- ----------------------------------------------------------------------------
-- langgraph-checkpoint-postgres creates its tables with unqualified names
-- (checkpoints, checkpoint_blobs, checkpoint_writes, checkpoint_migrations),
-- so the schema is selected by the connection's search_path, which
-- viralyzer.db.checkpointer sets on every checkpointer connection.
--
-- The tables themselves are created by the one-shot command
--     python -m viralyzer.db.checkpointer setup
-- never on application boot and never by this migration, so the library owns
-- its own migration versioning (checkpoint_migrations.v).
--
-- No RLS here: the tables are not RLS-aware and tenancy is enforced in the API
-- (runs.thread_id -> creator_id -> JWT subject). Nothing outside LangGraph and
-- the prune function below may read these tables.
-- ============================================================================

create schema if not exists langgraph;

comment on schema langgraph is
  'LangGraph checkpoints. Resume-only state, service-owned, no RLS. Product features never read this schema.';

revoke all on schema langgraph from public;
grant usage on schema langgraph to service_role;
alter default privileges in schema langgraph grant all on tables to service_role;
alter default privileges in schema langgraph grant all on sequences to service_role;

-- Housekeeping: drop checkpoint state for runs that finished long ago. Threads
-- of runs in awaiting_input are never touched (they must stay resumable).
create or replace function langgraph.prune_finished_threads(retention interval default '14 days')
returns integer
language plpgsql
set search_path = ''
as $$
declare
  deleted integer := 0;
begin
  if to_regclass('langgraph.checkpoints') is null then
    return 0;  -- checkpointer setup has not run yet
  end if;

  create temporary table _dead_threads on commit drop as
    select r.thread_id::text as thread_id
      from public.runs r
     where r.status in ('complete', 'failed', 'cancelled')
       and r.finished_at < now() - retention;

  delete from langgraph.checkpoint_writes w using _dead_threads d where w.thread_id = d.thread_id;
  delete from langgraph.checkpoint_blobs  b using _dead_threads d where b.thread_id = d.thread_id;
  delete from langgraph.checkpoints       c using _dead_threads d where c.thread_id = d.thread_id;
  get diagnostics deleted = row_count;
  return deleted;
end
$$;

comment on function langgraph.prune_finished_threads(interval) is
  'Deletes checkpoint rows for runs finished longer than `retention` ago. The only cross-schema access to checkpoint tables.';
