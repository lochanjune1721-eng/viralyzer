.PHONY: install lint format test db-up db-down db-migrate-local checkpointer-setup

VENV ?= .venv
PY   := $(VENV)/bin/python

install:
	uv venv $(VENV) --python 3.11 || python3 -m venv $(VENV)
	uv pip install --python $(PY) -e ".[dev]" || $(PY) -m pip install -e ".[dev]"

lint:
	$(VENV)/bin/ruff check viralyzer tests
	$(VENV)/bin/ruff format --check viralyzer tests

format:
	$(VENV)/bin/ruff check --fix viralyzer tests
	$(VENV)/bin/ruff format viralyzer tests

# Local Postgres 17 + pgvector for migrations and tests.
db-up:
	docker compose -f docker-compose.db.yml up -d --wait

db-down:
	docker compose -f docker-compose.db.yml down -v

# Apply the migrations to the local container (plain Postgres, so the Supabase stub goes first).
db-migrate-local:
	$(PY) -m viralyzer.db.migrate --url postgresql://postgres:postgres@localhost:54322/postgres --with-supabase-stub

# One-shot LangGraph checkpoint tables (uses SUPABASE_DB_DIRECT_URL).
checkpointer-setup:
	$(PY) -m viralyzer.db.checkpointer setup

test:
	TEST_DATABASE_URL=$${TEST_DATABASE_URL:-postgresql://postgres:postgres@localhost:54322/postgres} $(PY) -m pytest -q
