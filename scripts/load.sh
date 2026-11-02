#!/bin/sh
# The backend-spec 16.4 load test on a stack limited to 2 vCPU and 4 GB (M12). Synthetic data only.
# Writes Locust's CSV files to test-results/load/ and prints the figures that matter.
set -eu
COMPOSE="docker compose -p vt-load -f deploy/docker-compose.yml -f deploy/docker-compose.e2e.yml -f deploy/docker-compose.load.yml"
export VT_E2E_API_PORT=8013 VT_E2E_HTTPS_PORT=8456
HOST=http://127.0.0.1:8013
OUT=test-results/load
SECONDS_EACH=${LOAD_SECONDS:-60}
LOCUST="uv run --with locust==2.32.4 locust -f tests/load/locustfile.py --headless --host $HOST --only-summary"
mkdir -p "$OUT"
$COMPOSE up -d --build --wait api
trap '$COMPOSE down -v >/dev/null 2>&1' EXIT
$COMPOSE exec -T api .venv/bin/vt seed demo
$COMPOSE exec -T api .venv/bin/vt seed volume --clients 5000 --filled 2000 --per-client 10
status=0
LOAD_SCENARIO=ingest LOAD_FIRST_EMPTY=2000 $LOCUST -u 20 -r 20 -t "${SECONDS_EACH}s" --csv "$OUT/ingest" || status=1
LOAD_SCENARIO=lists $LOCUST -u 10 -r 10 -t "${SECONDS_EACH}s" --csv "$OUT/lists" || status=1
LOAD_SCENARIO=mixed LOAD_FIRST_EMPTY=3500 $LOCUST -u 50 -r 10 -t "${SECONDS_EACH}s" --csv "$OUT/mixed" || status=1
uv run python scripts/load_report.py "$OUT" || status=1
exit $status
