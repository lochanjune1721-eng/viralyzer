"""Apply ``supabase/migrations/*.sql`` to a plain Postgres.

Production uses the Supabase CLI (``supabase db push``); this module exists so
tests and local development can run the exact same files against a throwaway
database (with ``tests/sql/supabase_stub.sql`` standing in for Supabase's
``auth`` schema and roles).

Each file is sent as one simple-protocol query, so it runs as a single implicit
transaction: a failing statement rolls the whole file back. That also means
``CREATE INDEX CONCURRENTLY`` is not allowed in migration files (it is not used).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import psycopg
from psycopg import errors
from psycopg.pq import DiagnosticField, ExecStatus

DEFAULT_MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "supabase" / "migrations"
_OK = {ExecStatus.COMMAND_OK, ExecStatus.TUPLES_OK, ExecStatus.EMPTY_QUERY}


def apply_sql(conn: psycopg.Connection, script: str, *, label: str = "<sql>") -> None:
    """Run a multi-statement script through libpq's simple query protocol."""
    result = conn.pgconn.exec_(script.encode("utf-8"))
    if result.status in _OK:
        return
    sqlstate = result.error_field(DiagnosticField.SQLSTATE)
    message = (result.error_message or b"unknown error").decode("utf-8", "replace").strip()
    exc_type = errors.lookup(sqlstate.decode()) if sqlstate else psycopg.DatabaseError
    raise exc_type(f"{label}: {message}")


def migration_files(directory: Path = DEFAULT_MIGRATIONS_DIR) -> list[Path]:
    files = sorted(p for p in directory.glob("*.sql") if p.is_file())
    if not files:
        raise FileNotFoundError(f"no .sql migrations under {directory}")
    return files


def apply_migrations(
    conninfo: str,
    directory: Path = DEFAULT_MIGRATIONS_DIR,
    *,
    pre_files: tuple[Path, ...] = (),
    echo=print,
) -> list[str]:
    """Apply ``pre_files`` then every migration in filename order. Returns applied names."""
    applied: list[str] = []
    with psycopg.connect(conninfo, autocommit=True, prepare_threshold=0) as conn:
        for path in (*pre_files, *migration_files(directory)):
            apply_sql(conn, path.read_text(encoding="utf-8"), label=path.name)
            applied.append(path.name)
            if echo:
                echo(f"applied {path.name}")
    return applied


def _cli(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="python -m viralyzer.db.migrate",
        description="Apply supabase/migrations to a plain Postgres (local/test use only).",
    )
    parser.add_argument("--url", default=os.environ.get("SUPABASE_DB_DIRECT_URL"))
    parser.add_argument("--dir", type=Path, default=DEFAULT_MIGRATIONS_DIR)
    parser.add_argument(
        "--with-supabase-stub",
        action="store_true",
        help="apply tests/sql/supabase_stub.sql first (plain Postgres without Supabase)",
    )
    args = parser.parse_args(argv)
    if not args.url:
        parser.error("no connection URL: pass --url or set SUPABASE_DB_DIRECT_URL")
    pre: tuple[Path, ...] = ()
    if args.with_supabase_stub:
        pre = (Path(__file__).resolve().parents[2] / "tests" / "sql" / "supabase_stub.sql",)
    apply_migrations(args.url, args.dir, pre_files=pre)
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(_cli())


__all__ = ["DEFAULT_MIGRATIONS_DIR", "apply_migrations", "apply_sql", "migration_files"]
