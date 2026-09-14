"""LangGraph checkpointer bound to the ``langgraph`` schema.

Rules from the brief, encoded here so nobody has to remember them:

* ``langgraph-checkpoint-postgres`` only.
* Its tables live in their own schema, service-owned, no RLS. The library
  issues unqualified DDL/DML, so the schema is chosen by ``search_path`` on the
  checkpointer's connections (``create_pool(..., search_path=...)``).
* ``setup()`` runs once, as a one-shot command
  (``python -m viralyzer.db.checkpointer setup``), never on boot. Boot calls
  :func:`assert_checkpoint_tables` and fails fast with the command to run.
* Checkpoints exist only to resume a run. Product code never queries them; the
  only other reader is ``langgraph.prune_finished_threads()`` in SQL.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys

from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from psycopg import sql

from viralyzer.db.pool import Conn, Pool, connect
from viralyzer.db.settings import assert_not_transaction_pooler

CHECKPOINT_TABLES: tuple[str, ...] = (
    "checkpoint_migrations",
    "checkpoints",
    "checkpoint_blobs",
    "checkpoint_writes",
)


def build_checkpointer(pool: Pool) -> AsyncPostgresSaver:
    """Wrap a pool that was created with ``search_path=<langgraph schema>``."""
    return AsyncPostgresSaver(pool)


async def checkpoint_tables_present(conn: Conn, schema: str = "langgraph") -> list[str]:
    cur = await conn.execute(
        "select table_name from information_schema.tables "
        "where table_schema = %s and table_type = 'BASE TABLE' order by table_name",
        (schema,),
    )
    return [row["table_name"] for row in await cur.fetchall()]


async def assert_checkpoint_tables(conn: Conn, schema: str = "langgraph") -> None:
    """Boot-time guard: refuse to start if setup has not been run (never auto-run it)."""
    present = set(await checkpoint_tables_present(conn, schema))
    missing = [t for t in CHECKPOINT_TABLES if t not in present]
    if missing:
        raise RuntimeError(
            f"LangGraph checkpoint tables missing in schema {schema!r}: {missing}. "
            "Run `python -m viralyzer.db.checkpointer setup` (one-shot, direct connection)."
        )


async def setup_checkpointer(conninfo: str, schema: str = "langgraph") -> list[str]:
    """One-shot migration: create/upgrade LangGraph's tables inside ``schema``.

    Uses a dedicated autocommit connection because the library's migrations
    include ``CREATE INDEX CONCURRENTLY``, which cannot run inside a transaction.
    Returns the tables now present in the schema.
    """
    assert_not_transaction_pooler(conninfo)
    conn = await connect(conninfo)
    try:
        await conn.execute(sql.SQL("create schema if not exists {}").format(sql.Identifier(schema)))
        await conn.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
        saver = AsyncPostgresSaver(conn)
        await saver.setup()
        return await checkpoint_tables_present(conn, schema)
    finally:
        await conn.close()


def _cli(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m viralyzer.db.checkpointer",
        description="One-shot LangGraph checkpoint schema setup.",
    )
    sub = parser.add_subparsers(dest="command", required=True)
    setup = sub.add_parser("setup", help="create/upgrade checkpoint tables (idempotent)")
    setup.add_argument(
        "--url",
        default=os.environ.get("SUPABASE_DB_DIRECT_URL") or os.environ.get("SUPABASE_DB_URL"),
        help="connection URL (default: $SUPABASE_DB_DIRECT_URL, then $SUPABASE_DB_URL)",
    )
    setup.add_argument("--schema", default=os.environ.get("LANGGRAPH_SCHEMA", "langgraph"))
    args = parser.parse_args(argv)

    if not args.url:
        parser.error("no connection URL: pass --url or set SUPABASE_DB_DIRECT_URL")

    tables = asyncio.run(setup_checkpointer(args.url, args.schema))
    print(f"checkpoint tables in schema {args.schema!r}: {', '.join(tables)}")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(_cli())


__all__ = [
    "CHECKPOINT_TABLES",
    "assert_checkpoint_tables",
    "build_checkpointer",
    "checkpoint_tables_present",
    "setup_checkpointer",
]
