"""LangGraph checkpoint tables land in the `langgraph` schema and only there."""

from __future__ import annotations

from uuid import uuid4

import pytest
from langgraph.checkpoint.base import empty_checkpoint

from viralyzer.db.checkpointer import (
    CHECKPOINT_TABLES,
    assert_checkpoint_tables,
    build_checkpointer,
    checkpoint_tables_present,
    setup_checkpointer,
)
from viralyzer.db.models import Creator
from viralyzer.db.pool import Conn, connect, create_pool
from viralyzer.db.repositories import runs


@pytest.fixture(scope="module")
def checkpoint_schema(database_url: str) -> None:
    import asyncio

    asyncio.run(setup_checkpointer(database_url, "langgraph"))


async def test_setup_is_idempotent_and_scoped(database_url: str, checkpoint_schema: None) -> None:
    first = await setup_checkpointer(database_url, "langgraph")
    assert set(CHECKPOINT_TABLES) <= set(first)
    assert await setup_checkpointer(database_url, "langgraph") == first  # re-run: no-op

    conn = await connect(database_url)
    try:
        await assert_checkpoint_tables(conn, "langgraph")
        leaked = set(await checkpoint_tables_present(conn, "public")) & set(CHECKPOINT_TABLES)
        assert not leaked
        with pytest.raises(RuntimeError, match="checkpointer setup"):
            await assert_checkpoint_tables(conn, "public")
    finally:
        await conn.close()


async def test_pool_bound_checkpointer_roundtrip(database_url: str, checkpoint_schema: None) -> None:
    pool = create_pool(database_url, min_size=1, max_size=2, search_path="langgraph")
    await pool.open()
    thread_id = str(uuid4())
    try:
        saver = build_checkpointer(pool)
        config = {"configurable": {"thread_id": thread_id, "checkpoint_ns": ""}}
        checkpoint = empty_checkpoint()
        await saver.aput(config, checkpoint, {"source": "input", "step": -1, "writes": {}, "parents": {}}, {})
        stored = await saver.aget_tuple(config)
        assert stored is not None and stored.checkpoint["id"] == checkpoint["id"]
    finally:
        await pool.close()

    conn = await connect(database_url)
    try:
        cur = await conn.execute("select count(*) as n from langgraph.checkpoints where thread_id = %s", (thread_id,))
        assert (await cur.fetchone())["n"] == 1
        await conn.execute("delete from langgraph.checkpoints where thread_id = %s", (thread_id,))
    finally:
        await conn.close()


async def test_prune_finished_threads(conn: Conn, creator: Creator, checkpoint_schema: None) -> None:
    done = await runs.create_run(conn, creator_id=creator.id, graph="scripting")
    await runs.mark_running(conn, done.id)
    await runs.mark_complete(conn, done.id)
    await conn.execute("update public.runs set finished_at = now() - interval '30 days' where id = %s", (done.id,))
    paused = await runs.create_run(conn, creator_id=creator.id, graph="scripting")
    await runs.mark_running(conn, paused.id)
    await runs.mark_awaiting_input(conn, paused.id, {"q": "?"})

    for run in (done, paused):
        await conn.execute(
            "insert into langgraph.checkpoints (thread_id, checkpoint_ns, checkpoint_id, checkpoint, metadata) values (%s, '', 'cp1', '{}', '{}')",
            (str(run.thread_id),),
        )
        await conn.execute(
            "insert into langgraph.checkpoint_writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, blob) values (%s, '', 'cp1', 't', 0, 'c', '\\x00')",
            (str(run.thread_id),),
        )

    cur = await conn.execute("select langgraph.prune_finished_threads('14 days') as n")
    assert (await cur.fetchone())["n"] == 1
    cur = await conn.execute(
        "select thread_id from langgraph.checkpoints where thread_id in (%s, %s)",
        (str(done.thread_id), str(paused.thread_id)),
    )
    assert [r["thread_id"] for r in await cur.fetchall()] == [str(paused.thread_id)]
    cur = await conn.execute(
        "select count(*) as n from langgraph.checkpoint_writes where thread_id = %s", (str(done.thread_id),)
    )
    assert (await cur.fetchone())["n"] == 0
