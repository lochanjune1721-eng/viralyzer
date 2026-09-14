"""Test harness: a throwaway database with the Supabase stub + all migrations.

Set ``TEST_DATABASE_URL`` to an admin connection of any Postgres 15+ with
pgvector (e.g. ``docker compose -f docker-compose.db.yml up``); otherwise a
temporary cluster is started with ``initdb``/``pg_ctl`` when they are on PATH
(and the tests are not running as root, which initdb refuses).
"""

from __future__ import annotations

import os
import secrets
import shutil
import socket
import subprocess
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID, uuid4

import psycopg
import pytest
import pytest_asyncio
from psycopg import sql
from psycopg.conninfo import make_conninfo

from viralyzer.db.migrate import DEFAULT_MIGRATIONS_DIR, apply_migrations
from viralyzer.db.models import Creator
from viralyzer.db.pool import Conn, connect
from viralyzer.db.repositories import creators

ROOT = Path(__file__).resolve().parents[1]
SUPABASE_STUB = ROOT / "tests" / "sql" / "supabase_stub.sql"


def _pg_binary(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    for candidate in sorted(Path("/usr/lib/postgresql").glob("*/bin/" + name), reverse=True):
        return str(candidate)
    return None


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture(scope="session")
def admin_url(tmp_path_factory: pytest.TempPathFactory):
    url = os.environ.get("TEST_DATABASE_URL")
    if url:
        yield url
        return
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        pytest.skip("initdb refuses to run as root; set TEST_DATABASE_URL")
    initdb, pg_ctl = _pg_binary("initdb"), _pg_binary("pg_ctl")
    if not initdb or not pg_ctl:
        pytest.skip("no Postgres binaries on PATH; set TEST_DATABASE_URL")
    base = tmp_path_factory.mktemp("pg")
    data, sock = base / "data", base / "sock"
    sock.mkdir()
    subprocess.run(
        [initdb, "-D", str(data), "-A", "trust", "-U", "postgres", "--no-instructions", "-E", "UTF8"],
        check=True,
        capture_output=True,
    )
    port = _free_port()
    subprocess.run(
        [
            pg_ctl,
            "-D",
            str(data),
            "-w",
            "-l",
            str(base / "log"),
            "-o",
            f"-p {port} -k {sock} -c listen_addresses=''",
            "start",
        ],
        check=True,
        capture_output=True,
    )
    try:
        yield f"postgresql://postgres@/postgres?host={sock}&port={port}"
    finally:
        subprocess.run([pg_ctl, "-D", str(data), "-m", "fast", "stop"], capture_output=True)


@pytest.fixture(scope="session")
def database_url(admin_url: str) -> str:
    """Fresh database with stub + migrations applied; dropped after the session."""
    name = f"viralyzer_test_{secrets.token_hex(4)}"
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(sql.SQL("create database {}").format(sql.Identifier(name)))
        conn.execute(sql.SQL("alter database {} set search_path to public, extensions").format(sql.Identifier(name)))
    url = make_conninfo(admin_url, dbname=name)
    apply_migrations(url, DEFAULT_MIGRATIONS_DIR, pre_files=(SUPABASE_STUB,), echo=None)
    yield url
    with psycopg.connect(admin_url, autocommit=True) as conn:
        conn.execute(sql.SQL("drop database {} with (force)").format(sql.Identifier(name)))


@pytest_asyncio.fixture
async def conn(database_url: str) -> AsyncIterator[Conn]:
    """Connection whose work is rolled back after each test."""
    c = await connect(database_url)
    try:
        async with c.transaction(force_rollback=True):
            yield c
    finally:
        await c.close()


async def new_user(conn: Conn) -> UUID:
    cur = await conn.execute("insert into auth.users (email) values (%s) returning id", (f"{uuid4().hex}@test.local",))
    row = await cur.fetchone()
    assert row is not None
    return row["id"]


@pytest_asyncio.fixture
async def creator(conn: Conn) -> Creator:
    user_id = await new_user(conn)
    return await creators.create_creator(conn, user_id=user_id, niche="tech", display_name="Ada")


@pytest_asyncio.fixture
async def other_creator(conn: Conn) -> Creator:
    user_id = await new_user(conn)
    return await creators.create_creator(conn, user_id=user_id, niche="fitness", display_name="Bob")


@pytest.fixture
def authenticated() -> Callable[[Conn, UUID], AsyncIterator[None]]:
    """``async with authenticated(conn, user_id):`` runs statements as the `authenticated` role
    with the JWT subject set, exactly as PostgREST would."""

    @asynccontextmanager
    async def _as(conn: Conn, user_id: UUID) -> AsyncIterator[None]:
        async with conn.transaction():
            await conn.execute("select set_config('request.jwt.claim.sub', %s, true)", (str(user_id),))
            await conn.execute("set local role authenticated")
            yield
            await conn.execute("reset role")
            await conn.execute("select set_config('request.jwt.claim.sub', '', true)")

    return _as
