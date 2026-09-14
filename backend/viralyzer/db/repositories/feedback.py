"""Product feedback ledger. Append only; derived statuses follow by trigger."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from viralyzer.db.models import FeedbackEvent, Script
from viralyzer.db.pool import Conn
from viralyzer.db.repositories._common import fetch_all, jsonb, require_one


async def record_feedback(
    conn: Conn,
    *,
    creator_id: UUID,
    subject_type: str,
    subject_id: UUID,
    event: str,
    payload: dict[str, Any] | None = None,
    recorded_by: str = "api",
    occurred_at: datetime | None = None,
) -> FeedbackEvent:
    row = await require_one(
        conn,
        """
        insert into public.feedback_events
          (creator_id, subject_type, subject_id, event, payload, recorded_by, occurred_at)
        values (%s, %s, %s, %s, %s, %s, coalesce(%s, now()))
        returning *
        """,
        (creator_id, subject_type, subject_id, event, jsonb(payload or {}), recorded_by, occurred_at),
    )
    return FeedbackEvent.model_validate(row)


async def list_feedback(
    conn: Conn,
    creator_id: UUID,
    *,
    events: Sequence[str] | None = None,
    since: timedelta | None = None,
    limit: int = 200,
) -> list[FeedbackEvent]:
    rows = await fetch_all(
        conn,
        """
        select * from public.feedback_events
         where creator_id = %s
           and (%s::text[] is null or event = any(%s::text[]))
           and (%s::interval is null or occurred_at >= now() - %s::interval)
         order by occurred_at desc, id desc
         limit %s
        """,
        (creator_id, list(events) if events else None, list(events) if events else None, since, since, limit),
    )
    return [FeedbackEvent.model_validate(r) for r in rows]


async def shipped_unedited_scripts(
    conn: Conn,
    creator_id: UUID,
    *,
    since: timedelta | None = None,
    limit: int = 20,
) -> list[Script]:
    """The strongest voice signal: scripts the creator shipped without touching."""
    rows = await fetch_all(
        conn,
        """
        select * from public.scripts
         where creator_id = %s
           and status = 'shipped' and shipped_unedited
           and (%s::interval is null or shipped_at >= now() - %s::interval)
         order by shipped_at desc
         limit %s
        """,
        (creator_id, since, since, limit),
    )
    return [Script.model_validate(r) for r in rows]


__all__ = ["list_feedback", "record_feedback", "shipped_unedited_scripts"]
