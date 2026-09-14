"""Voice profile (current + history) and voice samples."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any
from uuid import UUID

from viralyzer.db.models import VoiceContext, VoiceProfile, VoiceProfileVersion, VoiceSample
from viralyzer.db.pool import Conn
from viralyzer.db.repositories._common import fetch_all, fetch_one, jsonb, require_one, vector


async def upsert_voice_profile(
    conn: Conn,
    creator_id: UUID,
    *,
    tone_rules: dict[str, Any],
    summary: str | None,
    embedding: Sequence[float] | None = None,
    embedding_model: str | None = None,
    source: str = "onboarding",
    change_reason: str | None = None,
    status: str = "ready",
) -> VoiceProfile:
    """Create or replace the current profile. Version bump + history snapshot happen by trigger."""
    row = await require_one(
        conn,
        """
        insert into public.voice_profiles
          (creator_id, tone_rules, summary, embedding, embedding_model, source, change_reason, status)
        values (%s, %s, %s, %s::extensions.vector, %s, %s, %s, %s)
        on conflict (creator_id) do update set
          tone_rules      = excluded.tone_rules,
          summary         = excluded.summary,
          embedding       = excluded.embedding,
          embedding_model = excluded.embedding_model,
          source          = excluded.source,
          change_reason   = excluded.change_reason,
          status          = excluded.status
        returning *
        """,
        (creator_id, jsonb(tone_rules), summary, vector(embedding), embedding_model, source, change_reason, status),
    )
    return VoiceProfile.model_validate(row)


async def get_voice_profile(conn: Conn, creator_id: UUID) -> VoiceProfile | None:
    row = await fetch_one(conn, "select * from public.voice_profiles where creator_id = %s", (creator_id,))
    return VoiceProfile.model_validate(row) if row else None


async def list_voice_profile_versions(conn: Conn, creator_id: UUID) -> list[VoiceProfileVersion]:
    rows = await fetch_all(
        conn,
        "select * from public.voice_profile_versions where creator_id = %s order by version",
        (creator_id,),
    )
    return [VoiceProfileVersion.model_validate(r) for r in rows]


async def add_voice_sample(
    conn: Conn,
    creator_id: UUID,
    *,
    kind: str,
    body: str,
    title: str | None = None,
    platform: str | None = None,
    source_post_id: UUID | None = None,
    source_script_id: UUID | None = None,
    performance: dict[str, Any] | None = None,
    embedding: Sequence[float] | None = None,
    embedding_model: str | None = None,
    weight: float = 1.0,
) -> VoiceSample:
    row = await require_one(
        conn,
        """
        insert into public.voice_samples
          (creator_id, kind, body, title, platform, source_post_id, source_script_id,
           performance, embedding, embedding_model, weight)
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s::extensions.vector, %s, %s)
        returning *
        """,
        (
            creator_id,
            kind,
            body,
            title,
            platform,
            source_post_id,
            source_script_id,
            jsonb(performance or {}),
            vector(embedding),
            embedding_model,
            weight,
        ),
    )
    return VoiceSample.model_validate(row)


async def list_voice_samples(conn: Conn, creator_id: UUID, *, limit: int = 50) -> list[VoiceSample]:
    rows = await fetch_all(
        conn,
        """
        select * from public.voice_samples
         where creator_id = %s
         order by weight desc, created_at desc
         limit %s
        """,
        (creator_id, limit),
    )
    return [VoiceSample.model_validate(r) for r in rows]


async def similar_voice_samples(
    conn: Conn,
    creator_id: UUID,
    embedding: Sequence[float],
    *,
    limit: int = 5,
) -> list[VoiceSample]:
    """Nearest samples by cosine distance (HNSW index on voice_samples.embedding)."""
    rows = await fetch_all(
        conn,
        """
        select s.*, (s.embedding operator(extensions.<=>) %s::extensions.vector) as distance
          from public.voice_samples s
         where s.creator_id = %s and s.embedding is not null
         order by s.embedding operator(extensions.<=>) %s::extensions.vector
         limit %s
        """,
        (vector(embedding), creator_id, vector(embedding), limit),
    )
    return [VoiceSample.model_validate(r) for r in rows]


async def voice_context(
    conn: Conn,
    creator_id: UUID,
    *,
    query_embedding: Sequence[float] | None = None,
    sample_limit: int = 5,
) -> VoiceContext | None:
    """Profile + samples in the shape both graphs inject as context."""
    profile = await get_voice_profile(conn, creator_id)
    if profile is None:
        return None
    if query_embedding is not None:
        samples = await similar_voice_samples(conn, creator_id, query_embedding, limit=sample_limit)
    else:
        samples = await list_voice_samples(conn, creator_id, limit=sample_limit)
    return VoiceContext(profile=profile, samples=samples)


__all__ = [
    "add_voice_sample",
    "get_voice_profile",
    "list_voice_profile_versions",
    "list_voice_samples",
    "similar_voice_samples",
    "upsert_voice_profile",
    "voice_context",
]
