from __future__ import annotations

from viralyzer.db.models import Creator
from viralyzer.db.pool import Conn
from viralyzer.db.repositories import voice

DIM = 1536


def unit(i: int) -> list[float]:
    v = [0.0] * DIM
    v[i] = 1.0
    return v


async def test_profile_versions_are_snapshotted(conn: Conn, creator: Creator) -> None:
    p1 = await voice.upsert_voice_profile(
        conn, creator.id, tone_rules={"tone": ["dry"]}, summary="v1", embedding=unit(0), embedding_model="test"
    )
    assert p1.version == 1 and p1.embedding is not None and len(p1.embedding) == DIM

    p2 = await voice.upsert_voice_profile(
        conn,
        creator.id,
        tone_rules={"tone": ["dry", "fast"]},
        summary="v1",
        source="refinement",
        change_reason="3 shipped scripts",
    )
    assert p2.version == 2 and p2.refined_at is not None

    # Re-saving identical content does not mint a version.
    p3 = await voice.upsert_voice_profile(
        conn,
        creator.id,
        tone_rules={"tone": ["dry", "fast"]},
        summary="v1",
        source="refinement",
        change_reason="3 shipped scripts",
    )
    assert p3.version == 2

    history = await voice.list_voice_profile_versions(conn, creator.id)
    assert [(h.version, h.source, h.reason) for h in history] == [
        (1, "onboarding", None),
        (2, "refinement", "3 shipped scripts"),
    ]
    assert history[0].embedding == unit(0)


async def test_similar_samples_and_context(conn: Conn, creator: Creator) -> None:
    await voice.upsert_voice_profile(conn, creator.id, tone_rules={}, summary="s")
    a = await voice.add_voice_sample(
        conn, creator.id, kind="existing_content", body="sample a", embedding=unit(1), embedding_model="test"
    )
    await voice.add_voice_sample(
        conn, creator.id, kind="manual", body="sample b", embedding=unit(2), embedding_model="test", weight=2.0
    )
    await voice.add_voice_sample(conn, creator.id, kind="manual", body="no embedding")

    nearest = await voice.similar_voice_samples(conn, creator.id, unit(1), limit=2)
    assert [s.body for s in nearest] == ["sample a", "sample b"]
    assert nearest[0].distance == 0.0 and nearest[0].id == a.id

    ctx = await voice.voice_context(conn, creator.id, query_embedding=unit(2), sample_limit=1)
    assert ctx is not None and ctx.profile.creator_id == creator.id
    assert [s.body for s in ctx.samples] == ["sample b"]

    plain = await voice.voice_context(conn, creator.id)
    assert plain is not None and plain.samples[0].body == "sample b"  # weight first
