#!/usr/bin/env bash
# Changed-area tests — run the vitest tests that depend on what a PR changed,
# and fail only on failures the PR introduced.
#
# Why (2026-09-27): PR #1942 bumped the shared Meta Graph version and turned
# tests under src/lib/meta and src/lib/inngest red on main. No PR workflow ran
# vitest over those directories, so nobody saw it for 4 days. A full-suite gate
# is not usable either: main already carries ~100 unrelated red tests.
#
# How:
#   1. Pick tests: changed src/ + scripts/ code files go to `vitest related`,
#      which follows the import graph (so graph-base.ts also selects the Inngest
#      test that imports it transitively). `related` cannot see files a test
#      reads from disk, so any test that names a changed file's path literally
#      (render.yaml, a migration, a page.tsx it greps for imports) is added too.
#   2. Tests that fail are re-run alone on head (drops load-induced timeouts).
#   3. The same files run at the fork point (merge-base). Only failures present
#      on head and absent there count as new; pre-existing ones are listed only.
#
# Not covered, on purpose: global config (vitest.config/setup, package.json) —
# those rate A in the risk gate and get human review; deleted modules — the
# Type-check job reports the missing import. Accepted trade-off: a PR-introduced
# flaky failure that passes on the re-run is let through.
#
# Inputs (env): BASE_SHA, HEAD_SHA. Run from a full-history checkout of HEAD
# with dependencies installed. Read-only: no secrets, no network besides npm ci.
set -euo pipefail
export LC_ALL=C

: "${BASE_SHA:?BASE_SHA is required}"
: "${HEAD_SHA:?HEAD_SHA is required}"
# Head run cap; past it the selection is too broad to evaluate within the job.
HEAD_RUN_TIMEOUT="${HEAD_RUN_TIMEOUT:-35m}"

work="${RUNNER_TEMP:-$(mktemp -d)}/changed-area-tests"
mkdir -p "${work}"
work="$(cd "${work}" && pwd -P)"
summary="${GITHUB_STEP_SUMMARY:-/dev/stdout}"
repo_root="$(pwd -P)"

if [[ "$(git rev-parse HEAD)" != "$(git rev-parse "${HEAD_SHA}^{commit}")" ]]; then
  echo "::error::Checked-out HEAD is not HEAD_SHA ${HEAD_SHA}; refusing to test the wrong code."
  exit 1
fi
# The fork point, not base.sha: base.sha is main's tip when the event fired, and
# a test main fixed after the fork would otherwise be blamed on this PR.
fork_sha="$(git merge-base "${BASE_SHA}" "${HEAD_SHA}")"

# Failing test ids from a vitest JSON report: "<relative file> :: <full name>".
# A failed file with no failed assertion (load error, beforeAll/afterAll throw)
# becomes "<file> :: (file-level failure)".
failures_from_report() {
  local report="$1" root="$2"
  jq -r --arg root "${root%/}/" '
    .testResults[]
    | (.name | ltrimstr($root)) as $file
    | [.assertionResults[] | select(.status == "failed")
       | "\($file) :: \(.fullName | gsub("\n"; "\\n"))"] as $failed
    | if ($failed | length) > 0 then $failed[]
      elif .status == "failed" then "\($file) :: (file-level failure)"
      else empty end
  ' "${report}" | sort -u
}

files_of() { sed 's/ :: .*$//' | sort -u; }
count() { wc -l < "$1" | tr -d ' '; }

# Portable `mapfile -t` (macOS ships bash 3.2): read_lines <array> < input.
read_lines() {
  local __line
  eval "$1=()"
  while IFS= read -r __line; do
    if [[ -n "${__line}" ]]; then eval "$1+=(\"\${__line}\")"; fi
  done
  return 0
}

