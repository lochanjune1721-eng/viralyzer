"""Shared niche research cache (nightly cron writes, ideation reads)."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import timedelta
from decimal import Decimal
from typing import Any
from uuid import UUID

from viralyzer.db.models import NicheResearch, NicheResearchLatest
from viralyzer.db.pool import Conn
from viralyzer.db.repositories._common import fetch_all, fetch_one, jsonb, require_one

DEFAULT_MAX_AGE = timedelta(hours=24)


async def fresh_niche_research(
    conn: Conn,
    niche: str,
    *,
    max_age: timedelta = DEFAULT_MAX_AGE,
) -> NicheResearch | None:
    """Newest entry for the niche if it is younger than ``max_age`` (and its own TTL)."""
    row = await fetch_one(
        conn,
        """
        select * from public.niche_research
         where niche = %s
           and fetched_at >= now() - %s
           and fetched_at + make_interval(secs => ttl_seconds) > now()
         order by fetched_at desc
         limit 1
        """,
        (niche, max_age),
    )
    return NicheResearch.model_validate(row) if row else None


async def store_niche_research(
    conn: Conn,
    *,
    niche: str,
    payload: dict[str, Any],
    ttl_seconds: int = 86400,
    research_job_id: str | None = None,
    source_ids: Sequence[UUID] = (),
    tokens_in: int = 0,
    tokens_out: int = 0,
    cost_cents: Decimal | float | int = 0,
    payload_schema_version: int = 1,
) -> NicheResearch:
    async with conn.transaction():
        row = await require_one(
            conn,
            """
            insert into public.niche_research
              (niche, payload, payload_schema_version, ttl_seconds, research_job_id,
               tokens_in, tokens_out, cost_cents)
            values (%s, %s, %s, %s, %s, %s, %s, %s)
            returning *
            """,
            (
                niche,
                jsonb(payload),
                payload_schema_version,
                ttl_seconds,
                research_job_id,
                tokens_in,
                tokens_out,
                cost_cents,
            ),
        )
        entry = NicheResearch.model_validate(row)
        for source_id in source_ids:
            await conn.execute(
                """
                insert into public.niche_research_sources (niche_research_id, source_id)
                values (%s, %s) on conflict do nothing
                """,
                (entry.id, source_id),
            )
    return entry


async def latest_per_niche(conn: Conn) -> list[NicheResearchLatest]:
    rows = await fetch_all(conn, "select * from public.niche_research_latest order by niche")
    return [NicheResearchLatest.model_validate(r) for r in rows]


async def stale_active_niches(conn: Conn, *, max_age: timedelta = DEFAULT_MAX_AGE) -> list[str]:
    """Active niches with no fresh entry: the nightly cron's work list."""
    rows = await fetch_all(
        conn,
        """
        select n.key
          from public.niches n
          left join public.niche_research_latest l on l.niche = n.key
         where n.is_active
           and (l.id is null or l.fetched_at < now() - %s or not l.is_fresh)
         order by n.key
        """,
        (max_age,),
    )
    return [r["key"] for r in rows]


async def prune_niche_research(conn: Conn, *, retention: timedelta = timedelta(days=30)) -> int:
    row = await fetch_one(conn, "select public.prune_niche_research(%s) as deleted", (retention,))
    return int(row["deleted"]) if row else 0


__all__ = [
    "DEFAULT_MAX_AGE",
    "fresh_niche_research",
    "latest_per_niche",
    "prune_niche_research",
    "stale_active_niches",
    "store_niche_research",
]
