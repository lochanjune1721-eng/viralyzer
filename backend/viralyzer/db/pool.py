"""psycopg connection factories with the mandated kwargs.

``prepare_threshold=0`` and ``autocommit=True`` are set on every connection
regardless of pooler mode (brief section 3). ``autocommit=True`` means
multi-statement units of work must opt in with ``async with conn.transaction()``;
the repositories do exactly that where atomicity matters.

A pool created with ``search_path`` runs ``SET search_path`` on each new
connection. The checkpointer pool uses that to land LangGraph's unqualified
``CREATE TABLE checkpoints`` in the ``langgraph`` schema. This is only safe on a
session pooler (one server connection per client connection for its lifetime),
which is one more reason transaction mode is refused in ``settings``.
"""

from __future__ import annotations

from collections.abc import Callable, Coroutine
from typing import Any

from psycopg import AsyncConnection, sql
from psycopg.rows import DictRow, dict_row
from psycopg_pool import AsyncConnectionPool

CONNECTION_KWARGS: dict[str, Any] = {
    "prepare_threshold": 0,
    "autocommit": True,
    "row_factory": dict_row,
}

Conn = AsyncConnection[DictRow]
Pool = AsyncConnectionPool[Conn]


def _search_path_configurer(
    search_path: str,
) -> Callable[[Conn], Coroutine[Any, Any, None]]:
    async def configure(conn: Conn) -> None:
        await conn.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(search_path)))

    return configure


def create_pool(
    conninfo: str,
    *,
    min_size: int = 1,
    max_size: int = 10,
    search_path: str | None = None,
    name: str | None = None,
) -> Pool:
    """Build (but do not open) an async pool. Call ``await pool.open()`` in the app lifespan."""
    return AsyncConnectionPool(
        conninfo,
        kwargs=CONNECTION_KWARGS,
        min_size=min_size,
        max_size=max_size,
        open=False,
        name=name,
        configure=_search_path_configurer(search_path) if search_path else None,
    )


async def connect(conninfo: str, *, search_path: str | None = None) -> Conn:
    """One-off connection with the same kwargs as the pool (CLI, tests, cron)."""
    conn = await AsyncConnection.connect(conninfo, **CONNECTION_KWARGS)
    if search_path:
        await conn.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(search_path)))
    return conn


__all__ = ["CONNECTION_KWARGS", "Conn", "Pool", "connect", "create_pool"]
