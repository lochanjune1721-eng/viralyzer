from __future__ import annotations

from decimal import Decimal

import pytest
from psycopg import errors

from viralyzer.db.models import Creator, IdeaDraft
from viralyzer.db.pool import Conn
from viralyzer.db.repositories import evals, feedback, ideas, runs, scripts


async def test_feedback_drives_idea_and_script_state(conn: Conn, creator: Creator) -> None:
    run = await runs.create_run(conn, creator_id=creator.id, graph="ideation")
    picked, dismissed = await ideas.persist_ideas(
        conn,
        run_id=run.id,
        creator_id=creator.id,
        drafts=[
            IdeaDraft(hook="h1", angle="a", format="f", rationale="r"),
            IdeaDraft(hook="h2", angle="a", format="f", rationale="r"),
        ],
    )
    assert (picked.rank, dismissed.rank) == (1, 2)

    await feedback.record_feedback(
        conn, creator_id=creator.id, subject_type="idea", subject_id=picked.id, event="idea_picked"
    )
    await feedback.record_feedback(
        conn, creator_id=creator.id, subject_type="idea", subject_id=dismissed.id, event="idea_dismissed"
    )
    assert (await ideas.get_idea(conn, picked.id)).status == "picked"
    assert (await ideas.get_idea(conn, dismissed.id)).status == "dismissed"
    assert [i.hook for i in await ideas.list_ideas(conn, creator.id, status="picked")] == ["h1"]

    script = await scripts.append_script_version(
        conn,
        idea_id=picked.id,
        creator_id=creator.id,
        revision_kind="draft",
        body={"hook": "h", "beats": [], "cta": "c"},
    )
    await feedback.record_feedback(
        conn, creator_id=creator.id, subject_type="script", subject_id=script.id, event="script_approved"
    )
    await feedback.record_feedback(
        conn,
        creator_id=creator.id,
        subject_type="script",
        subject_id=script.id,
        event="script_shipped_unedited",
        payload={"platform": "tiktok", "post_url": "https://t/1"},
    )
    script = await scripts.get_script(conn, script.id)
    assert script.status == "shipped" and script.shipped_unedited is True and script.approved_at is not None
    assert (await ideas.get_idea(conn, picked.id)).status == "scripted"
    assert [s.id for s in await feedback.shipped_unedited_scripts(conn, creator.id)] == [script.id]

    events = await feedback.list_feedback(conn, creator.id, events=["script_shipped_unedited"])
    assert len(events) == 1 and events[0].payload["platform"] == "tiktok"


async def test_ledger_is_append_only_and_consistent(conn: Conn, creator: Creator) -> None:
    run = await runs.create_run(conn, creator_id=creator.id, graph="ideation")
    [idea] = await ideas.persist_ideas(
        conn, run_id=run.id, creator_id=creator.id, drafts=[IdeaDraft(hook="h", angle="a", format="f", rationale="r")]
    )
    ev = await feedback.record_feedback(
        conn, creator_id=creator.id, subject_type="idea", subject_id=idea.id, event="idea_picked"
    )
    with pytest.raises(errors.InsufficientPrivilege):
        async with conn.transaction():
            await conn.execute("update public.feedback_events set event = 'idea_dismissed' where id = %s", (ev.id,))
    with pytest.raises(errors.CheckViolation):
        await feedback.record_feedback(
            conn, creator_id=creator.id, subject_type="idea", subject_id=idea.id, event="script_approved"
        )


async def test_eval_run_summary(conn: Conn) -> None:
    case = await evals.upsert_eval_case(
        conn,
        slug="tech-contrarian-1",
        creator_profile={"niche": "tech"},
        idea={"hook": "h"},
        reference_script={"hook": "h", "beats": [], "cta": "c"},
        tags=["tech"],
    )
    case = await evals.upsert_eval_case(
        conn,
        slug="tech-contrarian-1",
        creator_profile={"niche": "tech", "tone": "dry"},
        idea={"hook": "h"},
        reference_script={"hook": "h", "beats": [], "cta": "c"},
    )
    assert case.creator_profile["tone"] == "dry" and case.tags == []
    assert [c.slug for c in await evals.list_eval_cases(conn)] == ["tech-contrarian-1"]

    eval_run = await evals.start_eval_run(
        conn,
        graph="scripting",
        prompt_version="scripting@0.3.0",
        judge_model="judge-1",
        model_routing={"draft": "cheap", "revise": "expensive"},
    )
    await evals.record_eval_score(
        conn,
        eval_run_id=eval_run.id,
        eval_case_id=case.id,
        candidate={"hook": "x"},
        hook_strength=8.5,
        voice_match=7,
        structure=9,
        cost_cents=Decimal("1.5"),
    )
    finished = await evals.finish_eval_run(conn, eval_run.id)
    assert finished.finished_at is not None
    assert finished.summary == {"n": 1, "hook_strength": 8.5, "voice_match": 7, "structure": 9, "cost_cents": 1.5}
    assert [r.id for r in await evals.list_eval_runs(conn, graph="scripting")] == [eval_run.id]