# Runs vitest, sets vitest_status, keeps its console output next to the report,
# and insists on a report: a crash without JSON is not "no failures".
vitest_status=0
run_vitest() {
  local report="$1"; shift
  rm -f "${report}"
  set +e
  "$@" --reporter=default --reporter=json --outputFile.json="${report}" 2>&1 | tee "${report%.json}.log"
  vitest_status=${PIPESTATUS[0]}
  set -e
  if [[ ${vitest_status} -eq 124 ]]; then
    echo "::error::Related tests did not finish within ${HEAD_RUN_TIMEOUT}; this change selects too many tests to evaluate here."
    echo "- Result: NOT EVALUATED — related test run exceeded ${HEAD_RUN_TIMEOUT}." >> "${summary}"
    exit 1
  fi
  if [[ ! -s "${report}" ]]; then
    echo "::error::vitest exited ${vitest_status} without a JSON report; cannot compare against base."
    exit 1
  fi
}

# Errors outside any test (e.g. an unawaited rejected promise): vitest exits 1
# while every file and test in the JSON says passed. Only the console says so.
UNHANDLED_RE='Vitest caught [0-9]+ unhandled error'
has_unhandled() { grep -Eq "${UNHANDLED_RE}" "$1"; }

changed=$(git diff --name-only --diff-filter=d "${fork_sha}...${HEAD_SHA}")
code=$(grep -E '^(src|scripts)/.*\.(ts|tsx|js|jsx|mjs|cjs)$' <<<"${changed}" || true)

