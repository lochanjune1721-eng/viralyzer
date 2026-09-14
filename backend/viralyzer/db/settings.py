"""Database connection settings.

Three URLs, three jobs (brief section 3, *Connection configuration*):

* ``SUPABASE_DB_URL``         session pooler, port 5432. API, worker, checkpointer.
* ``SUPABASE_DB_DIRECT_URL``  direct connection. Migrations, ``pg_dump`` and the
                              one-shot ``checkpointer setup`` only.
* port 6543 (Supavisor transaction mode) is refused outright: it does not
  support prepared statements and psycopg raises
  ``DuplicatePreparedStatement: prepared statement "_pg3_0" already exists``.
"""

from __future__ import annotations

from urllib.parse import urlparse

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

TRANSACTION_POOLER_PORT = 6543
SESSION_POOLER_PORT = 5432


def assert_not_transaction_pooler(url: str) -> str:
    """Raise if ``url`` points at Supavisor transaction mode (port 6543)."""
    parsed = urlparse(url)
    if parsed.port == TRANSACTION_POOLER_PORT:
        raise ValueError(
            "SUPABASE_DB_URL points at the transaction-mode pooler (port 6543). "
            "Use the session pooler on port 5432: transaction mode does not support "
            "prepared statements and SET search_path, both of which this service needs."
        )
    return url


class DatabaseSettings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    database_url: SecretStr = Field(alias="SUPABASE_DB_URL")
    direct_database_url: SecretStr | None = Field(default=None, alias="SUPABASE_DB_DIRECT_URL")
    pool_min_size: int = Field(default=1, alias="DB_POOL_MIN_SIZE", ge=0)
    pool_max_size: int = Field(default=10, alias="DB_POOL_MAX_SIZE", ge=1)
    langgraph_schema: str = Field(default="langgraph", alias="LANGGRAPH_SCHEMA")
    embedding_dimensions: int = Field(default=1536, alias="EMBEDDING_DIMENSIONS", ge=1)

    @field_validator("database_url")
    @classmethod
    def _runtime_url_must_be_session_pooler(cls, value: SecretStr) -> SecretStr:
        assert_not_transaction_pooler(value.get_secret_value())
        return value

    @property
    def runtime_url(self) -> str:
        """Session-pooler URL for the API, worker and checkpointer."""
        return self.database_url.get_secret_value()

    @property
    def admin_url(self) -> str:
        """Direct URL for migrations / setup; falls back to the runtime URL with a warning."""
        if self.direct_database_url is not None:
            return self.direct_database_url.get_secret_value()
        import warnings

        warnings.warn(
            "SUPABASE_DB_DIRECT_URL is not set; using the pooler URL for an admin task. "
            "Prefer the direct connection for migrations and checkpointer setup.",
            stacklevel=2,
        )
        return self.runtime_url


__all__ = [
    "SESSION_POOLER_PORT",
    "TRANSACTION_POOLER_PORT",
    "DatabaseSettings",
    "assert_not_transaction_pooler",
]
