"""Typed row models. One class per table (plus a few input/aggregate shapes).

Rows come back from psycopg as dicts (``row_factory=dict_row``) and are
validated into these models by the repositories. pgvector columns arrive as
text (``"[0.1,0.2,...]"``) and are parsed into ``list[float]``.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from viralyzer.db.ids import to_public_id

GraphName = Literal["ideation", "scripting"]
RunStatus = Literal["queued", "running", "awaiting_input", "complete", "failed", "cancelled"]
ACTIVE_RUN_STATUSES: tuple[RunStatus, ...] = ("queued", "running")
IdeaStatus = Literal["proposed", "picked", "dismissed", "scripted", "archived"]
ScriptStatus = Literal["draft", "awaiting_approval", "approved", "rejected", "final", "shipped"]
RevisionKind = Literal["draft", "critique_revision", "human_edit", "regenerate"]
VoiceSampleKind = Literal["existing_content", "shipped_script", "manual"]
VoiceSource = Literal["onboarding", "refinement", "manual"]
SubjectType = Literal["idea", "script", "voice_profile", "run"]
FeedbackEventName = Literal[
    "idea_picked",
    "idea_dismissed",
    "script_approved",
    "script_rejected",
    "script_edited",
    "script_shipped",
    "script_shipped_unedited",
    "run_rated",
    "voice_refined",
]
ResearchPurpose = Literal["niche_research", "ideation", "voice_profile", "creator_posts", "eval", "adhoc"]
CallStatus = Literal["pending", "succeeded", "failed"]
SourceKind = Literal["web", "video", "social_post", "news", "paper", "other"]
ConnectorKind = Literal["web_search", "fetch", "extract", "embedding", "social", "news", "company", "other"]


def parse_vector(value: Any) -> list[float] | None:
    if value is None:
        return None
    if isinstance(value, str):
        body = value.strip()[1:-1]
        return [float(x) for x in body.split(",") if x.strip()]
    return [float(x) for x in value]


class Row(BaseModel):
    model_config = ConfigDict(extra="ignore")


class _HasEmbedding(Row):
    embedding: list[float] | None = None
    embedding_model: str | None = None

    @field_validator("embedding", mode="before")
    @classmethod
    def _parse_embedding(cls, value: Any) -> list[float] | None:
        return parse_vector(value)


# ---------------------------------------------------------------- creators
class Creator(Row):
    id: UUID
    user_id: UUID
    display_name: str | None = None
    handle: str | None = None
    niche: str
    audience: str | None = None
    plan_key: str
    onboarding_status: Literal["pending", "profiling", "complete"]
    created_at: datetime
    updated_at: datetime

    @property
    def public_id(self) -> str:
        return to_public_id("creator", self.id)


class CreatorPlatform(Row):
    creator_id: UUID
    platform: str
    handle: str | None = None
    external_account_id: str | None = None
    followers: int | None = None
    is_primary: bool = False
    created_at: datetime
    updated_at: datetime


class CreatorPostDraft(BaseModel):
    """Input shape for ingesting a creator's own posts."""

    platform: str
    external_id: str
    url: str | None = None
    title: str | None = None
    caption: str | None = None
    transcript: str | None = None
    posted_at: datetime | None = None
    duration_seconds: int | None = None
    views: int | None = None
    likes: int | None = None
    comments: int | None = None
    shares: int | None = None
    metrics: dict[str, Any] = Field(default_factory=dict)
    engagement_rate: float | None = None
    is_top_performer: bool = False


class CreatorPost(Row):
    id: UUID
    creator_id: UUID
    platform: str
    external_id: str
    url: str | None = None
    title: str | None = None
    caption: str | None = None
    transcript: str | None = None
    posted_at: datetime | None = None
    duration_seconds: int | None = None
    views: int | None = None
    likes: int | None = None
    comments: int | None = None
    shares: int | None = None
    metrics: dict[str, Any]
    engagement_rate: float | None = None
    is_top_performer: bool
    ingested_via: str | None = None
    fetched_at: datetime
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------- voice
class VoiceProfile(_HasEmbedding):
    creator_id: UUID
    version: int
    status: Literal["pending", "ready", "failed"]
    tone_rules: dict[str, Any]
    summary: str | None = None
    source: VoiceSource
    change_reason: str | None = None
    refined_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class VoiceProfileVersion(_HasEmbedding):
    id: UUID
    creator_id: UUID
    version: int
    tone_rules: dict[str, Any]
    summary: str | None = None
    source: str
    reason: str | None = None
    created_at: datetime