# Tests that name a changed file by path. For non-code files also their
# directory (a test reading supabase/migrations), but not shallow src/ dirs
# like src/lib that half the suite mentions.
data_tests=""
if [[ -n "${changed}" ]]; then
  read_lines changed_files <<<"${changed}"
  pattern_args=()
  for f in "${changed_files[@]}"; do
    pattern_args+=(-e "${f}")
    d=$(dirname "${f}")
    if [[ "${f}" =~ \.(ts|tsx|js|jsx|mjs|cjs)$ || "${d}" != */* ]]; then continue; fi
    if [[ "${d}" == src/* && "${d}" != src/*/*/* ]]; then continue; fi
    pattern_args+=(-e "${d}")
  done
  data_tests=$(git grep -lF "${pattern_args[@]}" -- \
    'src/**/*.test.*' 'src/**/*.spec.*' 'scripts/**/*.test.*' 'scripts/**/*.spec.*' || true)
fi

targets=$(printf '%s\n%s\n' "${code}" "${data_tests}" | sed '/^$/d' | sort -u)

{
  echo '## Changed-area tests'
  echo
  echo "- Base: \`${BASE_SHA}\` · fork point: \`${fork_sha}\` · Head: \`${HEAD_SHA}\`"
} >> "${summary}"

if [[ -z "${targets}" ]]; then
  echo '- Result: NOT APPLICABLE — no src/ or scripts/ code changed, and no test reads a changed file by path. Global config (vitest/package.json) is not evaluated here.' >> "${summary}"
  exit 0
fi

echo "- Changed code files: $(grep -c . <<<"${code}" || true) · tests selected by file path: $(grep -c . <<<"${data_tests}" || true)" >> "${summary}"

timeout_cmd=()
if command -v timeout >/dev/null; then timeout_cmd=(timeout --kill-after=1m "${HEAD_RUN_TIMEOUT}"); fi

read_lines target_files <<<"${targets}"
run_vitest "${work}/head.json" ${timeout_cmd[@]+"${timeout_cmd[@]}"} \
  npx vitest related --run --passWithNoTests "${target_files[@]}"
head_status=${vitest_status}
failures_from_report "${work}/head.json" "${repo_root}" > "${work}/head.failures"
head_unhandled=0
if has_unhandled "${work}/head.log"; then head_unhandled=1; fi
echo "- Test files run: $(jq '.testResults | length' "${work}/head.json")" >> "${summary}"

if [[ ! -s "${work}/head.failures" && ${head_unhandled} -eq 0 ]]; then
  if [[ ${head_status} -ne 0 ]]; then
    echo "::error::vitest exited ${head_status} but no failure maps to a test or to an unhandled error. See the log above."
    echo "- Result: FAIL — non-zero exit that cannot be attributed." >> "${summary}"
    exit 1
  fi
  echo '- Result: PASS — every related test passed on the PR head.' >> "${summary}"
  exit 0
fi

# Re-run failing files alone on head so a timeout caused by parallel load does
# not get blamed on the PR.
: > "${work}/head.confirmed"
if [[ -s "${work}/head.failures" ]]; then
  read_lines fail_files < <(files_of < "${work}/head.failures")
  run_vitest "${work}/head-rerun.json" npx vitest run "${fail_files[@]}"
  failures_from_report "${work}/head-rerun.json" "${repo_root}" > "${work}/head.confirmed"
fi

if [[ ! -s "${work}/head.confirmed" && ${head_unhandled} -eq 0 ]]; then
  echo "- Result: PASS — $(count "${work}/head.failures") failure(s) under parallel load passed when re-run alone:" >> "${summary}"
  sed 's/^/  - /' "${work}/head.failures" >> "${summary}"
  exit 0
fi

# Same files at the fork point. A file absent there is new, so its failures are
# new. With an unhandled error on head, every test file head ran goes too, to
# see whether the fork point already raised it.
base_dir="${work}/base"
git worktree add --detach "${base_dir}" "${fork_sha}" >/dev/null
trap 'git -C "${repo_root}" worktree remove --force "${base_dir}" >/dev/null 2>&1 || true' EXIT
base_dir="$(cd "${base_dir}" && pwd -P)"
{
  files_of < "${work}/head.confirmed"
  if [[ ${head_unhandled} -eq 1 ]]; then
    jq -r --arg root "${repo_root}/" '.testResults[].name | ltrimstr($root)' "${work}/head.json"
  fi
} | sort -u > "${work}/base.candidates"
read_lines candidate_files < "${work}/base.candidates"
base_files=()
for f in "${candidate_files[@]}"; do
  if [[ -f "${base_dir}/${f}" ]]; then base_files+=("${f}"); fi
done

: > "${work}/base.failures"
base_unhandled=0
if (( ${#base_files[@]} > 0 )); then
  pushd "${base_dir}" >/dev/null
  npm ci --no-audit --no-fund >/dev/null
  run_vitest "${work}/base.json" npx vitest run "${base_files[@]}"
  popd >/dev/null
  failures_from_report "${work}/base.json" "${base_dir}" > "${work}/base.failures"
  if has_unhandled "${work}/base.log"; then base_unhandled=1; fi
fi

comm -23 "${work}/head.confirmed" "${work}/base.failures" > "${work}/new.failures"
comm -12 "${work}/head.confirmed" "${work}/base.failures" > "${work}/preexisting.failures"
if [[ ${head_unhandled} -eq 1 ]]; then
  unhandled_line="(unhandled error outside tests: $(grep -Eom1 "${UNHANDLED_RE}s?" "${work}/head.log"))"
  if [[ ${base_unhandled} -eq 0 ]]; then
    echo "${unhandled_line}" >> "${work}/new.failures"
  else
    echo "${unhandled_line}" >> "${work}/preexisting.failures"
  fi
fi

{
  echo "- Pre-existing failures (also red at the fork point, not blocking): $(count "${work}/preexisting.failures")"
  sed 's/^/  - /' "${work}/preexisting.failures"
  echo "- New failures introduced by this PR: $(count "${work}/new.failures")"
  sed 's/^/  - /' "${work}/new.failures"
} >> "${summary}"

if [[ -s "${work}/new.failures" ]]; then
  echo '::error::This PR makes tests fail that pass at its fork point:'
  cat "${work}/new.failures"
  echo '- Result: FAIL' >> "${summary}"
  exit 1
fi

echo '- Result: PASS — only pre-existing failures remain.' >> "${summary}"
