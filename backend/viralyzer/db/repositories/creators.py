"""Creators, their platform accounts and their own published content."""

from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

from viralyzer.db.models import Creator, CreatorPlatform, CreatorPost, CreatorPostDraft
from viralyzer.db.pool import Conn
from viralyzer.db.repositories._common import fetch_all, fetch_one, jsonb, require_one


async def create_creator(
    conn: Conn,
    *,
    user_id: UUID,
    niche: str,
    display_name: str | None = None,
    handle: str | None = None,
    audience: str | None = None,
    plan_key: str = "free",
) -> Creator:
    row = await require_one(
        conn,
        """
        insert into public.creators (user_id, niche, display_name, handle, audience, plan_key)
        values (%s, %s, %s, %s, %s, %s)
        returning *
        """,
        (user_id, niche, display_name, handle, audience, plan_key),
    )
    return Creator.model_validate(row)


async def get_creator(conn: Conn, creator_id: UUID) -> Creator | None:
    row = await fetch_one(conn, "select * from public.creators where id = %s", (creator_id,))
    return Creator.model_validate(row) if row else None


async def get_creator_by_user(conn: Conn, user_id: UUID) -> Creator | None:
    row = await fetch_one(conn, "select * from public.creators where user_id = %s", (user_id,))
    return Creator.model_validate(row) if row else None


async def update_creator(
    conn: Conn,
    creator_id: UUID,
    *,
    display_name: str | None = None,
    handle: str | None = None,
    niche: str | None = None,
    audience: str | None = None,
    plan_key: str | None = None,
    onboarding_status: str | None = None,
) -> Creator:
    row = await require_one(
        conn,
        """
        update public.creators
           set display_name      = coalesce(%s, display_name),
               handle            = coalesce(%s, handle),
               niche             = coalesce(%s, niche),
               audience          = coalesce(%s, audience),
               plan_key          = coalesce(%s, plan_key),
               onboarding_status = coalesce(%s, onboarding_status)
         where id = %s
        returning *
        """,
        (display_name, handle, niche, audience, plan_key, onboarding_status, creator_id),
        what="creator",
    )
    return Creator.model_validate(row)


async def upsert_platform(
    conn: Conn,
    creator_id: UUID,
    platform: str,
    *,
    handle: str | None = None,
    external_account_id: str | None = None,
    followers: int | None = None,
    is_primary: bool = False,
) -> CreatorPlatform:
    row = await require_one(
        conn,
        """
        insert into public.creator_platforms
          (creator_id, platform, handle, external_account_id, followers, is_primary)
        values (%s, %s, %s, %s, %s, %s)
        on conflict (creator_id, platform) do update set
          handle              = coalesce(excluded.handle, public.creator_platforms.handle),
          external_account_id = coalesce(excluded.external_account_id, public.creator_platforms.external_account_id),
          followers           = coalesce(excluded.followers, public.creator_platforms.followers),
          is_primary          = excluded.is_primary
        returning *
        """,
        (creator_id, platform, handle, external_account_id, followers, is_primary),
    )
    return CreatorPlatform.model_validate(row)


async def list_platforms(conn: Conn, creator_id: UUID) -> list[CreatorPlatform]:
    rows = await fetch_all(
        conn,
        "select * from public.creator_platforms where creator_id = %s order by is_primary desc, platform",
        (creator_id,),
    )
    return [CreatorPlatform.model_validate(r) for r in rows]


async def upsert_posts(
    conn: Conn,
    creator_id: UUID,
    posts: Sequence[CreatorPostDraft],
    *,
    ingested_via: str,
) -> list[CreatorPost]:
    """Insert or refresh the creator's own posts (metrics change between fetches)."""
    out: list[CreatorPost] = []
    async with conn.transaction():
        for p in posts:
            row = await require_one(
                conn,
                """
                insert into public.creator_posts
                  (creator_id, platform, external_id, url, title, caption, transcript, posted_at,
                   duration_seconds, views, likes, comments, shares, metrics, engagement_rate,
                   is_top_performer, ingested_via, fetched_at)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                on conflict (creator_id, platform, external_id) do update set
                  url              = coalesce(excluded.url, public.creator_posts.url),
                  title            = coalesce(excluded.title, public.creator_posts.title),
                  caption          = coalesce(excluded.caption, public.creator_posts.caption),
                  transcript       = coalesce(excluded.transcript, public.creator_posts.transcript),
                  posted_at        = coalesce(excluded.posted_at, public.creator_posts.posted_at),
                  duration_seconds = coalesce(excluded.duration_seconds, public.creator_posts.duration_seconds),
                  views            = coalesce(excluded.views, public.creator_posts.views),
                  likes            = coalesce(excluded.likes, public.creator_posts.likes),
                  comments         = coalesce(excluded.comments, public.creator_posts.comments),
                  shares           = coalesce(excluded.shares, public.creator_posts.shares),
                  metrics          = public.creator_posts.metrics || excluded.metrics,
                  engagement_rate  = coalesce(excluded.engagement_rate, public.creator_posts.engagement_rate),
                  is_top_performer = excluded.is_top_performer,
                  ingested_via     = excluded.ingested_via,
                  fetched_at       = now()
                returning *
                """,
                (
                    creator_id,
                    p.platform,
                    p.external_id,
                    p.url,
                    p.title,
                    p.caption,
                    p.transcript,
                    p.posted_at,
                    p.duration_seconds,
                    p.views,
                    p.likes,
                    p.comments,
                    p.shares,
                    jsonb(p.metrics),
                    p.engagement_rate,
                    p.is_top_performer,
                    ingested_via,
                ),
            )
            out.append(CreatorPost.model_validate(row))
    return out


async def top_posts(conn: Conn, creator_id: UUID, *, limit: int = 10) -> list[CreatorPost]:
    """Recent top performers: flagged posts first, then by views."""
    rows = await fetch_all(
        conn,
        """
        select * from public.creator_posts
         where creator_id = %s
         order by is_top_performer desc, views desc nulls last, posted_at desc nulls last
         limit %s
        """,
        (creator_id, limit),
    )
    return [CreatorPost.model_validate(r) for r in rows]


__all__ = [
    "create_creator",
    "get_creator",
    "get_creator_by_user",
    "list_platforms",
    "top_posts",
    "update_creator",
    "upsert_platform",
    "upsert_posts",
]
