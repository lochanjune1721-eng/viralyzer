"""Run lifecycle: idempotency, one active run, status machine, usage rollup, tenancy."""

from __future__ import annotations

from decimal import Decimal
from uuid import uuid4

import pytest

from tests.conftest import new_user
from viralyzer.db.errors import ActiveRunExists, BudgetExceeded, IllegalTransition, ThreadNotOwned
from viralyzer.db.models import Creator
from viralyzer.db.pool import Conn
from viralyzer.db.repositories import runs


async def test_one_active_run_per_creator(conn: Conn, creator: Creator) -> None:
    first = await runs.create_run(conn, creator_id=creator.id, graph="ideation")
    assert first.status == "queued" and first.is_active

    with pytest.raises(ActiveRunExists) as exc:
        await runs.create_run(conn, creator_id=creator.id, graph="scripting")
    assert exc.value.active_run_id == first.id

    await runs.mark_running(conn, first.id, worker_id="w1")
    with pytest.raises(ActiveRunExists):
        await runs.create_run(conn, creator_id=creator.id, graph="scripting")

    await runs.mark_complete(conn, first.id)
    second = await runs.create_run(conn, creator_id=creator.id, graph="scripting")
    assert second.id != first.id


async def test_awaiting_input_does_not_block_a_new_run(conn: Conn, creator: Creator) -> None:
    run = await runs.create_run(conn, creator_id=creator.id, graph="scripting")
    await runs.mark_running(conn, run.id)
    await runs.mark_awaiting_input(conn, run.id, {"type": "approval", "script_id": "scr_x"})
    other = await runs.create_run(conn, creator_id=creator.id, graph="ideation")
    assert other.status == "queued"


async def test_idempotency_key_returns_same_run(conn: Conn, creator: Creator) -> None:
    a = await runs.create_run(conn, creator_id=creator.id, graph="ideation", idempotency_key="k1")
    b = await runs.create_run(conn, creator_id=creator.id, graph="ideation", idempotency_key="k1")
    assert a.id == b.id
    await runs.mark_running(conn, a.id)
    await runs.mark_complete(conn, a.id)
    # Even after completion the key still maps to the same run (no accidental re-run).
    c = await runs.create_run(conn, creator_id=creator.id, graph="ideation", idempotency_key="k1")
    assert c.id == a.id and c.status == "complete"


async def test_status_machine_and_resume(conn: Conn, creator: Creator) -> None:
    run = await runs.create_run(conn, creator_id=creator.id, graph="scripting")
    run = await runs.mark_running(conn, run.id)
    assert run.started_at is not None and run.attempt == 1

    run = await runs.mark_awaiting_input(conn, run.id, {"question": "approve?"})
    assert run.interrupt == {"question": "approve?"}

    run = await runs.requeue_for_resume(conn, run.id, {"approved": True})
    assert run.status == "queued" and run.resume_count == 1
    assert run.interrupt is None and run.resume_payload == {"approved": True}

    run = await runs.mark_running(conn, run.id)
    assert run.attempt == 2
    run = await runs.mark_complete(conn, run.id)
    assert run.finished_at is not None

    with pytest.raises(IllegalTransition):
        await runs.mark_running(conn, run.id)
    # The connection is still usable after the rejected transition (savepoint rolled back).
    assert (await runs.get_run(conn, run.id)).status == "complete"


async def test_failed_from_queued_and_cancelled(conn: Conn, creator: Creator) -> None:
    run = await runs.create_run(conn, creator_id=creator.id, graph="ideation")
    run = await runs.mark_failed(conn, run.id, "budget exhausted", error_code="budget")
    assert run.status == "failed" and run.error == "budget exhausted" and run.finished_at
    run2 = await runs.create_run(conn, creator_id=creator.id, graph="ideation")
    run2 = await runs.mark_cancelled(conn, run2.id)
    assert run2.status == "cancelled"


async def test_usage_rolls_up_into_run_and_budget(conn: Conn, creator: Creator) -> None:
    before = await runs.budget_remaining_cents(conn, creator.id)
    assert before == Decimal(200)  # free plan
    run = await runs.create_run(conn, creator_id=creator.id, graph="ideation")
    await runs.record_usage(
        conn, run.id, node="trend_researcher", model="cheap", tokens_in=1000, tokens_out=200, cost_cents=Decimal("0.5")
    )
    await runs.record_usage(
        conn, run.id, node="synthesis", model="expensive", tokens_in=4000, tokens_out=800, cost_cents=Decimal("12.25")
    )
    run = await runs.get_run(conn, run.id)
    assert (run.tokens_in, run.tokens_out, run.cost_cents) == (5000, 1000, Decimal("12.75"))
    assert [u.node for u in await runs.list_usage(conn, run.id)] == ["trend_researcher", "synthesis"]
    assert await runs.budget_remaining_cents(conn, creator.id) == Decimal("187.25")

    await runs.record_usage(
        conn, run.id, node="synthesis", model="expensive", tokens_in=1, tokens_out=1, cost_cents=Decimal("200")
    )
    with pytest.raises(BudgetExceeded):
        await runs.assert_budget_available(conn, creator.id)


async def test_thread_ownership_check(conn: Conn, creator: Creator, other_creator: Creator) -> None:
    run = await runs.create_run(conn, creator_id=creator.id, graph="scripting")
    owned = await runs.assert_thread_owned(conn, run.thread_id, creator.user_id)
    assert owned.id == run.id

    with pytest.raises(ThreadNotOwned):
        await runs.assert_thread_owned(conn, run.thread_id, other_creator.user_id)
    with pytest.raises(ThreadNotOwned):
        await runs.assert_thread_owned(conn, uuid4(), creator.user_id)
    # A user with no creator row at all is also rejected.
    with pytest.raises(ThreadNotOwned):
        await runs.assert_thread_owned(conn, run.thread_id, await new_user(conn))
