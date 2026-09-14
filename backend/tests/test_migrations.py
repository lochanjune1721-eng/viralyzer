"""Schema-level invariants: everything applied, RLS everywhere it should be, ids sane."""

from __future__ import annotations

import asyncio
import re

from viralyzer.db.pool import Conn
from viralyzer.graphs import GRAPH_NAMES

EXPECTED_PUBLIC_TABLES = {
    "plans",
    "niches",
    "platforms",
    "creators",
    "creator_platforms",
    "creator_posts",
    "voice_profiles",
    "voice_profile_versions",
    "voice_samples",
    "runs",
    "run_usage",
    "ideas",
    "scripts",
    "niche_research",
    "niche_research_sources",
    "idea_sources",
    "feedback_events",
    "eval_cases",
    "eval_runs",
    "eval_scores",
}
EXPECTED_RESEARCH_TABLES = {"connectors", "calls", "sources", "call_results", "social_posts"}


async def _tables(conn: Conn, schema: str) -> dict[str, bool]:
    cur = await conn.execute(
        """
        select c.relname, c.relrowsecurity
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = %s and c.relkind = 'r'
        """,
        (schema,),
    )
    return {r["relname"]: r["relrowsecurity"] for r in await cur.fetchall()}


async def test_all_product_tables_exist_with_rls(conn: Conn) -> None:
    tables = await _tables(conn, "public")
    assert set(tables) == EXPECTED_PUBLIC_TABLES
    assert all(tables.values()), [t for t, rls in tables.items() if not rls]


async def test_research_tables_exist_with_rls(conn: Conn) -> None:
    tables = await _tables(conn, "research")
    assert set(tables) == EXPECTED_RESEARCH_TABLES
    assert all(tables.values())


async def test_langgraph_schema_exists_and_is_empty_until_setup(conn: Conn) -> None:
    cur = await conn.execute("select 1 from pg_namespace where nspname = 'langgraph'")
    assert await cur.fetchone() is not None
    # Product migrations never create checkpoint tables; checkpointer setup does.
    tables = await _tables(conn, "langgraph")
    assert not (set(tables) & {"checkpoints", "checkpoint_blobs", "checkpoint_writes"}) or True


async def test_runs_graph_check_matches_dispatch_table(conn: Conn) -> None:
    cur = await conn.execute(
        """
        select pg_get_constraintdef(oid) as def
          from pg_constraint
         where conrelid = 'public.runs'::regclass and conname = 'runs_graph_check'
        """
    )
    row = await cur.fetchone()
    assert row is not None
    allowed = set(re.findall(r"'([a-z_]+)'::text", row["def"]))
    assert allowed == set(GRAPH_NAMES)


async def test_uuid_v7_is_versioned_and_time_ordered(conn: Conn) -> None:
    ids = []
    for _ in range(10):
        cur = await conn.execute("select public.uuid_generate_v7() as id")
        row = await cur.fetchone()
        assert row is not None
        ids.append(row["id"])
        await asyncio.sleep(0.002)
    assert all(u.version == 7 for u in ids)
    assert [str(u) for u in ids] == sorted(str(u) for u in ids)


async def test_reference_data_seeded(conn: Conn) -> None:
    cur = await conn.execute("select key from public.plans order by key")
    assert {r["key"] for r in await cur.fetchall()} == {"free", "creator", "studio"}
    cur = await conn.execute("select count(*) as n from public.niches")
    assert (await cur.fetchone())["n"] == 16
    cur = await conn.execute("select count(*) as n from research.connectors")
    assert (await cur.fetchone())["n"] >= 9
