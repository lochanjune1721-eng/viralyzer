"""``viralyzer-db`` console entry point: thin dispatch to the module CLIs."""

from __future__ import annotations

import sys

from viralyzer.db import checkpointer, migrate

USAGE = """usage: viralyzer-db <command> [args]

commands:
  migrate             apply supabase/migrations to a plain Postgres (local/tests)
  checkpointer setup  one-shot LangGraph checkpoint table setup (direct connection)
"""


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in {"-h", "--help"}:
        print(USAGE)
        return 0
    command, rest = argv[0], argv[1:]
    if command == "migrate":
        return migrate._cli(rest)
    if command == "checkpointer":
        return checkpointer._cli(rest)
    print(USAGE, file=sys.stderr)
    return 2


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
