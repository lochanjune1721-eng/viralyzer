"""Repositories: plain async functions over a psycopg connection.

Every function takes the connection first so the caller controls transaction
boundaries and pool usage. Functions that must be atomic open their own
``conn.transaction()`` (a savepoint when the caller already has one).
"""

from viralyzer.db.repositories import (
    creators,
    evals,
    feedback,
    ideas,
    niche_research,
    research,
    runs,
    scripts,
    voice,
)

__all__ = [
    "creators",
    "evals",
    "feedback",
    "ideas",
    "niche_research",
    "research",
    "runs",
    "scripts",
    "voice",
]
