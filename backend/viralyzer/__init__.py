"""Viralyzer backend: ideation + scripting service.

This package currently ships the storage slice only: Postgres schema
(``supabase/migrations``), connection configuration, the LangGraph checkpointer
factory and typed repositories for every product table.
"""

__all__ = ["__version__"]
__version__ = "0.1.0"
