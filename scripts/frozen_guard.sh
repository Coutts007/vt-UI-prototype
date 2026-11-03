#!/bin/sh
# CI check (backend-spec 11.7, M13): no file under packages/rules/frozen/ may be changed, renamed
# or removed once it is on main. New files are allowed. Usage: sh scripts/frozen_guard.sh [base]
set -e
base=${1:-}
if [ -z "$base" ]; then
  if git rev-parse --verify -q origin/main >/dev/null; then
    base=$(git merge-base origin/main HEAD)
    # On main itself, compare with the previous commit.
    if [ "$base" = "$(git rev-parse HEAD)" ]; then
      base=$(git rev-parse HEAD~1 2>/dev/null || git rev-parse HEAD)
    fi
  else
    base=$(git rev-parse HEAD~1 2>/dev/null || git rev-parse HEAD)
  fi
fi
changed=$(git diff --name-status "$base" HEAD -- packages/rules/frozen/ | grep -E '^[MDRT]' || true)
if [ -n "$changed" ]; then
  echo "Refused: a frozen rules artifact changed since $base. Frozen files are immutable." >&2
  echo "$changed" >&2
  exit 1
fi
echo "frozen rules unchanged since $base"
