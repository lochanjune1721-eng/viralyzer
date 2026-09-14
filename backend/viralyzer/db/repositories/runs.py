"""Runs: creation with idempotency + one-active-run, status machine, usage, tenancy."""

from __future__ import annotations

from decimal import Decimal
from typing import Any
from uuid import UUID

from psycopg import errors, sql

from viralyzer.db.errors import ActiveRunExists, BudgetExceeded, IllegalTransition, NotFound, ThreadNotOwned
from viralyzer.db.models import Run, RunUsage
from viralyzer.db.pool import Conn
from viralyzer.db.repositories._common import fetch_all, fetch_one, jsonb, require_one

_ONE_ACTIVE_INDEX = "runs_one_active_per_creator"
_IDEMPOTENCY_INDEX = "runs_idempotency_key_idx"


async def active_run(conn: Conn, creator_id: UUID) -> Run | None:
    row = await fetch_one(
        conn,
        """
        select * from public.runs
         where creator_id = %s and status in ('queued', 'running')
         order by queued_at desc limit 1
        """,
        (creator_id,),
    )
    return Run.model_validate(row) if row else None


async def _by_idempotency_key(conn: Conn, creator_id: UUID, key: str) -> Run | None:
    row = await fetch_one(
        conn,
        "select * from public.runs where creator_id = %s and idempotency_key = %s",
        (creator_id, key),
    )
    return Run.model_validate(row) if row else None


async def create_run(
    conn: Conn,
    *,
    creator_id: UUID,
    graph: str,
    input: dict[str, Any] | None = None,
    idea_id: UUID | None = None,
    idempotency_key: str | None = None,
    prompt_version: str | None = None,
) -> Run:
    """Insert a queued run.

    * Same ``idempotency_key`` for the same creator returns the existing run
      (safe client retries, Stripe-style).
    * A second concurrent run raises :class:`ActiveRunExists`; the partial
      unique index makes this race-free without a check-then-insert.
    """
    if idempotency_key is not None:
        existing = await _by_idempotency_key(conn, creator_id, idempotency_key)
        if existing is not None:
            return existing
    try:
        async with conn.transaction():
            row = await require_one(
                conn,
                """
                insert into public.runs (creator_id, graph, input, idea_id, idempotency_key, prompt_version)
                values (%s, %s, %s, %s, %s, %s)
                returning *
                """,
                (creator_id, graph, jsonb(input or {}), idea_id, idempotency_key, prompt_version),
            )
    except errors.UniqueViolation as exc:
        constraint = exc.diag.constraint_name
        if constraint == _ONE_ACTIVE_INDEX:
            active = await active_run(conn, creator_id)
            raise ActiveRunExists(creator_id, active.id if active else None) from exc
        if constraint == _IDEMPOTENCY_INDEX and idempotency_key is not None:
            existing = await _by_idempotency_key(conn, creator_id, idempotency_key)
            if existing is not None:
                return existing
        raise
    return Run.model_validate(row)


async def get_run(conn: Conn, run_id: UUID, *, creator_id: UUID | None = None) -> Run | None:
    if creator_id is None:
        row = await fetch_one(conn, "select * from public.runs where id = %s", (run_id,))
    else:
        row = await fetch_one(conn, "select * from public.runs where id = %s and creator_id = %s", (run_id, creator_id))
    return Run.model_validate(row) if row else None


async def get_run_by_thread(conn: Conn, thread_id: UUID) -> Run | None:
    row = await fetch_one(conn, "select * from public.runs where thread_id = %s", (thread_id,))
    return Run.model_validate(row) if row else None


async def assert_thread_owned(conn: Conn, thread_id: UUID, user_id: UUID) -> Run:
    """The tenancy check for the checkpoint schema.

    A thread_id coming from a client is only honoured if the run that owns it
    belongs to the caller's JWT subject. Missing and foreign threads get the
    same error so existence is not leaked.
    """
    row = await fetch_one(
        conn,
        """
        select r.*
          from public.runs r
          join public.creators c on c.id = r.creator_id
         where r.thread_id = %s and c.user_id = %s
        """,
        (thread_id, user_id),
    )
    if row is None:
        raise ThreadNotOwned(f"thread {thread_id} is not owned by user {user_id}")
    return Run.model_validate(row)


async def list_runs(conn: Conn, creator_id: UUID, *, limit: int = 50) -> list[Run]:
    rows = await fetch_all(
        conn,
        "select * from public.runs where creator_id = %s order by queued_at desc limit %s",
        (creator_id, limit),
    )
    return [Run.model_validate(r) for r in rows]


