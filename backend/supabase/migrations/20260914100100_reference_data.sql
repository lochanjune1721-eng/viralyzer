-- ============================================================================
-- 0002  Reference data: plans, niches, platforms
-- ----------------------------------------------------------------------------
-- Small lookup tables instead of Postgres enums: adding a row is a data change,
-- not a DDL change, and the rows can carry attributes (budgets, platform
-- conventions) that prompts and budget checks read at run time.
-- Seed rows live here (not in seed.sql) because foreign keys depend on them.
-- ============================================================================

create table public.plans (
  key                   text primary key,
  name                  text not null,
  -- Hard cap on model spend per calendar month, enforced by the worker before
  -- a run starts and inside graph state while it runs (build order step 5).
  monthly_budget_cents  integer not null check (monthly_budget_cents >= 0),
  max_runs_per_day      integer check (max_runs_per_day is null or max_runs_per_day > 0),
  features              jsonb not null default '{}'::jsonb,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.plans is
  'Billing plans. monthly_budget_cents is the hard per-plan model-spend budget.';

create trigger plans_set_updated_at
  before update on public.plans
  for each row execute function public.set_updated_at();

insert into public.plans (key, name, monthly_budget_cents, max_runs_per_day) values
  ('free',    'Free',    200,   3),
  ('creator', 'Creator', 2500,  30),
  ('studio',  'Studio',  10000, 200)
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
create table public.niches (
  key         text primary key,
  name        text not null,
  -- The nightly research cron iterates active niches only.
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.niches is
  'Niche taxonomy shared by creators and the niche_research cache. is_active drives the nightly cron.';

insert into public.niches (key, name) values
  ('tech', 'Tech'), ('fitness', 'Fitness'), ('finance', 'Finance'),
  ('business', 'Business'), ('marketing', 'Marketing'), ('gaming', 'Gaming'),
  ('food', 'Food'), ('travel', 'Travel'), ('beauty', 'Beauty'),
  ('education', 'Education'), ('comedy', 'Comedy'), ('lifestyle', 'Lifestyle'),
  ('news', 'News'), ('science', 'Science'), ('crypto', 'Crypto'), ('other', 'Other')
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
create table public.platforms (
  key             text primary key,
  name            text not null,
  -- Constraints the scripting graph injects as "platform constraints".
  max_seconds     integer check (max_seconds is null or max_seconds > 0),
  default_aspect  text,
  conventions     jsonb not null default '{}'::jsonb,
  is_active       boolean not null default true
);

comment on table public.platforms is
  'Distribution platforms. conventions/max_seconds are the platform constraints fed to scripting; editable reference data.';

insert into public.platforms (key, name, max_seconds, default_aspect, conventions) values
  ('tiktok',    'TikTok',          600, '9:16', '{"hook_window_seconds": 2, "caption_max_chars": 2200, "captions": "burned-in"}'),
  ('instagram', 'Instagram Reels', 180, '9:16', '{"hook_window_seconds": 3, "caption_max_chars": 2200}'),
  ('youtube',   'YouTube Shorts',  180, '9:16', '{"hook_window_seconds": 3, "title_max_chars": 100}'),
  ('x',         'X',               140, '16:9', '{"hook_window_seconds": 2, "text_first": true}'),
  ('linkedin',  'LinkedIn',        600, '1:1',  '{"hook_window_seconds": 3, "tone": "professional"}')
on conflict (key) do nothing;
