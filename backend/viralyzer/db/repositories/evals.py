"""Evaluation set: cases, eval runs and judge scores."""

from __future__ import annotations

from collections.abc import Sequence
from decimal import Decimal
from typing import Any
from uuid import UUID

from viralyzer.db.models import EvalCase, EvalRun, EvalScore
from viralyzer.db.pool import Conn
from viralyzer.db.repositories._common import fetch_all, jsonb, require_one


async def upsert_eval_case(
    conn: Conn,
    *,
    slug: str,
    creator_profile: dict[str, Any],
    idea: dict[str, Any],
    reference_script: dict[str, Any],
    notes: str | None = None,
    tags: Sequence[str] = (),
    is_active: bool = True,
) -> EvalCase:
    row = await require_one(
        conn,
        """
        insert into public.eval_cases
          (slug, creator_profile, idea, reference_script, notes, tags, is_active)
        values (%s, %s, %s, %s, %s, %s, %s)
        on conflict (slug) do update set
          creator_profile  = excluded.creator_profile,
          idea             = excluded.idea,
          reference_script = excluded.reference_script,
          notes            = excluded.notes,
          tags             = excluded.tags,
          is_active        = excluded.is_active
        returning *
        """,
        (slug, jsonb(creator_profile), jsonb(idea), jsonb(reference_script), notes, list(tags), is_active),
    )
    return EvalCase.model_validate(row)


async def list_eval_cases(conn: Conn, *, active_only: bool = True) -> list[EvalCase]:
    rows = await fetch_all(
        conn,
        "select * from public.eval_cases where (not %s or is_active) order by slug",
        (active_only,),
    )
    return [EvalCase.model_validate(r) for r in rows]


async def start_eval_run(
    conn: Conn,
    *,
    graph: str,
    prompt_version: str,
    judge_model: str,
    model_routing: dict[str, Any] | None = None,
    git_sha: str | None = None,
    langsmith_ref: str | None = None,
) -> EvalRun:
    row = await require_one(
        conn,
        """
        insert into public.eval_runs
          (graph, prompt_version, judge_model, model_routing, git_sha, langsmith_ref)
        values (%s, %s, %s, %s, %s, %s)
        returning *
        """,
        (graph, prompt_version, judge_model, jsonb(model_routing or {}), git_sha, langsmith_ref),
    )
    return EvalRun.model_validate(row)


async def record_eval_score(
    conn: Conn,
    *,
    eval_run_id: UUID,
    eval_case_id: UUID,
    candidate: dict[str, Any],
    hook_strength: float | Decimal | None,
    voice_match: float | Decimal | None,
    structure: float | Decimal | None,
    judge_rationale: str | None = None,
    judge_raw: Any | None = None,
    tokens_in: int = 0,
    tokens_out: int = 0,
    cost_cents: Decimal | float | int = 0,
) -> EvalScore:
    row = await require_one(
        conn,
        """
        insert into public.eval_scores
          (eval_run_id, eval_case_id, candidate, hook_strength, voice_match, structure,
           judge_rationale, judge_raw, tokens_in, tokens_out, cost_cents)
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        on conflict (eval_run_id, eval_case_id) do update set
          candidate       = excluded.candidate,
          hook_strength   = excluded.hook_strength,
          voice_match     = excluded.voice_match,
          structure       = excluded.structure,
          judge_rationale = excluded.judge_rationale,
          judge_raw       = excluded.judge_raw,
          tokens_in       = excluded.tokens_in,
          tokens_out      = excluded.tokens_out,
          cost_cents      = excluded.cost_cents
        returning *
        """,
        (
            eval_run_id,
            eval_case_id,
            jsonb(candidate),
            hook_strength,
            voice_match,
            structure,
            judge_rationale,
            jsonb(judge_raw),
            tokens_in,
            tokens_out,
            cost_cents,
        ),
    )
    return EvalScore.model_validate(row)


async def finish_eval_run(conn: Conn, eval_run_id: UUID) -> EvalRun:
    """Close the run and store the aggregate scores in ``summary``."""
    row = await require_one(
        conn,
        """
        update public.eval_runs r
           set finished_at = now(),
               summary = coalesce((
                 select jsonb_build_object(
                   'n',             count(*),
                   'hook_strength', round(avg(s.hook_strength), 2),
                   'voice_match',   round(avg(s.voice_match), 2),
                   'structure',     round(avg(s.structure), 2),
                   'cost_cents',    sum(s.cost_cents))
                   from public.eval_scores s
                  where s.eval_run_id = r.id), '{}'::jsonb)
         where r.id = %s
        returning *
        """,
        (eval_run_id,),
        what="eval run",
    )
    return EvalRun.model_validate(row)


async def list_eval_runs(conn: Conn, *, graph: str | None = None, limit: int = 20) -> list[EvalRun]:
    rows = await fetch_all(
        conn,
        """
        select * from public.eval_runs
         where (%s::text is null or graph = %s)
         order by started_at desc
         limit %s
        """,
        (graph, graph, limit),
    )
    return [EvalRun.model_validate(r) for r in rows]


__all__ = [
    "finish_eval_run",
    "list_eval_cases",
    "list_eval_runs",
    "record_eval_score",
    "start_eval_run",
    "upsert_eval_case",
]
