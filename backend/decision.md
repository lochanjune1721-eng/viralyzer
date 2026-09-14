# Storage decisions

Decision record for the Postgres schema and storage layer of the ideation +
scripting service. Each entry: what was decided, why, what it costs, and the
sources that informed it. Items marked **[brief-fixed]** restate a fixed
decision from the build brief; the rest are ours. Sources are listed once at
the bottom and referenced as [S1]…[S17].

---

## D1. Three schemas, one database: `public`, `research`, `langgraph` [brief-fixed for public/langgraph]

**Decision.** Product tables live in `public` with RLS. LangGraph checkpoints
live in `langgraph`, owned by the service, no RLS. Search-source storage for
the Monid connectors lives in a third schema, `research`, because it is shared
across tenants and is not product data either.

**Why.** The brief fixes the product/checkpoint split. The research data has
the same "not a product artifact" character as checkpoints but must be
queryable (dedupe, cache hits, citations), so it gets its own schema instead of
being mixed into `public` or hidden in `langgraph`.

**How the checkpoint schema actually works.** `langgraph-checkpoint-postgres`
issues unqualified DDL (`CREATE TABLE IF NOT EXISTS checkpoints …`) and has no
schema option [S17]. The schema is therefore selected by `search_path` on the
checkpointer's connections: `create_pool(..., search_path="langgraph")` runs
`SET search_path` once per pooled connection. This is only correct on a
session pooler (one server connection per client connection), which is one
more reason D16 refuses transaction mode.

**Consequences.** Product code always schema-qualifies names. The only code
outside LangGraph that touches checkpoint tables is
`langgraph.prune_finished_threads()`, and it only deletes.

## D2. UUIDv7 primary keys, prefixed public ids

**Decision.** Every product primary key is `uuid` defaulted to
`public.uuid_generate_v7()` (a plpgsql shim until Postgres 18's native
`uuidv7()`). The API renders ids as `<prefix>_<26 chars Crockford base32>`
(`run_…`, `idea_…`, `scr_…`, `cr_…`), decoded back to the uuid by
`viralyzer.db.ids`. The prefix is not stored.

**Why.**
* Random v4 keys scatter inserts across the whole b-tree and bloat every
  secondary index; ThousandEyes measured this on a real fleet [S7], and the
  Medium primary-key pieces [S6][S8][S11] land on the same advice: keep uuids
  if you need them, but make them time-ordered (v7).
* Ids are minted by the API, the worker and Postgres itself; a bigint sequence
  would force every writer through one sequence and leak row counts.
* Stripe's argument for `cus_`/`pi_` ids [S3]: an id should say what it is,
  in a log line and in a support ticket. Stripe bakes a shard key into theirs;
  we bake in time (v7), which also makes public ids sort in creation order.

**Consequences.** 16-byte keys instead of 8; acceptable at this scale. The
shim's random part is not monotonic within a millisecond; nothing depends on
sub-millisecond ordering.

## D3. JSONB only at the edges; hot keys are columns; every payload carries a schema version

**Decision.** `jsonb` is used for genuinely variable shapes: `scripts.body`,
`voice_profiles.tone_rules`, `niche_research.payload`, `runs.input`,
`research.calls.usage/raw_response`, `*.metrics`, `*.metadata`. Anything that
is filtered, joined, ordered or summed is a typed column (`views`, `status`,
`rank`, `cost_cents`, `fetched_at`, …). Variable payloads get a
`*_schema_version` column (`scripts.body_schema_version`,
`niche_research.payload_schema_version`, `research.connectors.result_schema_version`).

**Why.** The Medium JSONB posts [S9][S8] and EDB's anti-pattern write-up
[S13] agree: Postgres keeps no planner statistics for jsonb internals, jsonb
updates rewrite the whole value, and "one big JSON column" turns every
feature into `SELECT *` plus application code. The existing Next.js prototype
in this repo stores an entire project as one JSON blob per row
(`src/lib/db/index.ts`); that is exactly the shape we are replacing, and it is
why ideas, scripts, takes and publications could not be queried independently.

**Consequences.** Promoting a key later is a migration, not a rewrite: add a
column, backfill from the jsonb, switch readers, stop writing the key. That is
Stripe's four-phase online migration [S1] at column scale.

