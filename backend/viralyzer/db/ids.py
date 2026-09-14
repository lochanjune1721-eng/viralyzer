"""Prefixed public identifiers over UUIDv7 primary keys.

Stripe's argument for ``cus_``/``pi_`` ids is that a bare id should tell a
human (and a log grep) what it is. We keep UUIDv7 as the storage key (compact,
index-friendly, time-ordered) and render it for the API as
``<prefix>_<26 chars of Crockford base32>``. Because the encoding is fixed
width and big-endian, public ids sort in creation order, like the keys.
"""

from __future__ import annotations

from uuid import UUID

from viralyzer.db.errors import InvalidPublicId

PREFIXES: dict[str, str] = {
    "creator": "cr",
    "run": "run",
    "thread": "thr",
    "idea": "idea",
    "script": "scr",
    "voice_profile": "vp",
    "voice_sample": "vs",
    "creator_post": "post",
    "niche_research": "nr",
    "source": "src",
    "research_call": "call",
    "eval_case": "ev",
    "eval_run": "evr",
}
_KIND_BY_PREFIX = {prefix: kind for kind, prefix in PREFIXES.items()}

_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"  # Crockford base32, lower case
_DECODE = {c: i for i, c in enumerate(_ALPHABET)}
_DECODE.update({"o": 0, "i": 1, "l": 1})  # Crockford's forgiving aliases
_ENCODED_LEN = 26  # ceil(128 / 5)


def encode_uuid(value: UUID) -> str:
    n = value.int
    out = []
    for _ in range(_ENCODED_LEN):
        out.append(_ALPHABET[n & 0x1F])
        n >>= 5
    return "".join(reversed(out))


def decode_uuid(text: str) -> UUID:
    if len(text) != _ENCODED_LEN:
        raise InvalidPublicId(f"expected {_ENCODED_LEN} characters, got {len(text)}")
    n = 0
    for ch in text.lower():
        try:
            n = (n << 5) | _DECODE[ch]
        except KeyError:
            raise InvalidPublicId(f"invalid character {ch!r}") from None
    if n >> 128:
        raise InvalidPublicId("value does not fit in 128 bits")
    return UUID(int=n)


def to_public_id(kind: str, value: UUID) -> str:
    try:
        prefix = PREFIXES[kind]
    except KeyError:
        raise InvalidPublicId(f"unknown id kind {kind!r}") from None
    return f"{prefix}_{encode_uuid(value)}"


def parse_public_id(public_id: str, expected_kind: str | None = None) -> tuple[str, UUID]:
    prefix, sep, body = public_id.partition("_")
    if not sep or prefix not in _KIND_BY_PREFIX:
        raise InvalidPublicId(f"unrecognised id {public_id!r}")
    kind = _KIND_BY_PREFIX[prefix]
    if expected_kind is not None and kind != expected_kind:
        raise InvalidPublicId(f"expected a {expected_kind} id, got a {kind} id")
    return kind, decode_uuid(body)


__all__ = ["PREFIXES", "decode_uuid", "encode_uuid", "parse_public_id", "to_public_id"]
