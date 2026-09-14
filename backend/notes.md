# Database notes

Working notes for the Viralyzer Postgres schema. `decision.md` says *why*;
this file says *what is there and how to operate it*.

## 1. Map

```
auth.users (Supabase)
   │ 1:1
   ▼
public.creators ──────────────┬──────────────┬────────────────┬──────────────────┐
   │ 1:n                      │ 1:1          │ 1:n            │ 1:n              │ 1:n
   ▼                          ▼              ▼                ▼                  ▼
creator_platforms       voice_profiles   creator_posts     runs ──1:n──► run_usage    feedback_events
creator_posts ◄─┐             │ trigger        │              │ 1:n                  (append-only)
                │             ▼                │              ▼
                └─── voice_samples ◄── voice_profile_versions │        ideas ──1:n──► scripts (versions, one head)
                          ▲                                   │          │  ▲            ▲
                          └───────────── shipped script ──────┘          │  └── runs.idea_id (scripting runs)
                                                                         ▼
                                                                    idea_sources ──► research.sources ◄── research.call_results ◄── research.calls ──► research.connectors
                                                                                            ▲                                            │
public.niche_research ──1:n──► niche_research_sources ──────────────────────────────────────┘                                            └── research.social_posts (typed extension, by source_id)

public.plans / niches / platforms          reference data (seeded in migrations)
public.eval_cases / eval_runs / eval_scores  evaluation set (service only)
langgraph.checkpoints / checkpoint_blobs / checkpoint_writes / checkpoint_migrations   created by `checkpointer setup`
```

Every tenant row carries `creator_id`. Everything under `research.*`,
`niche_research*`, `plans/niches/platforms` and `eval_*` is shared or
service-only.

## 2. Tables

### public — product

| Table | Purpose | Written by | Notes |
| --- | --- | --- | --- |
| `plans` | Billing plans and `monthly_budget_cents` (hard model-spend cap) | migrations / ops | `budget_remaining_cents(creator_id)` reads it. |
| `niches` | Niche taxonomy; `is_active` drives the nightly research cron | migrations / ops | Keys match the frontend `NICHES` list. |
| `platforms` | Distribution platforms with `max_seconds`, `default_aspect`, `conventions` | migrations / ops | Injected into scripting as platform constraints. |
| `creators` | Tenant. `user_id` = Supabase Auth subject | API (onboarding), client (own row) | `onboarding_status`: pending → profiling → complete. |
| `creator_platforms` | Accounts per platform (handle, followers, external id) | API / worker | One `is_primary` per creator (partial unique). |
| `creator_posts` | The creator's own content, "recent top performers" | worker (via connectors) | Hot metrics typed (`views` …), tail in `metrics`. Unique `(creator_id, platform, external_id)`. |
| `voice_profiles` | Current voice profile (`tone_rules` jsonb, `summary`, `embedding`) | worker, client (own row) | `version` bumps by trigger when content changes. |
| `voice_profile_versions` | Immutable history of the above | trigger only | `security definer` trigger, so client edits still snapshot. |
| `voice_samples` | Sample scripts, one row each, embedded, weighted, with provenance | worker, API | HNSW cosine index; `kind`: existing_content / shipped_script / manual. |
| `runs` | One graph execution; product handle of a LangGraph thread | API (create), worker (status) | See §5 for the state machine. `thread_id` unique. |
| `run_usage` | Per node × model tokens/cost | worker | Trigger rolls totals into `runs`. |
| `ideas` | Ranked ideas from an ideation run | worker | `status` derived from feedback events. |
| `scripts` | Script revisions; `is_current` marks the head | worker, API (human edits) | `body` must contain `hook`, `beats`, `cta`; `body_schema_version`. |
| `idea_sources` | Citations idea → `research.sources` | worker | Carries `creator_id` for RLS. |
| `niche_research` | Nightly trend digest per niche, one row per fetch | cron worker | `niche_research_latest` view exposes `is_fresh`. |
| `niche_research_sources` | Citations digest → sources | cron worker | |
| `feedback_events` | Append-only ledger of creator behaviour | API / worker | Trigger maintains `ideas.status`, `scripts.status`, `shipped_unedited`. |
| `eval_cases` / `eval_runs` / `eval_scores` | Reference set, scoring runs per prompt version, judge scores | eval job | Snapshots stored inline so cases stay stable. |

Views: `script_heads` (current script per idea), `niche_research_latest`,
`creator_month_usage` (spend per creator per calendar month). All are
`security_invoker`, so RLS of the caller applies.

### research — Monid connector storage

