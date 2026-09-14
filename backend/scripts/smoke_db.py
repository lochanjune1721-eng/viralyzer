"""End-to-end smoke test of the storage layer against a real database.

Walks the path the ideation + scripting service will take: user -> creator ->
ideation run -> ranked ideas -> script v1 -> revised script v2, then reads it
back and checks row-level security from the creator's point of view.

    python scripts/smoke_db.py                      # local docker db (make db-up)
    python scripts/smoke_db.py --url "$SUPABASE_DB_DIRECT_URL"
    python scripts/smoke_db.py --rollback           # leave no rows behind
"""

from __future__ import annotations

import argparse
import asyncio
import os
from uuid import uuid4

from viralyzer.db.models import IdeaDraft, ScriptBody
from viralyzer.db.pool import connect
from viralyzer.db.repositories import creators, ideas, runs, scripts

LOCAL_URL = "postgresql://postgres:postgres@localhost:54322/postgres"


class _Rollback(Exception):
    pass


async def smoke(url: str, rollback: bool) -> None:
    conn = await connect(url)
    try:
        async with conn.transaction():
            cur = await conn.execute(
                "insert into auth.users (id, email) values (%s, %s) returning id",
                (uuid4(), f"smoke-{uuid4().hex[:8]}@test.local"),
            )
            user_id = (await cur.fetchone())["id"]
            creator = await creators.create_creator(conn, user_id=user_id, niche="tech", display_name="Smoke Test")
            print(f"creator   {creator.id}  niche={creator.niche}")

            run = await runs.create_run(conn, creator_id=creator.id, graph="ideation", idempotency_key="smoke")
            run = await runs.mark_running(conn, run.id, worker_id="smoke")
            print(f"run       {run.id}  status={run.status}")

            persisted = await ideas.persist_ideas(
                conn,
                run_id=run.id,
                creator_id=creator.id,
                drafts=[
                    IdeaDraft(hook="I let an AI agent run my week", angle="experiment", format="talking_head", rationale="agents trending", score=0.9),
                    IdeaDraft(hook="Local-first apps are back", angle="contrarian", format="screen_recording", rationale="privacy fatigue", score=0.7),
                ],
            )
            run = await runs.mark_complete(conn, run.id)
            for idea in persisted:
                print(f"idea #{idea.rank}   {idea.id}  {idea.hook!r}")
            print(f"run       status={run.status}")

            top = persisted[0]
            body = ScriptBody(
                hook=top.hook,
                beats=[{"label": "setup", "text": "Monday I handed my calendar to an agent.", "seconds": 5}],
                cta="Follow for day two.",
            )
            v1 = await scripts.append_script_version(conn, idea_id=top.id, creator_id=creator.id, body=body, revision_kind="draft")
            body.cta = "Comment 'agent' and I'll send the setup."
            v2 = await scripts.append_script_version(conn, idea_id=top.id, creator_id=creator.id, body=body, revision_kind="human_edit")
            current = await scripts.current_script(conn, top.id)
            versions = await scripts.list_script_versions(conn, top.id)
            print(f"scripts   v{v1.version} -> v{v2.version}; current=v{current.version}; history={[s.version for s in versions]}")
            assert current.id == v2.id and len(versions) == 2

            # RLS: as the signed-in creator (what PostgREST / supabase-js would do).
            await conn.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(user_id),))
            await conn.execute("set local role authenticated")
            cur = await conn.execute("select count(*) as n from public.ideas")
            visible = (await cur.fetchone())["n"]
            await conn.execute("reset role")
            print(f"rls       creator sees {visible} idea(s)")
            assert visible == len(persisted)

            if rollback:
                raise _Rollback
        print("OK - rows committed (re-run with --rollback to leave none)")
    except _Rollback:
        print("OK - rolled back")
    finally:
        await conn.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--url", default=os.environ.get("DATABASE_URL", LOCAL_URL))
    parser.add_argument("--rollback", action="store_true")
    args = parser.parse_args()
    asyncio.run(smoke(args.url, args.rollback))


if __name__ == "__main__":
    main()