class VoiceSample(_HasEmbedding):
    id: UUID
    creator_id: UUID
    kind: VoiceSampleKind
    title: str | None = None
    body: str
    platform: str | None = None
    source_post_id: UUID | None = None
    source_script_id: UUID | None = None
    performance: dict[str, Any]
    weight: float
    created_at: datetime
    distance: float | None = None  # only set by similarity queries


class VoiceContext(BaseModel):
    """What both graphs receive: the profile plus the most relevant samples."""

    profile: VoiceProfile
    samples: list[VoiceSample]


# ---------------------------------------------------------------- runs
class Run(Row):
    id: UUID
    creator_id: UUID
    graph: GraphName
    thread_id: UUID
    status: RunStatus
    input: dict[str, Any]
    interrupt: Any | None = None
    resume_payload: Any | None = None
    resume_count: int
    attempt: int
    error: str | None = None
    error_code: str | None = None
    tokens_in: int
    tokens_out: int
    cost_cents: Decimal
    prompt_version: str | None = None
    idempotency_key: str | None = None
    worker_id: str | None = None
    trace_id: str | None = None
    idea_id: UUID | None = None
    queued_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    updated_at: datetime

    @property
    def public_id(self) -> str:
        return to_public_id("run", self.id)

    @property
    def public_thread_id(self) -> str:
        return to_public_id("thread", self.thread_id)

    @property
    def is_active(self) -> bool:
        return self.status in ACTIVE_RUN_STATUSES


class RunUsage(Row):
    id: int
    run_id: UUID
    creator_id: UUID
    node: str
    model: str
    provider: str | None = None
    tokens_in: int
    tokens_out: int
    cached_tokens: int
    cost_cents: Decimal
    latency_ms: int | None = None
    recorded_at: datetime


# ---------------------------------------------------------------- ideas
class IdeaDraft(BaseModel):
    """What the ideation graph produces per idea, before persistence."""

    hook: str = Field(min_length=1, max_length=500)
    angle: str
    format: str
    rationale: str
    score: float | None = None
    source_ids: list[UUID] = Field(default_factory=list)


class Idea(Row):
    id: UUID
    creator_id: UUID
    run_id: UUID | None = None
    rank: int | None = None
    hook: str
    angle: str
    format: str
    rationale: str
    score: Decimal | None = None
    status: IdeaStatus
    picked_at: datetime | None = None
    dismissed_at: datetime | None = None
    prompt_version: str | None = None
    created_at: datetime
    updated_at: datetime

    @property
    def public_id(self) -> str:
        return to_public_id("idea", self.id)


# ---------------------------------------------------------------- scripts
class ScriptBeat(BaseModel):
    label: str | None = None
    text: str
    seconds: float | None = None


class BrollNote(BaseModel):
    beat_index: int | None = None
    note: str
    timing_seconds: float | None = None


class ScriptBody(BaseModel):
    """``scripts.body`` for body_schema_version = 1."""

    hook: str
    beats: list[ScriptBeat]
    broll: list[BrollNote] = Field(default_factory=list)
    cta: str
    meta: dict[str, Any] = Field(default_factory=dict)


SCRIPT_BODY_SCHEMA_VERSION = 1


class Script(Row):
    id: UUID
    idea_id: UUID
    creator_id: UUID
    run_id: UUID | None = None
    version: int
    parent_script_id: UUID | None = None
    revision_kind: RevisionKind
    is_current: bool
    platform: str | None = None
    target_seconds: int | None = None
    aspect: str | None = None
    body: dict[str, Any]
    body_schema_version: int
    critique: Any | None = None
    status: ScriptStatus
    approved_at: datetime | None = None
    shipped_at: datetime | None = None
    shipped_unedited: bool | None = None
    prompt_version: str | None = None
    model: str | None = None
    created_at: datetime
    updated_at: datetime

    @property
    def public_id(self) -> str:
        return to_public_id("script", self.id)

    def parsed_body(self) -> ScriptBody:
        if self.body_schema_version != SCRIPT_BODY_SCHEMA_VERSION:
            raise ValueError(f"unsupported body_schema_version {self.body_schema_version}")
        return ScriptBody.model_validate(self.body)


