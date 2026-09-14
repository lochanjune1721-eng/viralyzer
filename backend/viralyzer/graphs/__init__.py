"""Graph dispatch table (portability rule).

Both graphs are compiled here and looked up by name by the worker:

    GRAPHS = {"ideation": ..., "scripting": ...}

The keys are also the allowed values of ``public.runs.graph`` (CHECK constraint
in ``supabase/migrations/20260914100300_runs.sql``). Add a graph = add the key
here *and* extend that CHECK in a migration; ``tests/test_migrations.py``
asserts the two stay in sync.

Nothing in this package may import ``langgraph_sdk`` or any platform-specific
assistant API.
"""

from __future__ import annotations

from typing import Any

GRAPH_NAMES: tuple[str, ...] = ("ideation", "scripting")

# Populated by the graph slices (build order steps 2 and 3).
GRAPHS: dict[str, Any] = {}

__all__ = ["GRAPHS", "GRAPH_NAMES"]
