from __future__ import annotations

from uuid import UUID, uuid4

import pytest

from viralyzer.db.errors import InvalidPublicId
from viralyzer.db.ids import decode_uuid, encode_uuid, parse_public_id, to_public_id
from viralyzer.db.settings import DatabaseSettings


def test_roundtrip_and_prefix() -> None:
    value = uuid4()
    public = to_public_id("run", value)
    assert public.startswith("run_") and len(public) == 4 + 26
    assert parse_public_id(public) == ("run", value)
    assert parse_public_id(public, expected_kind="run")[1] == value


def test_encoding_preserves_uuid_order() -> None:
    a = UUID("01a09f61-e46a-762c-819c-447343efbc21")
    b = UUID("01a09f61-e46a-7b34-85aa-4b5fde235fe2")
    assert a < b
    assert encode_uuid(a) < encode_uuid(b)
    assert decode_uuid(encode_uuid(a)) == a


def test_wrong_kind_or_garbage_is_rejected() -> None:
    public = to_public_id("idea", uuid4())
    with pytest.raises(InvalidPublicId):
        parse_public_id(public, expected_kind="script")
    with pytest.raises(InvalidPublicId):
        parse_public_id("nope_123")
    with pytest.raises(InvalidPublicId):
        parse_public_id("idea_" + "u" * 26)
    with pytest.raises(InvalidPublicId):
        to_public_id("unknown_kind", uuid4())


def test_settings_reject_transaction_pooler() -> None:
    with pytest.raises(ValueError, match="6543"):
        DatabaseSettings(SUPABASE_DB_URL="postgresql://u:p@host:6543/postgres", _env_file=None)
    ok = DatabaseSettings(SUPABASE_DB_URL="postgresql://u:p@host:5432/postgres", _env_file=None)
    assert ok.runtime_url.endswith(":5432/postgres")
    assert ok.langgraph_schema == "langgraph"
