build:
	docker-compose up --build -d

start: 
	docker-compose start

stop:
	docker-compose stop

clean:
	docker-compose down --rmi all -v

install_uv:
	curl -LsSf https://astral.sh/uv/install.sh | sh

uv_init:
	cd backend && uv venv

uv_sync:
	cd backend && uv sync

uv_update:
	cd backend && uv lock --upgrade

# Empty all collections (delete_many, never drop) and reload the JSON fixtures.
seed:
	cd backend && uv run python scripts/seed_db.py --reset

# Same as `seed` but skips the confirmation prompt (CI / non-interactive).
seed-yes:
	cd backend && uv run python scripts/seed_db.py --reset --yes

# Empty all collections without reloading anything.
wipe:
	cd backend && uv run python scripts/seed_db.py --wipe-only

# Print every index on the demo collections; diff before/after a seed.
check-indexes:
	cd backend && uv run python scripts/check_indexes.py

# Run the FastAPI backend locally with reload.
run-backend:
	cd backend && uv run uvicorn main:app --reload --port 8000

run-frontend:
	cd frontend && npm run dev

# Phase 2 acceptance checks. Mutates data — reseed afterwards.
verify-phase2:
	cd backend && uv run python scripts/verify_phase2.py

# Phase 1 fraud-intelligence tool checks. Read-only; no reseed needed.
verify-phase1-tools:
	cd backend && uv run python scripts/verify_phase1_tools.py

# Same, printing every response payload.
verify-phase1-tools-verbose:
	cd backend && uv run python scripts/verify_phase1_tools.py --verbose

# Relationship-graph layout checks: determinism, bounds, no overlapping nodes.
# Needs the backend running on :8000.
verify-graph-layout:
	cd frontend && node scripts/check-force-layout.mjs

# Give already-decided claims a fraud.processedAt so turnaround can be measured.
backfill-processed-at:
	cd backend && uv run python scripts/backfill_processed_at.py

# Regenerate every pattern's whyEffective blurb from its current stats.
regen-why-effective:
	cd backend && uv run python -c "\
from dotenv import load_dotenv; load_dotenv(); \
from core.db import create_connector; \
from repositories.patterns_repo import PatternsRepository; \
from repositories.claims_repo import ClaimsRepository; \
from services.patterns_service import PatternsService; \
c = create_connector(); \
s = PatternsService(PatternsRepository(c), ClaimsRepository(c)); \
print(s.regenerate_why_effective()['message']); \
c.client.close()"