## D4. Revisions are rows, never arrays: append-only `scripts`, trigger-snapshotted `voice_profile_versions`

**Decision.** A script edit inserts a new `scripts` row (`version = max + 1`,
assigned by trigger under a per-idea row lock); `is_current` marks the head and
a partial unique index guarantees exactly one head per idea. Voice profiles
keep the current row in `voice_profiles` and every change is copied into
`voice_profile_versions` by trigger.

**Why.** Stripe's migration story [S1] began with subscriptions nested as an
array on the customer document: unqueryable, unindexable, migrated at great
cost into their own collection. The Medium "GitHub-style versioning" pattern
[S10] (one lean current-state row, a history table, insert-then-repoint) is the
same lesson applied to revisions. The brief also requires "revision history
preserved", and the feedback loop needs to know which exact version shipped.

**Consequences.** Slightly more rows; every read of "the script" goes through
`script_heads` (a `security_invoker` view) or `is_current`. The prototype's
`ScriptVariant[]` array maps 1:1 onto rows, with `parent_script_id` replacing
`parentId`.

## D5. Product feedback is an append-only ledger; statuses are derived

**Decision.** `feedback_events` is insert-only (updates raise). The events a
creator generates (`idea_picked`, `script_approved`, `script_shipped_unedited`,
…) are the source of truth; `ideas.status` / `scripts.status` are derived by a
`security definer` trigger so every writer agrees. A CHECK ties event names to
subject types.

**Why.** Stripe's Ledger [S5] is the reference for "immutable event log +
derived balances that can always be re-verified". The brief calls the
picked/shipped signal "worth more than any eval" and the thing that improves
the voice profile; a ledger keeps that signal replayable when the refinement
logic changes. Kevin Mahoney's immutable-data note (found alongside [S10])
gives the cheap version: keep the log, maintain current-state tables by
trigger.

**Consequences.** Status changes that are *workflow* (draft →
awaiting_approval → final) are set directly by the graph via
`scripts.set_script_status`; status changes that are *creator decisions* go
through `feedback.record_feedback`. The split is documented in the code.

## D6. Idempotent run creation with a client key

**Decision.** `runs.idempotency_key` with a partial unique index on
`(creator_id, idempotency_key)`. `create_run` returns the existing run for a
repeated key, before and after completion.

**Why.** Stripe's idempotency post [S2] and brandur's Postgres implementation
[S14]: a retried `POST /runs` (mobile network, proxy timeout, double click)
must not start a second paid graph run. We store the key on the run row rather
than in a separate `idempotency_keys` table because the run *is* the response
and we have no multi-step recovery points to track.

**Consequences.** Keys live as long as the run row. Stripe expires keys after
24h; we do not need to because uniqueness is per creator and the row is cheap.

## D7. One active run per creator is a database constraint

**Decision.** `create unique index runs_one_active_per_creator on runs
(creator_id) where status in ('queued','running')`. The repository translates
the unique violation into `ActiveRunExists`.

**Why.** The brief asks the API to enforce this to stop a creator from paying
five times for five clicks. A check-then-insert in the API races between two
API replicas; a partial unique index does not. `awaiting_input` is deliberately
excluded: a run paused at the approval gate costs nothing and must not block a
new ideation run.

## D8. Run status machine, timestamps and cost roll-ups live in triggers

**Decision.** `runs_guard_status()` rejects illegal transitions, stamps
`started_at`/`finished_at`, counts attempts and resumes, and clears the pending
interrupt on resume. `run_usage` holds per-node, per-model usage and rolls up
into `runs.tokens_in/tokens_out/cost_cents`. `cost_cents` is `numeric(12,4)`
(cents with fractional precision) rather than an integer.

**Why.** The worker, the API and ad-hoc SQL all update runs; the rules must
hold for all of them. Per-node usage is what makes "route models by node"
measurable. Integer cents would round a 0.3-cent scripting node to zero and
the pricing analysis the brief wants would be wrong from day one.

## D9. Tenancy: `creator_id` on every tenant row, one-predicate RLS, clients read-only

