# Viralyzer backend — storage slice

Python project for the ideation + scripting service described in the build
brief. This slice contains **only** what stores and retrieves data:

| Path | What |
| --- | --- |
| `supabase/migrations/` | Product schema (`public`), research-source schema (`research`), checkpoint schema (`langgraph`), RLS. Applied with the Supabase CLI. |
| `viralyzer/db/settings.py` | Connection URLs. Refuses the transaction pooler (6543). |
| `viralyzer/db/pool.py` | psycopg pools with `prepare_threshold=0`, `autocommit=True`; optional `search_path`. |
| `viralyzer/db/checkpointer.py` | `AsyncPostgresSaver` bound to the `langgraph` schema + one-shot `setup` command. |
| `viralyzer/db/ids.py` | Stripe-style prefixed public ids (`run_…`, `idea_…`) over UUIDv7 keys. |
| `viralyzer/db/models.py` | Typed row models; `ScriptBody` is the JSON contract for `scripts.body`. |
| `viralyzer/db/repositories/` | One module per aggregate: creators, voice, runs, ideas, scripts, niche_research, research (Monid), feedback, evals. |
| `viralyzer/db/migrate.py` | Applies the migration files to a plain Postgres (tests, local dev). |
| `tests/` | Schema, RLS, state-machine, versioning, research-cache and checkpointer tests against a real Postgres. |
| `decision.md` | Why the schema looks the way it does, with the Stripe / Medium sources. |
| `notes.md` | Operational notes: connections, migrations, retention, RLS, extension points. |

The graphs, API and worker are later slices (build order steps 2–5) and will
import this package; nothing here imports them.

## Setup

```bash
cd backend
make install                      # uv venv + editable install with dev extras
cp .env.example .env              # fill SUPABASE_DB_URL / SUPABASE_DB_DIRECT_URL
```

## Migrations

Production / staging (Supabase project):

```bash
supabase link --project-ref <ref>
supabase db push                                   # product tables, RLS, research + langgraph schemas
python -m viralyzer.db.checkpointer setup          # once: LangGraph checkpoint tables in `langgraph`
```

Local plain Postgres (no Supabase):

```bash
make db-up                                         # pgvector/pgvector:pg17 on :54322
make db-migrate-local                              # applies tests/sql/supabase_stub.sql, then the migrations
```

## Tests

```bash
make test                                          # uses TEST_DATABASE_URL or the docker db above
```

Each test runs inside a transaction that is rolled back; the suite creates a
throwaway database per session and drops it afterwards.

## Using the layer

```python
from viralyzer.db import DatabaseSettings, create_pool
from viralyzer.db.checkpointer import build_checkpointer
from viralyzer.db.repositories import runs, ideas, scripts, voice

settings = DatabaseSettings()
pool = create_pool(settings.runtime_url, max_size=settings.pool_max_size)
checkpoint_pool = create_pool(settings.runtime_url, max_size=4, search_path=settings.langgraph_schema)
await pool.open(); await checkpoint_pool.open()

checkpointer = build_checkpointer(checkpoint_pool)          # graph = builder.compile(checkpointer=checkpointer)

async with pool.connection() as conn:
    run = await runs.create_run(conn, creator_id=cid, graph="scripting", input={"idea_id": str(idea_id)},
                                idea_id=idea_id, idempotency_key=client_key)
    await runs.assert_thread_owned(conn, thread_id, jwt_subject)   # before any resume / stream
```
