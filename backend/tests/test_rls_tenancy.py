"""RLS: a signed-in creator sees only their own rows and cannot write product tables."""

from __future__ import annotations

import pytest
from psycopg import errors

from viralyzer.db.models import Creator, IdeaDraft
from viralyzer.db.pool import Conn
from viralyzer.db.repositories import ideas, runs, scripts, voice


async def _seed(conn: Conn, creator: Creator) -> None:
    run = await runs.create_run(conn, creator_id=creator.id, graph="ideation")
    [idea] = await ideas.persist_ideas(
        conn,
        run_id=run.id,
        creator_id=creator.id,
        drafts=[IdeaDraft(hook=f"hook for {creator.display_name}", angle="a", format="talking_head", rationale="r")],
    )
    await scripts.append_script_version(
        conn,
        idea_id=idea.id,
        creator_id=creator.id,
        revision_kind="draft",
        body={"hook": "h", "beats": [], "cta": "c"},
    )
    await voice.upsert_voice_profile(conn, creator.id, tone_rules={"tone": ["dry"]}, summary="s")


async def test_creator_sees_only_own_rows(conn: Conn, creator: Creator, other_creator: Creator, authenticated) -> None:
    await _seed(conn, creator)
    await _seed(conn, other_creator)

    async with authenticated(conn, creator.user_id):
        for table in ("creators", "runs", "ideas", "scripts", "voice_profiles", "voice_profile_versions"):
            cur = await conn.execute(f"select count(*) as n from public.{table}")  # noqa: S608
            assert (await cur.fetchone())["n"] == 1, table
        cur = await conn.execute("select hook from public.ideas")
        assert (await cur.fetchone())["hook"] == "hook for Ada"
        cur = await conn.execute("select public.current_creator_id() as id")
        assert (await cur.fetchone())["id"] == creator.id

    async with authenticated(conn, other_creator.user_id):
        cur = await conn.execute("select hook from public.ideas")
        assert (await cur.fetchone())["hook"] == "hook for Bob"


async def test_anonymous_subject_sees_nothing(conn: Conn, creator: Creator) -> None:
    await _seed(conn, creator)
    async with conn.transaction():
        await conn.execute("set local role authenticated")
        cur = await conn.execute("select count(*) as n from public.ideas")
        assert (await cur.fetchone())["n"] == 0
        await conn.execute("reset role")


async def test_clients_cannot_write_product_tables(conn: Conn, creator: Creator, authenticated) -> None:
    await _seed(conn, creator)
    async with authenticated(conn, creator.user_id):
        with pytest.raises(errors.InsufficientPrivilege):
            async with conn.transaction():
                await conn.execute(
                    "insert into public.ideas (creator_id, hook, angle, format, rationale) values (%s, 'h', 'a', 'f', 'r')",
                    (creator.id,),
                )
        # Without an UPDATE/DELETE policy no row is visible to the statement: zero rows touched, no error.
        cur = await conn.execute("update public.runs set status = 'complete'")
        assert cur.rowcount == 0
        cur = await conn.execute("delete from public.scripts")
        assert cur.rowcount == 0
        # Owner may edit their own voice profile ...
        cur = await conn.execute(
            "update public.voice_profiles set summary = 'edited' where creator_id = %s", (creator.id,)
        )
        assert cur.rowcount == 1
        # ... and nobody else's (0 rows visible).
        cur = await conn.execute("update public.voice_profiles set summary = 'x' where creator_id <> %s", (creator.id,))
        assert cur.rowcount == 0


async def test_research_calls_are_service_only(conn: Conn, creator: Creator, authenticated) -> None:
    async with authenticated(conn, creator.user_id):
        with pytest.raises(errors.InsufficientPrivilege):
            async with conn.transaction():
                await conn.execute("select * from research.calls")
        # Shared, non-tenant data stays readable.
        cur = await conn.execute("select count(*) as n from research.connectors")
        assert (await cur.fetchone())["n"] > 0
        cur = await conn.execute("select count(*) as n from public.niche_research")
        assert (await cur.fetchone())["n"] >= 0
        with pytest.raises(errors.InsufficientPrivilege):
            async with conn.transaction():
                await conn.execute("select * from langgraph.prune_finished_threads('1 day')")
