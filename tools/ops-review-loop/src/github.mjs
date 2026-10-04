/**
 * Deliberately tiny REST wrapper around Node's built-in fetch — no SDK
 * dependency, so this module runs on a bare `ubuntu-latest` runner with no
 * `npm ci` step. Every call here is I/O, so unlike the rest of this tool it is
 * not exercised by the offline unit tests; it is what a live run would prove.
 */
const API = 'https://api.github.com'

async function request(token, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers ?? {}),
    },
  })
  if (!res.ok) {
    throw new Error(`GitHub API ${init.method ?? 'GET'} ${path} failed: ${res.status} ${await res.text()}`)
  }
  return res.status === 204 ? null : res.json()
}

/**
 * Hard cap on pages fetched for any paginated list this tool reads. 300
 * pages * 100 entries = 30,000 — far beyond anything this repo's PRs
 * produce, so hitting it means pagination itself is broken, not that the
 * list is unusually large. It throws rather than returning a silently
 * truncated list.
 */
const MAX_LIST_PAGES = 300

/**
 * Fetch every page of a GitHub list endpoint, oldest-first (GitHub's own
 * default order) — the order every marker-parsing caller relies on for
 * "last match wins".
 *
 * 🔴 Why this now covers issue comments and review comments too, not just
 * changed files: every dedup and "last trusted marker wins" decision in this
 * tool (`gate-marker.mjs`'s `findGateFor`, `markers.mjs`'s stage checks) is a
 * fold over exactly these two lists. A PR long enough to spill past the
 * first 100-comment page used to see its rating/review-requested/decision
 * markers on page 1 go invisible to every later run — since GitHub returns
 * comments oldest-first, the newest, most-authoritative ones are the ones
 * that fell off. That reproduces the marker itself, not a symptom of it: a
 * rerun would rate again, request Codex again, and post a second verdict for
 * a sha that already had one.
 *
 * @param {string} token
 * @param {(page: number) => string} pathForPage
 * @returns {Promise<Array<Record<string, unknown>>>}
 * @throws if a page request fails or pagination does not terminate within
 *   {@link MAX_LIST_PAGES}
 */
async function paginateAll(token, pathForPage) {
  const items = []
  for (let page = 1; page <= MAX_LIST_PAGES; page++) {
    const batch = await request(token, pathForPage(page))
    items.push(...batch)
    if (batch.length < 100) return items
  }
  throw new Error(
    `${pathForPage(1)} did not terminate within ${MAX_LIST_PAGES} pages — refusing to return a possibly-truncated list`,
  )
}

/**
 * Every comment on the PR's Issues thread, fully paginated, oldest first
 * (GitHub's own default order) — the order every marker-parsing caller
 * relies on for "last match wins".
 *
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {number|string} issueNumber
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export function listIssueComments(token, owner, repo, issueNumber) {
  return paginateAll(token, (page) => `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100&page=${page}`)
}

export function createIssueComment(token, owner, repo, issueNumber, body) {
  return request(token, `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  })
}

/**
 * Every inline comment on one Codex review, fully paginated.
 *
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {number|string} pullNumber
 * @param {number|string} reviewId
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export function listReviewComments(token, owner, repo, pullNumber, reviewId) {
  return paginateAll(
    token,
    (page) => `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews/${reviewId}/comments?per_page=100&page=${page}`,
  )
}

export function getPullRequest(token, owner, repo, pullNumber) {
  return request(token, `/repos/${owner}/${repo}/pulls/${pullNumber}`)
}

export async function listCheckRunsForRef(token, owner, repo, ref) {
  const data = await request(token, `/repos/${owner}/${repo}/commits/${ref}/check-runs?per_page=100`)
  return data.check_runs ?? []
}

/**
 * Every file the PR changed, fully paginated. Each entry keeps whatever
 * GitHub returns — `filename`, `status`, `previous_filename` for renames —
 * so callers (risk.mjs's `classifyRisk`) can rate both ends of a rename.
 *
 * 🔴 Codex finding (PR #1211, P2): GitHub's List pull request files endpoint
 * hard-caps its result set at 3000 entries
 * (https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#list-pull-requests-files),
 * a limit `paginateAll`'s own "short page = done" rule cannot see — a PR with
 * more than 3000 changed files ends on a page short of 100 (or empty)
 * entries for the same reason a genuinely complete list does, and the risk
 * rating would then silently be computed from only the first 3000 files. A
 * PR that big is exactly the shape most likely to bury an A-level path (a
 * migration, a workflow file) past that cutoff. `changed_files` on the PR
 * resource itself is a count, not a paginated list, so it is not subject to
 * the same cap — comparing against it is the only way to tell "short because
 * complete" from "short because truncated".
 *
 * @param {string} token
 * @param {string} owner
 * @param {string} repo
 * @param {number|string} pullNumber
 * @returns {Promise<Array<Record<string, unknown>>>}
 * @throws if a page request fails, pagination does not terminate within
 *   {@link MAX_LIST_PAGES}, or the returned file count does not match the
 *   PR's own `changed_files` count
 */
export async function listPullRequestFiles(token, owner, repo, pullNumber) {
  const [pr, items] = await Promise.all([
    getPullRequest(token, owner, repo, pullNumber),
    paginateAll(token, (page) => `/repos/${owner}/${repo}/pulls/${pullNumber}/files?per_page=100&page=${page}`),
  ])
  if (typeof pr.changed_files === 'number' && items.length !== pr.changed_files) {
    throw new Error(
      `PR #${pullNumber} reports ${pr.changed_files} changed files but the files API returned ${items.length} — refusing to rate this PR from a possibly-truncated file list (GitHub's List pull request files endpoint caps out at 3000 results).`,
    )
  }
  return items
}
