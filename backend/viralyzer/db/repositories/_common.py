"""Shared helpers for repositories."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from psycopg.rows import DictRow
from psycopg.types.json import Jsonb

from viralyzer.db.errors import NotFound
from viralyzer.db.pool import Conn


def jsonb(value: Any) -> Jsonb | None:
    """Adapt a Python value to a jsonb parameter (None stays NULL)."""
    return None if value is None else Jsonb(value)


def vector(values: Sequence[float] | None) -> str | None:
    """pgvector text input format; cast with ``::extensions.vector`` in SQL."""
    if values is None:
        return None
    return "[" + ",".join(repr(float(v)) for v in values) + "]"


async def fetch_one(conn: Conn, query: Any, params: Any = None) -> DictRow | None:
    cur = await conn.execute(query, params)
    return await cur.fetchone()


async def fetch_all(conn: Conn, query: Any, params: Any = None) -> list[DictRow]:
    cur = await conn.execute(query, params)
    return await cur.fetchall()


async def require_one(conn: Conn, query: Any, params: Any = None, *, what: str = "row") -> DictRow:
    row = await fetch_one(conn, query, params)
    if row is None:
        raise NotFound(f"{what} not found")
    return row


__all__ = ["fetch_all", "fetch_one", "jsonb", "require_one", "vector"]
