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