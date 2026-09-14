from __future__ import annotations

from datetime import timedelta

from viralyzer.db.pool import Conn
from viralyzer.db.repositories import niche_research


async def test_freshness_window(conn: Conn) -> None:
    assert await niche_research.fresh_niche_research(conn, "tech") is None
    assert "tech" in await niche_research.stale_active_niches(conn)

    entry = await niche_research.store_niche_research(
        conn, niche="tech", payload={"trends": ["ai agents"]}, research_job_id="job-1", cost_cents=3
    )
    fresh = await niche_research.fresh_niche_research(conn, "tech")
    assert fresh is not None and fresh.id == entry.id and fresh.payload["trends"] == ["ai agents"]
    assert "tech" not in await niche_research.stale_active_niches(conn)

    await conn.execute(
        "update public.niche_research set fetched_at = now() - interval '25 hours' where id = %s", (entry.id,)
    )
    assert await niche_research.fresh_niche_research(conn, "tech") is None
    latest = {r.niche: r for r in await niche_research.latest_per_niche(conn)}
    assert latest["tech"].is_fresh is False
    assert "tech" in await niche_research.stale_active_niches(conn)


async def test_prune_keeps_newest_per_niche(conn: Conn) -> None:
    old = await niche_research.store_niche_research(conn, niche="fitness", payload={"v": 1})
    new = await niche_research.store_niche_research(conn, niche="fitness", payload={"v": 2})
    await conn.execute(
        "update public.niche_research set fetched_at = now() - interval '41 days' where id = %s", (old.id,)
    )
    await conn.execute(
        "update public.niche_research set fetched_at = now() - interval '40 days' where id = %s", (new.id,)
    )
    deleted = await niche_research.prune_niche_research(conn, retention=timedelta(days=30))
    assert deleted == 1
    latest = {r.niche: r for r in await niche_research.latest_per_niche(conn)}
    assert latest["fitness"].id == new.id