# ---------------------------------------------------------------- niche research
class NicheResearch(Row):
    id: UUID
    niche: str
    payload: dict[str, Any]
    payload_schema_version: int
    fetched_at: datetime
    ttl_seconds: int
    research_job_id: str | None = None
    tokens_in: int
    tokens_out: int
    cost_cents: Decimal
    created_at: datetime


class NicheResearchLatest(NicheResearch):
    is_fresh: bool


# ---------------------------------------------------------------- research (Monid)
class Connector(Row):
    slug: str
    provider: str
    endpoint: str
    kind: ConnectorKind
    result_table: str | None = None
    result_schema_version: int
    pricing: dict[str, Any]
    default_params: dict[str, Any]
    is_enabled: bool
    created_at: datetime
    updated_at: datetime


class ResearchCall(Row):
    id: UUID
    connector_slug: str
    monid_run_id: str | None = None
    purpose: ResearchPurpose
    run_id: UUID | None = None
    creator_id: UUID | None = None
    niche: str | None = None
    query: str | None = None
    params: dict[str, Any]
    params_hash: str
    status: CallStatus
    error: str | None = None
    usage: dict[str, Any]
    cost_usd_micros: int | None = None
    result_count: int | None = None
    raw_response: Any | None = None
    latency_ms: int | None = None
    requested_at: datetime
    completed_at: datetime | None = None
    expires_at: datetime | None = None


class SourceResult(BaseModel):
    """One result item from a connector, normalised by the caller."""

    url: str
    title: str | None = None
    snippet: str | None = None
    score: float | None = None
    published_at: datetime | None = None
    author: str | None = None
    kind: SourceKind = "web"
    language: str | None = None
    content: str | None = None
    highlights: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
    raw: dict[str, Any] = Field(default_factory=dict)


class Source(_HasEmbedding):
    id: UUID
    url: str
    url_hash: str
    domain: str
    kind: SourceKind
    title: str | None = None
    author: str | None = None
    published_at: datetime | None = None
    language: str | None = None
    snippet: str | None = None
    content: str | None = None
    content_hash: str | None = None
    content_fetched_at: datetime | None = None
    metadata: dict[str, Any]
    first_seen_at: datetime
    last_seen_at: datetime
    seen_count: int
    rank: int | None = None  # set when listed for a call
    distance: float | None = None  # set by similarity queries


class SocialPost(Row):
    source_id: UUID
    platform: str
    external_id: str
    author_handle: str | None = None
    author_followers: int | None = None
    posted_at: datetime | None = None
    caption: str | None = None
    transcript: str | None = None
    duration_seconds: int | None = None
    views: int | None = None
    likes: int | None = None
    comments: int | None = None
    shares: int | None = None
    engagement_rate: float | None = None
    hashtags: list[str] | None = None
    metrics: dict[str, Any]
    connector_slug: str | None = None
    fetched_at: datetime


# ---------------------------------------------------------------- feedback / evals
class FeedbackEvent(Row):
    id: int
    creator_id: UUID
    subject_type: SubjectType
    subject_id: UUID
    event: FeedbackEventName
    payload: dict[str, Any]
    occurred_at: datetime
    recorded_by: str


class EvalCase(Row):
    id: UUID
    slug: str
    creator_profile: dict[str, Any]
    idea: dict[str, Any]
    reference_script: dict[str, Any]
    notes: str | None = None
    tags: list[str]
    is_active: bool
    created_at: datetime
    updated_at: datetime


class EvalRun(Row):
    id: UUID
    graph: GraphName
    prompt_version: str
    model_routing: dict[str, Any]
    judge_model: str
    git_sha: str | None = None
    langsmith_ref: str | None = None
    started_at: datetime
    finished_at: datetime | None = None
    summary: dict[str, Any]


class EvalScore(Row):
    eval_run_id: UUID
    eval_case_id: UUID
    candidate: dict[str, Any]
    hook_strength: Decimal | None = None
    voice_match: Decimal | None = None
    structure: Decimal | None = None
    judge_rationale: str | None = None
    judge_raw: Any | None = None
    tokens_in: int
    tokens_out: int
    cost_cents: Decimal
    created_at: datetime