**Decision.** Every tenant-scoped table carries `creator_id` (even link and
usage tables). Policies are `creator_id = (select public.current_creator_id())`
with `to authenticated`; `current_creator_id()` is `security definer` so other
tables' policies never re-run `creators`' policy. Clients get SELECT only,
plus INSERT/UPDATE on their own `creators` and `voice_profiles` rows. All other
writes are performed by the API/worker, which connect as the table owner
through the pooler (owner bypasses RLS) or as `service_role`.

**Why.** Supabase's RLS guidance [S12]: wrap `auth.uid()`/helper calls in
`select` (per-statement instead of per-row evaluation), name the role, index
policy columns, use `security definer` helpers to avoid recursive policies.
Denormalising `creator_id` keeps every policy a single indexed equality.

**Consequences.** Two triggers that write on behalf of a client action
(`voice_profiles_snapshot_version`, `apply_feedback_event`) are
`security definer`; the test suite caught the first one failing under RLS. The
`langgraph` schema has no RLS at all; ownership of a `thread_id` is checked in
the API with `runs.assert_thread_owned`, which the tests cover, including the
"foreign and missing look identical" property.

## D10. Voice profile: current row + history + sample rows with embeddings

**Decision.** `voice_profiles` (one per creator, structured `tone_rules` +
prose `summary` + `embedding`), `voice_profile_versions` (trigger history),
`voice_samples` (one row per sample script with its own embedding, provenance
to a `creator_posts` row or a shipped `scripts` row, and a weight). HNSW index
on sample embeddings; `embedding_model` stored next to every vector.

**Why.** The brief: the voice profile is the product and must never live only
in a checkpoint. Samples as rows (instead of the sketched `sample_scripts`
column) let the scripting graph pull the few most relevant samples by cosine
similarity for few-shot prompting, and let shipped scripts feed back in with
provenance. Storing `embedding_model` is the escape hatch for changing
embedding models: add a column, dual-write, switch reads, drop, per Stripe's
online migration pattern [S1].

**Consequences.** `vector(1536)` is fixed at migration time; changing
dimensions is a new column, not an `ALTER TYPE`.

## D11. Shared niche research: append per fetch, freshness by TTL, keep the newest forever

**Decision.** `niche_research` gets one row per nightly fetch (never updated in
place), `ttl_seconds` stored as a plain column, a `niche_research_latest` view
with an `is_fresh` flag, and `prune_niche_research()` that never deletes the
newest row of a niche.

**Why.** History of a niche's trends is useful (diffs, evals) and cheap at
~30 rows/night. A generated `expires_at` column is impossible because
`timestamptz + interval` is not immutable in Postgres, hence the stored TTL
and the view.

## D12. Monid connectors: registry → calls → deduplicated sources → ranked results, plus typed extension tables