| Table | Purpose | Notes |
| --- | --- | --- |
| `connectors` | Registry of endpoints, slug `<provider>#<endpoint>` | `kind`, `pricing` (how usage maps to money), `result_table` (typed extension), `result_schema_version`. Seeded with octen / exa / tinyfish / akta endpoints. |
| `calls` | One row per invocation | `params_hash` generated by Postgres = cache key; `usage` verbatim; `cost_usd_micros` normalised; `raw_response` pruned after 30 days; `purpose` + optional `run_id` / `creator_id` / `niche` for attribution. |
| `sources` | Deduplicated documents by canonical URL | `url_hash`, `domain` generated; optional `content` + `embedding` (HNSW); `seen_count`, `last_seen_at`. |
| `call_results` | Ranked link call → source | `raw` keeps the connector's item verbatim. PK `(call_id, rank)`, unique `(call_id, source_id)`. |
| `social_posts` | Typed extension for social connectors | Keyed by `source_id`; unique `(platform, external_id)`. Template for further extension tables. |

### langgraph — checkpoints

Created by `python -m viralyzer.db.checkpointer setup`, versioned by the
library (`checkpoint_migrations.v`). No RLS, no product reads. Only
`langgraph.prune_finished_threads(retention)` deletes rows here, for runs that
finished longer than `retention` ago (paused runs are never touched).

## 3. Connections

| Setting | Value | Why |
| --- | --- | --- |
| `SUPABASE_DB_URL` | session pooler, port **5432** | Runtime for API, worker, checkpointer. `DatabaseSettings` raises on 6543. |
| `SUPABASE_DB_DIRECT_URL` | direct connection | Migrations, `pg_dump`, `checkpointer setup`. |
| psycopg kwargs | `prepare_threshold=0`, `autocommit=True`, `row_factory=dict_row` | Brief requirement; transaction mode would throw `DuplicatePreparedStatement: prepared statement "_pg3_0" already exists`. |
| Checkpointer pool | `create_pool(url, search_path="langgraph")` | The library's DDL/DML is unqualified; `SET search_path` runs once per pooled connection. Safe only in session mode. |
| Product pools | no `search_path` | All product SQL is schema-qualified (`public.`, `research.`, `extensions.vector`). |

`autocommit=True` means a multi-statement unit of work must open
`async with conn.transaction():` explicitly. Repositories do so for idea
batches, script versions, post upserts, call completion. Nested calls become
savepoints, which is also how a failed statement (unique violation, rejected
transition) leaves the caller's transaction usable.

Supabase's `postgres` role owns every table and therefore bypasses RLS; the
API and worker connect as that role through the pooler. `service_role`
(PostgREST with the service key) has `bypassrls`. `authenticated` /`anon`
are what RLS is written for.

## 4. Migrations

* Files: `supabase/migrations/<UTC timestamp>_<name>.sql`, applied in filename
  order by `supabase db push` (linked project) or `supabase db reset` (local
  Supabase). Each file runs as one transaction: no `CREATE INDEX CONCURRENTLY`,
  no `ALTER TYPE … ADD VALUE` inside them.
* Reference rows (`plans`, `niches`, `platforms`, `research.connectors`) are
  seeded *in the migrations* with `on conflict do nothing`; `supabase/seed.sql`
  only adds dev conveniences (a fake `tech` research digest).
* Plain Postgres (tests, `make db-up`): `python -m viralyzer.db.migrate --url …
  --with-supabase-stub` applies `tests/sql/supabase_stub.sql` (the `auth`
  schema, `auth.uid()`, the three roles, default privileges) and then the same
  files through libpq's simple query protocol (`viralyzer.db.migrate.apply_sql`).
  psycopg's normal `execute` cannot send multi-statement scripts.
* Checkpoint tables: `python -m viralyzer.db.checkpointer setup` against the
  direct URL, once per environment and after upgrading
  `langgraph-checkpoint-postgres`. Never on boot: boot calls
  `assert_checkpoint_tables()` and fails with the command to run.
* Adding a migration: new file, higher timestamp, re-runnable on an empty
  database; run `make test` (the suite applies every file to a fresh database).
* Adding a graph (editing, posting): extend the CHECK on `runs.graph` (drop +
  recreate constraint) and on `eval_runs.graph`; add the key to
  `viralyzer.graphs.GRAPH_NAMES`. `tests/test_migrations.py` fails until both
  agree.
* Adding a Monid connector ("plugin"): `research.register_connector(slug=…,
  kind=…, pricing=…)` or an insert in a migration. If its results need typed
  columns, add `research.<name>` keyed by `source_id` (copy `social_posts`),
  set `result_table`, and write a `record_<name>` repository function. Existing
  call/result storage keeps working unchanged in the meantime because the
  verbatim item is in `call_results.raw`.

