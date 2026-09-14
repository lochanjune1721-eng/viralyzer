"""Monid connector calls, deduplicated sources and typed extension results.

Flow for one search:

    call = await start_call(conn, connector_slug="octen#search", purpose="niche_research", params={...})
    ... invoke Monid ...
    await complete_call(conn, call.id, results=[SourceResult(...), ...], usage=meta_usage, cost_usd_micros=..)

Before calling Monid, ``find_cached_call`` answers the same (connector, params)
from a recent successful call so the nightly cron and ideation runs do not pay
twice for the same query.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import UUID

from viralyzer.db.models import Connector, ResearchCall, SocialPost, Source, SourceResult
from viralyzer.db.pool import Conn
from viralyzer.db.repositories._common import fetch_all, fetch_one, jsonb, require_one, vector

_TRACKING_PARAMS = {"fbclid", "gclid", "igshid", "mc_cid", "mc_eid", "ref", "ref_src", "si", "yclid"}
_DEFAULT_PORTS = {"http": 80, "https": 443}


def canonical_url(url: str) -> str:
    """Normalise a URL so the same page from different connectors dedupes to one source."""
    parts = urlsplit(url.strip())
    scheme = parts.scheme.lower() or "https"
    host = (parts.hostname or "").lower()
    if parts.port and parts.port != _DEFAULT_PORTS.get(scheme):
        host = f"{host}:{parts.port}"
    query = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not k.lower().startswith("utm_") and k.lower() not in _TRACKING_PARAMS
    ]
    path = parts.path or "/"
    if len(path) > 1 and path.endswith("/"):
        path = path.rstrip("/")
    return urlunsplit((scheme, host, path, urlencode(sorted(query)), ""))


def content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------- connectors
async def register_connector(
    conn: Conn,
    *,
    slug: str,
    kind: str,
    result_table: str | None = None,
    pricing: dict[str, Any] | None = None,
    default_params: dict[str, Any] | None = None,
    is_enabled: bool = True,
) -> Connector:
    provider, _, endpoint = slug.partition("#")
    row = await require_one(
        conn,
        """
        insert into research.connectors
          (slug, provider, endpoint, kind, result_table, pricing, default_params, is_enabled)
        values (%s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (slug) do update set
          kind           = excluded.kind,
          result_table   = excluded.result_table,
          pricing        = excluded.pricing,
          default_params = excluded.default_params,
          is_enabled     = excluded.is_enabled
        returning *
        """,
        (slug, provider, endpoint, kind, result_table, jsonb(pricing or {}), jsonb(default_params or {}), is_enabled),
    )
    return Connector.model_validate(row)


async def list_connectors(conn: Conn, *, enabled_only: bool = True) -> list[Connector]:
    rows = await fetch_all(
        conn,
        "select * from research.connectors where (not %s or is_enabled) order by slug",
        (enabled_only,),
    )
    return [Connector.model_validate(r) for r in rows]


# ---------------------------------------------------------------- calls
async def find_cached_call(
    conn: Conn,
    connector_slug: str,
    params: dict[str, Any],
    *,
    max_age: timedelta = timedelta(hours=24),
) -> ResearchCall | None:
    """Most recent successful call with identical params (hash computed by Postgres)."""
    row = await fetch_one(
        conn,
        """
        select * from research.calls
         where connector_slug = %s
           and params_hash = public.sha256_hex(%s || ':' || (%s::jsonb)::text)
           and status = 'succeeded'
           and requested_at >= now() - %s
           and (expires_at is null or expires_at > now())
         order by requested_at desc
         limit 1
        """,
        (connector_slug, connector_slug, jsonb(params), max_age),
    )
    return ResearchCall.model_validate(row) if row else None


async def start_call(
    conn: Conn,
    *,
    connector_slug: str,
    purpose: str,
    params: dict[str, Any],
    query: str | None = None,
    run_id: UUID | None = None,
    creator_id: UUID | None = None,
    niche: str | None = None,
) -> ResearchCall:
    row = await require_one(
        conn,
        """
        insert into research.calls (connector_slug, purpose, params, query, run_id, creator_id, niche)
        values (%s, %s, %s, %s, %s, %s, %s)
        returning *
        """,
        (connector_slug, purpose, jsonb(params), query, run_id, creator_id, niche),
    )
    return ResearchCall.model_validate(row)


async def upsert_source(conn: Conn, result: SourceResult) -> Source:
    """Insert or refresh one source keyed by canonical URL."""
    url = canonical_url(result.url)
    now = datetime.now(UTC)
    row = await require_one(
        conn,
        """
        insert into research.sources
          (url, kind, title, author, published_at, language, snippet, content, content_hash,
           content_fetched_at, metadata)
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (url_hash) do update set
          title              = coalesce(excluded.title, research.sources.title),
          author             = coalesce(excluded.author, research.sources.author),
          published_at       = coalesce(excluded.published_at, research.sources.published_at),
          language           = coalesce(excluded.language, research.sources.language),
          snippet            = coalesce(excluded.snippet, research.sources.snippet),
          content            = coalesce(excluded.content, research.sources.content),
          content_hash       = coalesce(excluded.content_hash, research.sources.content_hash),
          content_fetched_at = coalesce(excluded.content_fetched_at, research.sources.content_fetched_at),
          metadata           = research.sources.metadata || excluded.metadata,
          last_seen_at       = now(),
          seen_count         = research.sources.seen_count + 1
        returning *
        """,
        (
            url,
            result.kind,
            result.title,
            result.author,
            result.published_at,
            result.language,
            result.snippet,
            result.content,
            content_hash(result.content) if result.content else None,
            now if result.content else None,
            jsonb(result.metadata),
        ),
    )
    return Source.model_validate(row)


async def complete_call(
    conn: Conn,
    call_id: UUID,
    *,
    results: Sequence[SourceResult],
    usage: dict[str, Any] | None = None,
    cost_usd_micros: int | None = None,
    raw_response: Any | None = None,
    monid_run_id: str | None = None,
    latency_ms: int | None = None,
    ttl: timedelta | None = timedelta(hours=24),
) -> tuple[ResearchCall, list[Source]]:
    """Record results: upsert sources, link them ranked to the call, close the call."""
    sources: list[Source] = []
    async with conn.transaction():
        for rank, result in enumerate(results, start=1):
            source = await upsert_source(conn, result)
            await conn.execute(
                """
                insert into research.call_results (call_id, source_id, rank, score, snippet, highlights, raw)
                values (%s, %s, %s, %s, %s, %s, %s)
                on conflict do nothing
                """,
                (call_id, source.id, rank, result.score, result.snippet, result.highlights or None, jsonb(result.raw)),
            )
            sources.append(source)
        row = await require_one(
            conn,
            """
            update research.calls
               set status          = 'succeeded',
                   usage           = %s,
                   cost_usd_micros = %s,
                   result_count    = %s,
                   raw_response    = %s,
                   monid_run_id    = coalesce(%s, monid_run_id),
                   latency_ms      = %s,
                   completed_at    = now(),
                   expires_at      = case when %s::interval is null then null else now() + %s::interval end
             where id = %s
            returning *
            """,
            (
                jsonb(usage or {}),
                cost_usd_micros,
                len(results),
                jsonb(raw_response),
                monid_run_id,
                latency_ms,
                ttl,
                ttl,
                call_id,
            ),
            what="research call",
        )
    return ResearchCall.model_validate(row), sources


async def fail_call(conn: Conn, call_id: UUID, error: str) -> ResearchCall:
    row = await require_one(
        conn,
        """
        update research.calls
           set status = 'failed', error = %s, completed_at = now()
         where id = %s
        returning *
        """,
        (error, call_id),
        what="research call",
    )
    return ResearchCall.model_validate(row)


async def get_call(conn: Conn, call_id: UUID) -> ResearchCall | None:
    row = await fetch_one(conn, "select * from research.calls where id = %s", (call_id,))
    return ResearchCall.model_validate(row) if row else None


async def list_call_sources(conn: Conn, call_id: UUID) -> list[Source]:
    rows = await fetch_all(
        conn,
        """
        select s.*, r.rank
          from research.call_results r
          join research.sources s on s.id = r.source_id
         where r.call_id = %s
         order by r.rank
        """,
        (call_id,),
    )
    return [Source.model_validate(r) for r in rows]


async def spend_for_run(conn: Conn, run_id: UUID) -> int:
    """Total connector spend (micro-dollars) attributed to a run."""
    row = await fetch_one(
        conn,
        "select coalesce(sum(cost_usd_micros), 0) as total from research.calls where run_id = %s",
        (run_id,),
    )
    return int(row["total"]) if row else 0


# ---------------------------------------------------------------- sources
async def get_source(conn: Conn, source_id: UUID) -> Source | None:
    row = await fetch_one(conn, "select * from research.sources where id = %s", (source_id,))
    return Source.model_validate(row) if row else None


async def attach_content(
    conn: Conn,
    source_id: UUID,
    *,
    content: str,
    embedding: Sequence[float] | None = None,
    embedding_model: str | None = None,
) -> Source:
    """Store fetched full text (tinyfish#fetch / octen#extract) and optionally its embedding."""
    row = await require_one(
        conn,
        """
        update research.sources
           set content            = %s,
               content_hash       = %s,
               content_fetched_at = now(),
               embedding          = coalesce(%s::extensions.vector, embedding),
               embedding_model    = coalesce(%s, embedding_model)
         where id = %s
        returning *
        """,
        (content, content_hash(content), vector(embedding), embedding_model, source_id),
        what="source",
    )
    return Source.model_validate(row)


async def similar_sources(
    conn: Conn,
    embedding: Sequence[float],
    *,
    limit: int = 10,
    kind: str | None = None,
) -> list[Source]:
    rows = await fetch_all(
        conn,
        """
        select s.*, (s.embedding operator(extensions.<=>) %s::extensions.vector) as distance
          from research.sources s
         where s.embedding is not null and (%s::text is null or s.kind = %s)
         order by s.embedding operator(extensions.<=>) %s::extensions.vector
         limit %s
        """,
        (vector(embedding), kind, kind, vector(embedding), limit),
    )
    return [Source.model_validate(r) for r in rows]


# ---------------------------------------------------------------- typed extension: social posts
async def record_social_post(
    conn: Conn,
    *,
    source_id: UUID,
    platform: str,
    external_id: str,
    connector_slug: str | None = None,
    author_handle: str | None = None,
    author_followers: int | None = None,
    posted_at: datetime | None = None,
    caption: str | None = None,
    transcript: str | None = None,
    duration_seconds: int | None = None,
    views: int | None = None,
    likes: int | None = None,
    comments: int | None = None,
    shares: int | None = None,
    engagement_rate: float | None = None,
    hashtags: Sequence[str] | None = None,
    metrics: dict[str, Any] | None = None,
) -> SocialPost:
    row = await require_one(
        conn,
        """
        insert into research.social_posts
          (source_id, platform, external_id, connector_slug, author_handle, author_followers,
           posted_at, caption, transcript, duration_seconds, views, likes, comments, shares,
           engagement_rate, hashtags, metrics)
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (source_id) do update set
          author_handle    = coalesce(excluded.author_handle, research.social_posts.author_handle),
          author_followers = coalesce(excluded.author_followers, research.social_posts.author_followers),
          posted_at        = coalesce(excluded.posted_at, research.social_posts.posted_at),
          caption          = coalesce(excluded.caption, research.social_posts.caption),
          transcript       = coalesce(excluded.transcript, research.social_posts.transcript),
          duration_seconds = coalesce(excluded.duration_seconds, research.social_posts.duration_seconds),
          views            = coalesce(excluded.views, research.social_posts.views),
          likes            = coalesce(excluded.likes, research.social_posts.likes),
          comments         = coalesce(excluded.comments, research.social_posts.comments),
          shares           = coalesce(excluded.shares, research.social_posts.shares),
          engagement_rate  = coalesce(excluded.engagement_rate, research.social_posts.engagement_rate),
          hashtags         = coalesce(excluded.hashtags, research.social_posts.hashtags),
          metrics          = research.social_posts.metrics || excluded.metrics,
          connector_slug   = coalesce(excluded.connector_slug, research.social_posts.connector_slug),
          fetched_at       = now()
        returning *
        """,
        (
            source_id,
            platform,
            external_id,
            connector_slug,
            author_handle,
            author_followers,
            posted_at,
            caption,
            transcript,
            duration_seconds,
            views,
            likes,
            comments,
            shares,
            engagement_rate,
            list(hashtags) if hashtags is not None else None,
            jsonb(metrics or {}),
        ),
    )
    return SocialPost.model_validate(row)


async def top_social_posts(conn: Conn, platform: str, *, since: timedelta, limit: int = 20) -> list[SocialPost]:
    rows = await fetch_all(
        conn,
        """
        select * from research.social_posts
         where platform = %s and posted_at >= now() - %s
         order by views desc nulls last
         limit %s
        """,
        (platform, since, limit),
    )
    return [SocialPost.model_validate(r) for r in rows]


# ---------------------------------------------------------------- citations
async def cite_idea_sources(
    conn: Conn,
    *,
    idea_id: UUID,
    creator_id: UUID,
    source_ids: Sequence[UUID],
    note: str | None = None,
) -> int:
    count = 0
    async with conn.transaction():
        for source_id in source_ids:
            cur = await conn.execute(
                """
                insert into public.idea_sources (idea_id, source_id, creator_id, note)
                values (%s, %s, %s, %s) on conflict do nothing
                """,
                (idea_id, source_id, creator_id, note),
            )
            count += cur.rowcount
    return count


async def idea_citations(conn: Conn, idea_id: UUID) -> list[Source]:
    rows = await fetch_all(
        conn,
        """
        select s.* from public.idea_sources c
          join research.sources s on s.id = c.source_id
         where c.idea_id = %s
         order by s.published_at desc nulls last
        """,
        (idea_id,),
    )
    return [Source.model_validate(r) for r in rows]


async def prune_call_payloads(conn: Conn, *, retention: timedelta = timedelta(days=30)) -> int:
    row = await fetch_one(conn, "select research.prune_call_payloads(%s) as touched", (retention,))
    return int(row["touched"]) if row else 0


__all__ = [
    "attach_content",
    "canonical_url",
    "cite_idea_sources",
    "complete_call",
    "content_hash",
    "fail_call",
    "find_cached_call",
    "get_call",
    "get_source",
    "idea_citations",
    "list_call_sources",
    "list_connectors",
    "prune_call_payloads",
    "record_social_post",
    "register_connector",
    "similar_sources",
    "spend_for_run",
    "start_call",
    "top_social_posts",
    "upsert_source",
]
