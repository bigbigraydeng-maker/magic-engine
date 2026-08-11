#!/usr/bin/env bash
#
# Mutation check for src/lib/flywheel/phase-coverage.ts.
#
# A test that only asserts "the set contains what I put in the table" passes
# whether or not the loader pages, because the fake happily returns everything
# asked for. So break each guard on purpose and confirm the suite goes red.
# If a mutation stays green, that guard has no coverage — which is exactly the
# state the fix is meant to leave behind, not repeat.
#
# Usage: bash scripts/verify-phase-coverage-paging.sh
# Exits non-zero if any mutation survives.

set -uo pipefail
cd "$(dirname "$0")/.."

SRC=src/lib/flywheel/phase-coverage.ts
TEST=src/lib/flywheel/__tests__/phase-coverage.test.ts
BACKUP=$(mktemp)
cp "$SRC" "$BACKUP"
trap 'cp "$BACKUP" "$SRC"; rm -f "$BACKUP"' EXIT

survivors=0

# $1 = description, $2… = perl -pe expressions applied to the source
mutate() {
  local desc=$1; shift
  cp "$BACKUP" "$SRC"
  for expr in "$@"; do perl -0777 -pi -e "$expr" "$SRC"; done

  if ! diff -q "$BACKUP" "$SRC" >/dev/null; then
    if npx vitest run "$TEST" >/dev/null 2>&1; then
      echo "  SURVIVED (no coverage): $desc"
      survivors=$((survivors + 1))
    else
      echo "  killed: $desc"
    fi
  else
    echo "  ERROR: mutation was a no-op, the pattern no longer matches: $desc"
    survivors=$((survivors + 1))
  fi
}

echo "mutating $SRC ..."

# Guard 1 — paging. Back to one capped request, the bug as it shipped.
mutate "Diagnose: fetchAll -> a single .range(0, 999)" \
  's/const rows = await fetchAll<\{ client_id: string \}>\(\(from, to\) =>\n(.*?)\.range\(from, to\),\n  \)/const { data: rows } = await (\n$1.range(0, 999)\n  )/s'

mutate "Execute: fetchAll -> a single .range(0, 999)" \
  's/const rows = await fetchAll<\{ client_id: string; status: string \}>\(\(from, to\) =>\n(.*?)\.range\(from, to\),\n  \)/const { data: rows } = await (\n$1.range(0, 999)\n  )/s'

# Guard 2 — stable sort. Paging without it repeats or drops rows at boundaries,
# and no row-count assertion would ever notice.
mutate "Diagnose: drop the .order('id') that makes paging stable" \
  "s/\.from\('prescriptions'\)\n      \.select\('client_id'\)\n(?:      \/\/[^\n]*\n)*      \.order\('id', \{ ascending: true \}\)\n/.from('prescriptions')\n      .select('client_id')\n/s"

mutate "Execute: drop the .order('id') that makes paging stable" \
  "s/\.from\('execution_items'\)\n      \.select\('client_id, status'\)\n      \.order\('id', \{ ascending: true \}\)\n/.from('execution_items')\n      .select('client_id, status')\n/s"

# Guard 3 — the table being read. The fake returns [] for a table it has no
# rows for, so a loader pointed at the wrong table would look like an empty one.
mutate "Diagnose: read the wrong table" \
  "s/\.from\('prescriptions'\)/.from('prescriptions_typo')/"

mutate "Execute: read the wrong table" \
  "s/\.from\('execution_items'\)/.from('execution_items_typo')/"

# Guard 4 — the status split. Its own gate, and one the paging tests would
# otherwise shadow entirely.
mutate "Execute: treat every status as finished work" \
  "s/row\.status === 'completed'/true/"

mutate "Execute: count superseded/skipped items as queued work" \
  "s/row\.status === 'pending' \|\| row\.status === 'in_progress'/true/"

echo
if [ "$survivors" -ne 0 ]; then
  echo "FAIL: $survivors mutation(s) survived — those guards are untested."
  exit 1
fi
echo "PASS: every mutation was caught."