## 5. Run lifecycle in the database

```
queued ──► running ──► complete
  │           │  ▲
  │           │  └── queued  (resume: resume_count+1, interrupt cleared, attempt+1 on next running)
  │           ├──► awaiting_input ──► queued | cancelled | failed
  │           ├──► failed
  │           ├──► cancelled
  │           └──► queued  (worker retry)
  ├──► failed   (pre-flight: budget, validation)
  └──► cancelled
```

Enforced by `runs_guard_status()`; a bad move raises `check_violation`, which
the repository maps to `IllegalTransition`. `started_at` is set on the first
`running`, `finished_at` on any terminal state. "Active" for the
one-active-run rule = `queued` or `running` (paused runs do not block).

Worker pre-flight: `runs.assert_budget_available(conn, creator_id)` (plan
budget minus this month's `cost_cents`), then `mark_running`. Each LLM call:
`runs.record_usage(node=…, model=…, tokens…, cost_cents=…)`. On interrupt:
`mark_awaiting_input(interrupt_value)`. On `POST /runs/{id}/resume`:
`requeue_for_resume(decision)` then re-enqueue the same job. On completion:
`ideas.persist_ideas` / `scripts.append_script_version` then `mark_complete`.

Tenancy: every endpoint that takes a `thread_id` (stream, resume) calls
`runs.assert_thread_owned(conn, thread_id, jwt_subject)` first. Foreign and
unknown threads raise the same `ThreadNotOwned`.

## 6. RLS summary

| Role | Reads | Writes |
| --- | --- | --- |
| `anon` | `plans`, `niches`, `platforms` | none |
| `authenticated` | own rows of every tenant table; `niche_research*`; `research.connectors/sources/social_posts` | own `creators` row (insert/update), own `voice_profiles` row (insert/update) |
| owner `postgres` / `service_role` | everything | everything |

Policies use `creator_id = (select public.current_creator_id())` (security
definer, `set search_path = ''`). Postgres evaluates the wrapped call once per
statement. With no UPDATE/DELETE policy a client statement simply touches 0
rows; an INSERT with no policy raises `42501`. Tables not exposed through
PostgREST (`research.*`, `langgraph.*`) still get grants + RLS as defence in
depth. Security definer functions in the schema: `current_creator_id`,
`voice_profiles_snapshot_version`, `apply_feedback_event`; keep that list
short and keep `set search_path = ''` on each.

## 7. Retention and housekeeping

| Job | Call | Suggested cadence |
| --- | --- | --- |
| Drop old research digests, keep newest per niche | `select public.prune_niche_research('30 days')` | nightly, after the research cron |
| Null raw connector payloads | `select research.prune_call_payloads('30 days')` | nightly |
| Delete checkpoints of finished runs | `select langgraph.prune_finished_threads('14 days')` | nightly |
| Redis stream buffers | 1h TTL on the list (worker side, not in Postgres) | — |

`feedback_events`, `run_usage`, `voice_profile_versions` and `scripts` are
kept forever; they are the product's memory. If `run_usage` or
`feedback_events` pass ~50M rows, partition by month on `recorded_at` /
`occurred_at` (both are `bigint identity` keyed with time-first indexes for
that reason).

## 8. Cost and budgets

* `runs.tokens_in/tokens_out/cost_cents` are trigger roll-ups of `run_usage`;
  never update them by hand.
* `creator_month_usage` view and `budget_remaining_cents(creator_id)` implement
  the per-plan hard budget; the worker checks it before starting and the graph
  can check it between nodes.
* Connector spend is separate: `research.calls.cost_usd_micros`, summed per run
  by `research.spend_for_run(run_id)`; niche research spend is attributed by
  `niche` / `purpose='niche_research'` instead.

## 9. Feedback loop and voice refinement

* Creator actions become `feedback_events` (`idea_picked`, `script_approved`,
  `script_edited` with `{edit_distance}`, `script_shipped` /
  `script_shipped_unedited`, …). Triggers set the derived statuses.
* Refinement inputs: `feedback.shipped_unedited_scripts(creator_id)` (strongest
  voice signal), `creators.top_posts` (their best content), current
  `voice_samples`. A refinement writes `voice.upsert_voice_profile(...,
  source="refinement", change_reason=…)`, which mints a new version, and adds
  shipped scripts as `voice_samples(kind='shipped_script', source_script_id=…)`.
* Ideation and scripting read `voice.voice_context(creator_id,
  query_embedding=…)` (profile + nearest samples).

## 10. Evals

`eval_cases` hold `(creator_profile, idea, reference_script)` snapshots;
`eval_runs` is one scoring pass per `(graph, prompt_version, judge_model)`;
`eval_scores` stores hook_strength / voice_match / structure (0–10) per case
with the judge rationale. `evals.finish_eval_run` writes the averages into
`eval_runs.summary`. Compare prompt versions with
`select prompt_version, summary from public.eval_runs where graph='scripting' order by started_at desc`.

## 11. Indexes worth knowing

* `runs_one_active_per_creator` (partial unique) and `runs_idempotency_key_idx`
  (partial unique) are behaviour, not just performance.
* `scripts_one_current_per_idea_idx` guarantees one head per idea.
* `research_calls_cache_idx (connector_slug, params_hash, requested_at desc)
  where status='succeeded'` backs `find_cached_call`.
* HNSW (`vector_cosine_ops`) on `voice_samples.embedding` and
  `research.sources.embedding`. Build cost is fine at this size; for bulk
  backfills, insert first and create the index afterwards.
* No GIN indexes on jsonb yet: nothing queries inside `tone_rules`, `payload`
  or `metrics`. Add `using gin (metrics jsonb_path_ops)` only when a query
  needs it.
* Every RLS predicate column (`creator_id`, `user_id`) has an index.

## 12. Gotchas

* `now()` is fixed for the whole transaction; retention functions compare
  against it, so inside a test transaction "age" rows explicitly (see
  `tests/test_research_sources.py`).
* `timestamptz + interval` is STABLE, not IMMUTABLE: no generated `expires_at`
  columns. `niche_research.ttl_seconds` + the view instead.
* The `?` jsonb operator appears only in migration SQL. psycopg uses `%s`
  placeholders, so `?` is not special in repository code; avoid `?` in queries
  that also carry `%s` parameters for readability.
* `CREATE INDEX CONCURRENTLY` cannot run in a transaction. The checkpointer's
  own migrations use it, which is why `setup_checkpointer` runs on an
  autocommit connection outside any transaction.
* `alter default privileges in schema X` applies to objects later created by
  the role that ran it. Migrations run as `postgres`, which is why the stub
  sets defaults before any table exists.
* A trigger that writes to another table on behalf of a client action needs
  `security definer`, or RLS on the target table rejects it (the voice
  snapshot trigger did exactly that until it was fixed).
* pgvector lives in the `extensions` schema on Supabase. Type and operator
  references are qualified (`extensions.vector`, `operator(extensions.<=>)`) so
  code works regardless of the role's `search_path`.
* Postgres 16 locally vs 17 on Supabase: nothing here depends on 17; when
  Supabase offers 18, replace the body of `uuid_generate_v7()` with `uuidv7()`.

## 13. Extension points (editing / posting stages)

The prototype's `Project` object mapped stages onto one row; here each stage
gets its own tables hanging off `scripts` and `creators`:

* `takes` (shooting): `creator_id`, `script_id`, storage path, duration,
  `is_primary`, status. Same RLS recipe (`creator_id` + select-own policy).
* `edits` (editing): `creator_id`, `script_id`, `take_ids`, `brief jsonb`
  (the `EditBrief` shape), `transcript jsonb`, render status, output path;
  revisions as rows like `scripts` if re-renders must be diffable.
* `publications` (posting): `creator_id`, `edit_id`, `platform`, `status`,
  `post_url`, `scheduled_at`, `published_at`; the `script_shipped*` feedback
  event is what closes the loop back into `voice_samples`.
* `connections` (OAuth tokens) must stay service-only: no client policies,
  tokens encrypted at the application layer.
* New graphs: extend the `runs.graph` CHECK + `GRAPH_NAMES`; the run/usage/
  budget machinery is graph-agnostic.

## 14. Tests

`make test` (or `TEST_DATABASE_URL=… pytest`) creates a database
`viralyzer_test_<hex>`, applies stub + migrations, runs every test inside a
rolled-back transaction, and drops the database. Without `TEST_DATABASE_URL`
the harness starts a temporary cluster with `initdb`/`pg_ctl` when they are on
`PATH` (not as root). Covered: table/RLS inventory, `runs.graph` ↔
`GRAPH_NAMES`, UUIDv7 ordering, one-active-run and idempotency, the status
machine and resume counters, usage roll-up and budget, thread ownership,
per-tenant visibility and client write denial, script versioning and head
invariant, voice versioning and similarity search, research cache hits,
source dedupe, typed extension upserts, citations, payload pruning, feedback
ledger immutability and derived statuses, eval summaries, checkpointer setup
in the right schema, checkpoint round-trip through a `search_path` pool, and
checkpoint pruning.
