"""Monid connector storage: calls, deduplicated sources, cache hits, typed extension."""

from __future__ import annotations

from datetime import timedelta

from viralyzer.db.models import Creator, IdeaDraft, SourceResult
from viralyzer.db.pool import Conn
from viralyzer.db.repositories import ideas, research, runs
from viralyzer.db.repositories.research import canonical_url


def test_canonical_url() -> None:
    assert (
        canonical_url("HTTPS://www.Example.com/post/?utm_source=x&b=2&a=1#frag")
        == "https://www.example.com/post?a=1&b=2"
    )
    assert canonical_url("http://example.com:80/") == "http://example.com/"
    assert canonical_url("https://x.com/a/b/") == "https://x.com/a/b"


async def test_call_lifecycle_dedupes_sources(conn: Conn, creator: Creator) -> None:
    run = await runs.create_run(conn, creator_id=creator.id, graph="ideation")
    params = {"query": "short form video hooks 2026", "num_results": 5}
    assert await research.find_cached_call(conn, "octen#search", params) is None

    call = await research.start_call(
        conn,
        connector_slug="octen#search",
        purpose="ideation",
        params=params,
        query=params["query"],
        run_id=run.id,
        creator_id=creator.id,
        niche="tech",
    )
    assert call.status == "pending" and len(call.params_hash) == 64

    results = [
        SourceResult(
            url="https://blog.example.com/hooks?utm_campaign=x", title="Hooks", snippet="s1", score=0.9, raw={"id": 1}
        ),
        SourceResult(url="https://news.example.org/trend", title="Trend", kind="news", score=0.8, content="full text"),
        SourceResult(url="https://blog.example.com/hooks", title=None, score=0.7),  # duplicate of #1
    ]
    call, sources = await research.complete_call(
        conn,
        call.id,
        results=results,
        usage={"calls": 1, "sub_queries": 3},
        cost_usd_micros=1200,
        raw_response={"ok": True},
        monid_run_id="mr_1",
        latency_ms=420,
    )
    assert call.status == "succeeded" and call.result_count == 3 and call.expires_at is not None
    assert len({s.id for s in sources}) == 2
    assert sources[0].id == sources[2].id and sources[2].seen_count == 2 and sources[2].title == "Hooks"
    assert sources[0].domain == "blog.example.com" and sources[0].url == "https://blog.example.com/hooks"
    assert sources[1].content == "full text" and sources[1].content_hash and sources[1].content_fetched_at

    linked = await research.list_call_sources(conn, call.id)
    assert [(s.rank, s.url) for s in linked] == [
        (1, "https://blog.example.com/hooks"),
        (2, "https://news.example.org/trend"),
    ]

    hit = await research.find_cached_call(
        conn, "octen#search", {"num_results": 5, "query": "short form video hooks 2026"}
    )
    assert hit is not None and hit.id == call.id  # key order does not matter (jsonb normalises)
    assert await research.find_cached_call(conn, "octen#search", {**params, "num_results": 6}) is None
    assert await research.find_cached_call(conn, "exa#search", params) is None
    assert await research.spend_for_run(conn, run.id) == 1200

    # now() is fixed inside a transaction, so age the call explicitly instead of using retention=0.
    await conn.execute("update research.calls set requested_at = now() - interval '31 days' where id = %s", (call.id,))
    touched = await research.prune_call_payloads(conn, retention=timedelta(days=30))
    assert touched == 1 and (await research.get_call(conn, call.id)).raw_response is None
    assert (await research.get_call(conn, call.id)).usage == {"calls": 1, "sub_queries": 3}  # metering survives


async def test_failed_call_and_plugin_extension_table(conn: Conn, creator: Creator) -> None:
    connector = await research.register_connector(
        conn,
        slug="tiktok-data#top-videos",
        kind="social",
        result_table="research.social_posts",
        pricing={"unit": "credits", "usd_per_unit": 0.01},
    )
    assert connector.provider == "tiktok-data" and connector.endpoint == "top-videos"

    failed = await research.start_call(
        conn, connector_slug=connector.slug, purpose="niche_research", params={"hashtag": "ai"}
    )
    failed = await research.fail_call(conn, failed.id, "upstream 502")
    assert failed.status == "failed" and failed.error == "upstream 502"
    assert await research.find_cached_call(conn, connector.slug, {"hashtag": "ai"}) is None

    call = await research.start_call(
        conn, connector_slug=connector.slug, purpose="niche_research", params={"hashtag": "ai"}, niche="tech"
    )
    call, [source] = await research.complete_call(
        conn,
        call.id,
        results=[
            SourceResult(url="https://www.tiktok.com/@ada/video/123", kind="social_post", title="AI agents explained")
        ],
    )
    post = await research.record_social_post(
        conn,
        source_id=source.id,
        platform="tiktok",
        external_id="123",
        connector_slug=connector.slug,
        author_handle="ada",
        views=120000,
        likes=9000,
        hashtags=["ai", "agents"],
        metrics={"saves": 300},
    )
    assert post.views == 120000 and post.metrics == {"saves": 300}
    again = await research.record_social_post(
        conn, source_id=source.id, platform="tiktok", external_id="123", views=125000, metrics={"plays": 1}
    )
    assert again.views == 125000 and again.metrics == {"saves": 300, "plays": 1} and again.author_handle == "ada"
    top = await research.top_social_posts(conn, "tiktok", since=timedelta(days=365))
    assert top == [] or top[0].source_id == source.id  # posted_at unknown -> excluded from "since" window


async def test_citations_from_ideas(conn: Conn, creator: Creator) -> None:
    run = await runs.create_run(conn, creator_id=creator.id, graph="ideation")
    call = await research.start_call(
        conn, connector_slug="exa#search", purpose="ideation", params={"q": "x"}, run_id=run.id
    )
    _, [s1, s2] = await research.complete_call(
        conn, call.id, results=[SourceResult(url="https://a.example/1"), SourceResult(url="https://b.example/2")]
    )
    [idea] = await ideas.persist_ideas(
        conn,
        run_id=run.id,
        creator_id=creator.id,
        drafts=[IdeaDraft(hook="h", angle="a", format="f", rationale="r", source_ids=[s1.id])],
    )
    assert (
        await research.cite_idea_sources(conn, idea_id=idea.id, creator_id=creator.id, source_ids=[s1.id, s2.id]) == 1
    )
    assert {s.id for s in await research.idea_citations(conn, idea.id)} == {s1.id, s2.id}
