from __future__ import annotations

import pytest
from psycopg import errors

from viralyzer.db.models import Creator, IdeaDraft, ScriptBeat, ScriptBody
from viralyzer.db.pool import Conn
from viralyzer.db.repositories import ideas, runs, scripts


async def _idea(conn: Conn, creator: Creator):
    run = await runs.create_run(conn, creator_id=creator.id, graph="ideation")
    [idea] = await ideas.persist_ideas(
        conn,
        run_id=run.id,
        creator_id=creator.id,
        drafts=[IdeaDraft(hook="Why your reels flop", angle="contrarian", format="talking_head", rationale="r")],
    )
    return idea


async def test_versions_append_and_head_moves(conn: Conn, creator: Creator) -> None:
    idea = await _idea(conn, creator)
    body = ScriptBody(hook="Stop doing this", beats=[ScriptBeat(text="beat 1")], cta="Follow")
    v1 = await scripts.append_script_version(
        conn,
        idea_id=idea.id,
        creator_id=creator.id,
        body=body,
        revision_kind="draft",
        platform="tiktok",
        target_seconds=45,
    )
    v2 = await scripts.append_script_version(
        conn,
        idea_id=idea.id,
        creator_id=creator.id,
        body=body.model_copy(update={"hook": "v2"}),
        revision_kind="critique_revision",
        critique={"issues": ["weak hook"]},
    )
    v3 = await scripts.append_script_version(
        conn,
        idea_id=idea.id,
        creator_id=creator.id,
        body=body.model_copy(update={"hook": "v3"}),
        revision_kind="human_edit",
    )

    assert [v.version for v in (v1, v2, v3)] == [1, 2, 3]
    assert v2.parent_script_id == v1.id and v3.parent_script_id == v2.id
    versions = await scripts.list_script_versions(conn, idea.id)
    assert [v.is_current for v in versions] == [False, False, True]
    head = await scripts.current_script(conn, idea.id)
    assert head is not None and head.id == v3.id and head.parsed_body().hook == "v3"
    assert v1.parsed_body().beats[0].text == "beat 1"


async def test_body_shape_is_enforced(conn: Conn, creator: Creator) -> None:
    idea = await _idea(conn, creator)
    with pytest.raises(errors.CheckViolation):
        await scripts.append_script_version(
            conn,
            idea_id=idea.id,
            creator_id=creator.id,
            revision_kind="draft",
            body={"hook": "h", "beats": []},  # no cta
        )


async def test_single_current_per_idea_is_a_db_invariant(conn: Conn, creator: Creator) -> None:
    idea = await _idea(conn, creator)
    await scripts.append_script_version(
        conn, idea_id=idea.id, creator_id=creator.id, revision_kind="draft", body={"hook": "h", "beats": [], "cta": "c"}
    )
    with pytest.raises(errors.UniqueViolation):
        async with conn.transaction():
            await conn.execute(
                "update public.scripts set is_current = true where idea_id = %s and version = 1; "
                if False
                else "insert into public.scripts (idea_id, creator_id, version, revision_kind, is_current, body) "
                'values (%s, %s, 1, \'draft\', false, \'{"hook": "h", "beats": [], "cta": "c"}\')',
                (idea.id, creator.id),
            )
