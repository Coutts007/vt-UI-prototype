#!/bin/sh
# Lighthouse CI against the production build (frontend-spec 18, M16). Builds nothing: run
# `make build` first. Serves apps/web/dist with gzip and the shell for deep links, like Caddy.
# Uses the Chromium that Playwright installed when CHROME_PATH is not set.
set -eu
cd "$(dirname "$0")/.."
[ -f apps/web/dist/index.html ] || { echo "apps/web/dist is missing: run 'make build' first"; exit 1; }
if [ -z "${CHROME_PATH:-}" ]; then
  found=$(ls -d "${PLAYWRIGHT_BROWSERS_PATH:-$HOME/.cache/ms-playwright}"/chromium-*/chrome-linux*/chrome 2>/dev/null | tail -1 || true)
  [ -n "$found" ] && export CHROME_PATH="$found"
fi
rm -rf .lighthouseci
exec pnpm exec lhci autorun --config=lighthouserc.json
