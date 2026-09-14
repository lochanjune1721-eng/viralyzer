"""Scripts: append-only revisions with a single current head per idea."""

from __future__ import annotations

from typing import Any
from uuid import UUID

from viralyzer.db.errors import NotFound
from viralyzer.db.models import SCRIPT_BODY_SCHEMA_VERSION, Script, ScriptBody
from viralyzer.db.pool import Conn
from viralyzer.db.repositories._common import fetch_all, fetch_one, jsonb, require_one


async def append_script_version(
    conn: Conn,
    *,
    idea_id: UUID,
    creator_id: UUID,
    body: ScriptBody | dict[str, Any],
    revision_kind: str,
    run_id: UUID | None = None,
    parent_script_id: UUID | None = None,
    critique: Any | None = None,
    platform: str | None = None,
    target_seconds: int | None = None,
    aspect: str | None = None,
    status: str = "draft",
    prompt_version: str | None = None,
    model: str | None = None,
) -> Script:
    """Insert the next revision and make it current.

    Serialised per idea with ``select ... for update`` so two workers cannot
    mint the same version number; the trigger assigns version = max + 1 and
    retires the previous head. ``parent_script_id`` defaults to that head.
    """
    body_dict = body.model_dump(mode="json") if isinstance(body, ScriptBody) else body
    async with conn.transaction():
        locked = await fetch_one(conn, "select id from public.ideas where id = %s for update", (idea_id,))
        if locked is None:
            raise NotFound(f"idea {idea_id} not found")
        if parent_script_id is None:
            head = await fetch_one(conn, "select id from public.scripts where idea_id = %s and is_current", (idea_id,))
            parent_script_id = head["id"] if head else None
        row = await require_one(
            conn,
            """
            insert into public.scripts
              (idea_id, creator_id, run_id, version, parent_script_id, revision_kind, is_current,
               platform, target_seconds, aspect, body, body_schema_version, critique, status,
               prompt_version, model)
            values (%s, %s, %s, null, %s, %s, true, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            returning *
            """,
            (
                idea_id,
                creator_id,
                run_id,
                parent_script_id,
                revision_kind,
                platform,
                target_seconds,
                aspect,
                jsonb(body_dict),
                SCRIPT_BODY_SCHEMA_VERSION,
                jsonb(critique),
                status,
                prompt_version,
                model,
            ),
        )
    return Script.model_validate(row)


async def current_script(conn: Conn, idea_id: UUID) -> Script | None:
    row = await fetch_one(conn, "select * from public.script_heads where idea_id = %s", (idea_id,))
    return Script.model_validate(row) if row else None


async def get_script(conn: Conn, script_id: UUID, *, creator_id: UUID | None = None) -> Script | None:
    if creator_id is None:
        row = await fetch_one(conn, "select * from public.scripts where id = %s", (script_id,))
    else:
        row = await fetch_one(
            conn, "select * from public.scripts where id = %s and creator_id = %s", (script_id, creator_id)
        )
    return Script.model_validate(row) if row else None


async def list_script_versions(conn: Conn, idea_id: UUID) -> list[Script]:
    rows = await fetch_all(conn, "select * from public.scripts where idea_id = %s order by version", (idea_id,))
    return [Script.model_validate(r) for r in rows]


async def set_script_status(conn: Conn, script_id: UUID, status: str) -> Script:
    """Workflow statuses the graph sets itself (awaiting_approval, final).

    Creator decisions (approved / rejected / shipped) go through
    ``feedback.record_feedback`` so the ledger stays the source of truth.
    """
    row = await require_one(
        conn,
        "update public.scripts set status = %s where id = %s returning *",
        (status, script_id),
        what="script",
    )
    return Script.model_validate(row)


__all__ = [
    "append_script_version",
    "current_script",
    "get_script",
    "list_script_versions",
    "set_script_status",
]
