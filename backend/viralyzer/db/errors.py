"""Storage-layer exceptions. The API maps these to HTTP statuses."""

from __future__ import annotations

from uuid import UUID


class StorageError(Exception):
    """Base class for errors raised by the storage layer."""


class NotFound(StorageError):
    """A row the caller expected to exist does not (or is not visible to them)."""


class ActiveRunExists(StorageError):
    """The creator already has a run in ``queued`` or ``running`` state."""

    def __init__(self, creator_id: UUID, active_run_id: UUID | None = None) -> None:
        self.creator_id = creator_id
        self.active_run_id = active_run_id
        super().__init__(f"creator {creator_id} already has an active run ({active_run_id})")


class ThreadNotOwned(StorageError):
    """The thread_id does not belong to the caller (or does not exist -- same answer)."""


class IllegalTransition(StorageError):
    """A run status transition the database state machine rejects."""


class BudgetExceeded(StorageError):
    """The creator's plan budget for the current month is exhausted."""


class InvalidPublicId(StorageError, ValueError):
    """A public id has the wrong prefix or is not decodable."""
