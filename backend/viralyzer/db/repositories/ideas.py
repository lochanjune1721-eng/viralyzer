"""Ideas: persisted by the worker when an ideation run completes."""

from __future__ import annotations

from collections.abc import Sequence
from uuid import UUID

from viralyzer.db.models import Idea, IdeaDraft
from viralyzer.db.pool import Conn
from viralyzer.db.repositories._common import fetch_all, fetch_one, require_one


async def persist_ideas(
    conn: Conn,
    *,
    run_id: UUID,
    creator_id: UUID,
    drafts: Sequence[IdeaDraft],
    prompt_version: str | None = None,
) -> list[Idea]:
    """Write the ranked list (rank = position, 1 = best) plus source citations, atomically."""
    out: list[Idea] = []
    async with conn.transaction():
        for rank, draft in enumerate(drafts, start=1):
            row = await require_one(
                conn,
                """
                insert into public.ideas
                  (creator_id, run_id, rank, hook, angle, format, rationale, score, prompt_version)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                returning *
                """,
                (
                    creator_id,
                    run_id,
                    rank,
                    draft.hook,
                    draft.angle,
                    draft.format,
                    draft.rationale,
                    draft.score,
                    prompt_version,
                ),
            )
            idea = Idea.model_validate(row)
            for source_id in draft.source_ids:
                await conn.execute(
                    """
                    insert into public.idea_sources (idea_id, source_id, creator_id)
                    values (%s, %s, %s)
                    on conflict do nothing
                    """,
                    (idea.id, source_id, creator_id),
                )
            out.append(idea)
    return out


async def get_idea(conn: Conn, idea_id: UUID, *, creator_id: UUID | None = None) -> Idea | None:
    if creator_id is None:
        row = await fetch_one(conn, "select * from public.ideas where id = %s", (idea_id,))
    else:
        row = await fetch_one(
            conn, "select * from public.ideas where id = %s and creator_id = %s", (idea_id, creator_id)
        )
    return Idea.model_validate(row) if row else None


async def list_ideas(
    conn: Conn,
    creator_id: UUID,
    *,
    status: str | None = None,
    run_id: UUID | None = None,
    limit: int = 50,
) -> list[Idea]:
    rows = await fetch_all(
        conn,
        """
        select * from public.ideas
         where creator_id = %s
           and (%s::text is null or status = %s)
           and (%s::uuid is null or run_id = %s)
         order by created_at desc, rank
         limit %s
        """,
        (creator_id, status, status, run_id, run_id, limit),
    )
    return [Idea.model_validate(r) for r in rows]


async def archive_idea(conn: Conn, idea_id: UUID) -> Idea:
    row = await require_one(
        conn,
        "update public.ideas set status = 'archived' where id = %s returning *",
        (idea_id,),
        what="idea",
    )
    return Idea.model_validate(row)


__all__ = ["archive_idea", "get_idea", "list_ideas", "persist_ideas"]
