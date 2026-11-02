#!/bin/sh
# Schemathesis against the API on compose (backend-spec 15.5 item 3, 17.1): no 500 responses,
# and every response matches the contract. Runs as nobody, a tailor and the admin, with demo data.
# Bounded by FUZZ_EXAMPLES per operation and FUZZ_SECONDS per role.
set -u
API=${VT_FUZZ_URL:-http://127.0.0.1:8012}/api/v1
EXAMPLES=${FUZZ_EXAMPLES:-20}
SECONDS_EACH=${FUZZ_SECONDS:-600}
token() {
  curl -fsS "$API/auth/login" -H 'content-type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"vt-demo-2026\"}" |
    uv run python -c 'import json,sys; print(json.load(sys.stdin)["access_token"])'
}
status=0
run() {
  role=$1
  shift
  echo "== schemathesis as $role"
  timeout "$SECONDS_EACH" uv run schemathesis run packages/contracts/openapi.yaml \
    --url "$API" --checks not_a_server_error,response_schema_conformance \
    --max-examples "$EXAMPLES" --phases examples,coverage,fuzzing --generation-deterministic \
    --generation-with-security-parameters false \
    --report junit --report-dir "test-results/fuzz-$role" "$@" || status=1
}
run anonymous
# Signing out or changing the password would end the session the run depends on.
KEEP="--exclude-path /auth/logout --exclude-path /me/password"
run tailor -H "Authorization: Bearer $(token wanjiru@vt.test)" $KEEP
run admin -H "Authorization: Bearer $(token admin@vt.test)" $KEEP
exit $status
