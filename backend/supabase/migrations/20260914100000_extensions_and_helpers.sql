-- ============================================================================
-- 0001  Extensions, schemas and shared helper functions
-- ----------------------------------------------------------------------------
-- Applied by the Supabase CLI (`supabase db push`) in production and by
-- `python -m viralyzer.db.migrate` against throwaway databases in tests.
-- Every migration must be re-runnable on a fresh database in filename order.
-- ============================================================================

-- Supabase keeps extensions out of `public`; mirror that locally so the SQL is
-- identical in both places.
create schema if not exists extensions;

-- pgvector: voice-profile / sample / source embeddings.
create extension if not exists vector with schema extensions;

-- ----------------------------------------------------------------------------
-- Time-ordered UUIDs (RFC 9562 v7).
-- Random v4 keys scatter inserts across the whole b-tree and bloat every
-- secondary index; v7 keys are monotonic per millisecond so inserts append to
-- the right-most leaf. Postgres < 18 has no native uuidv7(), hence the shim.
-- Replace the body with `uuidv7()` once Supabase runs Postgres 18.
-- ----------------------------------------------------------------------------
create or replace function public.uuid_generate_v7()
returns uuid
language plpgsql
volatile
parallel safe
as $$
begin
  return encode(
    set_bit(
      set_bit(
        overlay(uuid_send(gen_random_uuid())
                placing substring(int8send((extract(epoch from clock_timestamp()) * 1000)::bigint) from 3)
                from 1 for 6),
        52, 1),
      53, 1),
    'hex')::uuid;
end
$$;

comment on function public.uuid_generate_v7() is
  'RFC 9562 UUIDv7: 48-bit unix-ms timestamp + random. Default for every product primary key.';

-- ----------------------------------------------------------------------------
-- updated_at maintenance. Attach with:
--   create trigger <table>_set_updated_at before update on <table>
--   for each row execute function public.set_updated_at();
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- ----------------------------------------------------------------------------
-- Stable content hashing for dedupe keys and cache keys (core sha256, no
-- pgcrypto dependency). IMMUTABLE so it can back generated columns.
-- ----------------------------------------------------------------------------
create or replace function public.sha256_hex(input text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
  select encode(sha256(convert_to(input, 'utf8')), 'hex')
$$;