async def transition(
    conn: Conn,
    run_id: UUID,
    status: str,
    *,
    error: str | None = None,
    error_code: str | None = None,
    interrupt: Any | None = None,
    resume_payload: Any | None = None,
    worker_id: str | None = None,
    trace_id: str | None = None,
) -> Run:
    """Move a run through its status machine. Illegal moves raise IllegalTransition."""
    sets: list[sql.Composable] = [sql.SQL("status = %(status)s")]
    params: dict[str, Any] = {"status": status, "run_id": run_id}
    optional = {
        "error": error,
        "error_code": error_code,
        "interrupt": jsonb(interrupt) if interrupt is not None else None,
        "resume_payload": jsonb(resume_payload) if resume_payload is not None else None,
        "worker_id": worker_id,
        "trace_id": trace_id,
    }
    for column, value in optional.items():
        if value is not None:
            sets.append(sql.SQL("{} = {}").format(sql.Identifier(column), sql.Placeholder(column)))
            params[column] = value
    query = sql.SQL("update public.runs set {} where id = %(run_id)s returning *").format(sql.SQL(", ").join(sets))
    try:
        async with conn.transaction():
            row = await fetch_one(conn, query, params)
    except errors.CheckViolation as exc:
        raise IllegalTransition(str(exc).splitlines()[0]) from exc
    if row is None:
        raise NotFound(f"run {run_id} not found")
    return Run.model_validate(row)


async def mark_running(conn: Conn, run_id: UUID, *, worker_id: str | None = None, trace_id: str | None = None) -> Run:
    return await transition(conn, run_id, "running", worker_id=worker_id, trace_id=trace_id)


async def mark_awaiting_input(conn: Conn, run_id: UUID, interrupt: Any) -> Run:
    return await transition(conn, run_id, "awaiting_input", interrupt=interrupt)


async def requeue_for_resume(conn: Conn, run_id: UUID, decision: Any) -> Run:
    """POST /runs/{id}/resume: store the decision and re-queue the same job."""
    return await transition(conn, run_id, "queued", resume_payload=decision)


async def mark_complete(conn: Conn, run_id: UUID) -> Run:
    return await transition(conn, run_id, "complete")


async def mark_failed(conn: Conn, run_id: UUID, error: str, *, error_code: str | None = None) -> Run:
    return await transition(conn, run_id, "failed", error=error, error_code=error_code)


async def mark_cancelled(conn: Conn, run_id: UUID) -> Run:
    return await transition(conn, run_id, "cancelled")


async def record_usage(
    conn: Conn,
    run_id: UUID,
    *,
    node: str,
    model: str,
    tokens_in: int,
    tokens_out: int,
    cost_cents: Decimal | float | int,
    provider: str | None = None,
    cached_tokens: int = 0,
    latency_ms: int | None = None,
) -> RunUsage:
    """Per-node usage; totals roll up into runs.* by trigger."""
    row = await fetch_one(
        conn,
        """
        insert into public.run_usage
          (run_id, creator_id, node, model, provider, tokens_in, tokens_out, cached_tokens, cost_cents, latency_ms)
        select r.id, r.creator_id, %s, %s, %s, %s, %s, %s, %s, %s
          from public.runs r
         where r.id = %s
        returning *
        """,
        (node, model, provider, tokens_in, tokens_out, cached_tokens, cost_cents, latency_ms, run_id),
    )
    if row is None:
        raise NotFound(f"run {run_id} not found")
    return RunUsage.model_validate(row)


async def list_usage(conn: Conn, run_id: UUID) -> list[RunUsage]:
    rows = await fetch_all(conn, "select * from public.run_usage where run_id = %s order by recorded_at, id", (run_id,))
    return [RunUsage.model_validate(r) for r in rows]


async def budget_remaining_cents(conn: Conn, creator_id: UUID) -> Decimal:
    row = await fetch_one(conn, "select public.budget_remaining_cents(%s) as remaining", (creator_id,))
    if row is None or row["remaining"] is None:
        raise NotFound(f"creator {creator_id} not found")
    return Decimal(row["remaining"])


async def assert_budget_available(conn: Conn, creator_id: UUID) -> Decimal:
    """Worker pre-flight: refuse to start a run once the month's plan budget is spent."""
    remaining = await budget_remaining_cents(conn, creator_id)
    if remaining <= 0:
        raise BudgetExceeded(f"creator {creator_id} has {remaining} cents left this month")
    return remaining


__all__ = [
    "active_run",
    "assert_budget_available",
    "assert_thread_owned",
    "budget_remaining_cents",
    "create_run",
    "get_run",
    "get_run_by_thread",
    "list_runs",
    "list_usage",
    "mark_awaiting_input",
    "mark_cancelled",
    "mark_complete",
    "mark_failed",
    "mark_running",
    "record_usage",
    "requeue_for_resume",
    "transition",
]