**Decision.** In `research`: `connectors` (registry keyed by Monid's
`<provider>#<endpoint>` slug, e.g. `octen#search`, `tinyfish#fetch`,
`exa#search` [S15]), `calls` (one row per invocation with params, a
Postgres-computed `params_hash` cache key, provider-specific `usage` jsonb as
returned, normalised `cost_usd_micros`, the raw payload, TTL), `sources`
(deduplicated by canonical URL hash, with optional full text and embedding),
`call_results` (ranked link with the connector's verbatim item in `raw`).
Connectors whose results deserve typed columns get an extension table keyed by
`source_id` and register it in `connectors.result_table`; `social_posts` is the
first. Product tables cite sources through `idea_sources` and
`niche_research_sources`.

**Why.** Monid meters every provider differently (Exa in USD, Akta in credits,
Octen in calls/sub-queries/URLs/tokens, TinyFish free) [S15], so `usage` stays
verbatim and cost is normalised once. Deduplicating sources across connectors
is what makes citations stable and lets a fetched full text be reused by every
query that returned the URL. Keeping the verbatim item in `raw` and promoting
keys only when queried is the JSONB rule from D3 applied to third-party data.
Registering a plugin is an insert; giving it typed storage is one new table;
nothing else changes, which is the "iterate later" requirement.

**Consequences.** `raw_response` is TOASTed and nulled after 30 days by
`prune_call_payloads()`; usage and cost survive for attribution.
`research.calls` is the only creator-attributed table in the schema and is
service-only; sources are readable by any signed-in user.

## D13. Lookup tables and CHECK constraints instead of Postgres enums

**Decision.** `plans`, `niches`, `platforms` are tables (rows carry budgets and
platform conventions the prompts read). Statuses and `runs.graph` are `text`
with CHECK constraints.

**Why.** Adding an enum value is DDL that cannot run inside a transaction on
older versions and can never be removed; CHECK constraints are dropped and
recreated in one migration. `runs.graph` is deliberately a CHECK that
`tests/test_migrations.py` compares against `viralyzer.graphs.GRAPH_NAMES`, so
adding the editing/posting graphs later is one migration line plus one key.

## D14. `timestamptz` everywhere, `updated_at` by trigger, no soft deletes

**Decision.** All time columns are `timestamptz`; `set_updated_at()` triggers
on mutable tables. Rows are deleted by cascading from `creators` (account
deletion) or by retention functions; there is no `deleted_at`.

**Why.** Soft deletes double every query's predicates and every RLS policy
and are the classic source of "why is this row still counted". Retention is
explicit instead: `prune_niche_research`, `research.prune_call_payloads`,
`langgraph.prune_finished_threads`.

## D15. Migrations: Supabase CLI for product tables, one transaction per file, checkpointer setup as its own one-shot command [brief-fixed]

**Decision.** `supabase/migrations/*.sql` in filename order, each file a single
implicit transaction (so no `CREATE INDEX CONCURRENTLY` in them). Reference
rows are seeded in the migrations because constraints depend on them.
`python -m viralyzer.db.checkpointer setup` creates the LangGraph tables via
the library's own versioned migrations; it is never called on boot, and boot
fails fast with the command to run if the tables are missing. For plain
Postgres (tests, local), `viralyzer.db.migrate` applies the same files after a
Supabase stub (`auth` schema, `auth.uid()`, the three roles).

**Why.** Stripe's DocDB write-up [S4] is a reminder that migrations are the
part of storage that hurts; keeping the product DDL in reviewed SQL files and
the library's DDL under the library's own versioning avoids two migration
systems fighting over one schema.

## D16. Connections: session pooler only, `prepare_threshold=0`, `autocommit=True`, direct URL for admin [brief-fixed]

**Decision.** `DatabaseSettings` refuses a runtime URL on port 6543
(Supavisor transaction mode) at validation time. Every connection gets
`prepare_threshold=0, autocommit=True`. The direct connection is reserved for
migrations, `pg_dump` and checkpointer setup. Repositories open explicit
`conn.transaction()` blocks where atomicity matters (idea batches, script
versions, call completion); under autocommit that is the only way to get one.

**Why.** Transaction mode breaks prepared statements
(`DuplicatePreparedStatement: prepared statement "_pg3_0" already exists`) and
would make the per-connection `SET search_path` of D1 unsafe.

## D17. Deviations from the brief's table sketch (please confirm)

The brief's table list is a sketch; these are the places the schema differs:

| Sketch | Here | Reason |
| --- | --- | --- |
| `creators.platforms` (array) | `creator_platforms` rows (handle, followers, external id, primary flag) | Research connectors need account ids; per-platform follower counts feed ideation context. |
| `voice_profiles.sample_scripts` | `voice_samples` rows with embeddings and provenance | Similarity retrieval and the shipped-script feedback loop (D10). |
| `runs.status` five values | + `cancelled` | A creator abandoning a paused run needs a terminal state that is not `failed`. |
| `runs.cost_cents` (integer implied) | `numeric(12,4)` | Sub-cent nodes must not round to zero (D8). |
| — | `runs.idea_id`, `runs.thread_id unique`, `runs.idempotency_key`, `runs.interrupt` | Scripting input, tenancy check, D6, resume payload. |
| `ideas.status` unspecified | `proposed / picked / dismissed / scripted / archived` | Feedback loop states. |

## D18. Python project layout

**Decision.** The Python service lives in `backend/` (the repo root is the
Next.js frontend). Repositories are plain async functions over a psycopg
connection (no ORM, no session object); models are pydantic; tests run against
a real Postgres with every test in a rolled-back transaction.

**Why.** The graphs, API and worker are three processes with different
transaction needs; a function that takes a connection composes with all of
them and with `conn.transaction()`. No mocks: the invariants that matter
(RLS, partial unique indexes, triggers) only exist in the database.

## D19. What this slice deliberately does not contain

The graphs, FastAPI app, Arq worker, Redis streaming and the services
docker-compose. `viralyzer/graphs/__init__.py` only declares `GRAPH_NAMES` so
the `runs.graph` CHECK has a single source of truth. Editing and posting
stages are not modelled, but every table they will need (`takes`, `edits`,
`publications`) hangs off `scripts.id` / `creator_id` with the same RLS
recipe; see notes.md, "Extension points".

---

## Sources

* [S1] Stripe Engineering, *Online migrations at scale* — https://stripe.com/blog/online-migrations
* [S2] Stripe Engineering, *Designing robust and predictable APIs with idempotency* — https://stripe.com/blog/idempotency
* [S3] Stripe (Paul Asjes), *Designing APIs for humans: Object IDs* — https://dev.to/stripe/designing-apis-for-humans-object-ids-3o5a
* [S4] Stripe, *How Stripe's document databases supported 99.999% uptime with zero-downtime data migrations* — https://stripe.dev/blog/how-stripes-document-databases-supported-99.999-uptime-with-zero-downtime-data-migrations
* [S5] Stripe, *Ledger: Stripe's system for tracking and validating money movement* — https://stripe.dev/blog/ledger-stripe-system-for-tracking-and-validating-money-movement
* [S6] Sanjeev Singh (Medium), *PostgreSQL Primary Key Dilemma: UUID vs. BIGINT* — https://medium.com/@sjksingh/postgresql-primary-key-dilemma-uuid-vs-bigint-52008685b744
* [S7] Cisco ThousandEyes Engineering (Medium), *Avoid Using UUIDs as Primary Keys in MySQL and RDS Aurora Databases* — https://medium.com/thousandeyes-engineering/avoid-using-uuids-as-primary-keys-in-mysql-and-rds-aurora-databases-6d4c08c806e3
* [S8] Medium, *PostgreSQL Best Practices for Production: Indexing, JSONB, UUIDv7, Partitioning, and Performance Tuning* — https://medium.com/@pothiq/postgresql-in-production-a-beginner-to-pro-guide-82db452ffc88
* [S9] Rick Hightower (Medium), *JSONB: PostgreSQL's Secret Weapon for Flexible Data Modeling* — https://medium.com/@richardhightower/jsonb-postgresqls-secret-weapon-for-flexible-data-modeling-cf2f5087168f
* [S10] Deepaksingh Dev (Medium), *Building GitHub-Style Versioning in Your Database* — https://medium.com/@deepaksingh.dev.2002/building-github-style-versioning-in-your-database-9d559f7887bb
* [S11] Cloud With Azeem (Medium), *Stop Using UUIDs as Primary Keys* — https://medium.com/shark-engineering/stop-using-uuid-primary-key-performance-alternatives-75e93c09f922
* [S12] Supabase, *RLS Performance and Best Practices* — https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv and *Supavisor and connection terminology* — https://supabase.com/docs/guides/troubleshooting/supavisor-and-connection-terminology-explained-9pr_ZO
* [S13] EDB, *PostgreSQL anti-patterns: unnecessary json/hstore dynamic columns* — https://www.enterprisedb.com/blog/postgresql-anti-patterns-unnecessary-jsonhstore-dynamic-columns
* [S14] Brandur Leach, *Implementing Stripe-like Idempotency Keys in Postgres* — https://brandur.org/idempotency-keys
* [S15] Monid connectors (slug format, per-provider usage reporting) — https://github.com/monid-ai/connectors ; skills — https://github.com/monid-ai/skills
* [S16] Stripe, *Online migrations at scale* summary by Simon Willison — https://simonwillison.net/2023/Nov/5/online-migrations-at-scale/
* [S17] `langgraph-checkpoint-postgres` 3.1.2, `langgraph/checkpoint/postgres/base.py` (`MIGRATIONS`) — https://github.com/langchain-ai/langgraph/tree/main/libs/checkpoint-postgres

Several of these pages were only reachable as search summaries from the build
environment; the claims used are the widely cited ones (four-phase dual-write
migration, idempotency keys, prefixed ids, immutable ledger, v4-index bloat,
JSONB planner statistics) and should be re-read in full before quoting them
externally.
