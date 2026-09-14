"""Storage and retrieval layer.

* ``settings``      -- connection configuration (session pooler vs direct URL)
* ``pool``          -- psycopg async pools with the mandated connection kwargs
* ``checkpointer``  -- LangGraph ``AsyncPostgresSaver`` bound to the ``langgraph`` schema
* ``ids``           -- Stripe-style prefixed public ids over UUIDv7 primary keys
* ``models``        -- typed row models (pydantic)
* ``repositories``  -- one module per aggregate; plain async functions over a connection
* ``migrate``       -- apply ``supabase/migrations`` to a plain Postgres (tests, local dev)
"""

from viralyzer.db.errors import (
    ActiveRunExists,
    BudgetExceeded,
    IllegalTransition,
    InvalidPublicId,
    NotFound,
    StorageError,
    ThreadNotOwned,
)
from viralyzer.db.pool import CONNECTION_KWARGS, connect, create_pool
from viralyzer.db.settings import DatabaseSettings

__all__ = [
    "CONNECTION_KWARGS",
    "ActiveRunExists",
    "BudgetExceeded",
    "DatabaseSettings",
    "IllegalTransition",
    "InvalidPublicId",
    "NotFound",
    "StorageError",
    "ThreadNotOwned",
    "connect",
    "create_pool",
]
