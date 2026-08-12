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

export function listIssueComments(token, owner, repo, issueNumber) {
  return request(token, `/repos/${owner}/${repo}/issues/${issueNumber}/comments?per_page=100`)
}

export function createIssueComment(token, owner, repo, issueNumber, body) {
  return request(token, `/repos/${owner}/${repo}/issues/${issueNumber}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  })
}

export function listReviewComments(token, owner, repo, pullNumber, reviewId) {
  return request(token, `/repos/${owner}/${repo}/pulls/${pullNumber}/reviews/${reviewId}/comments?per_page=100`)
}

export async function listCheckRunsForRef(token, owner, repo, ref) {
  const data = await request(token, `/repos/${owner}/${repo}/commits/${ref}/check-runs?per_page=100`)
  return data.check_runs ?? []
}

export function getPullRequest(token, owner, repo, pullNumber) {
  return request(token, `/repos/${owner}/${repo}/pulls/${pullNumber}`)
}

/**
 * Merge a pull request. `sha` is passed through to GitHub as the expected head
 * — GitHub rejects the merge with 409 if the branch has moved since the gate
 * was evaluated. Without it there is a real window between "checks were green"
 * and "merge executes" in which a new commit could land and ship unreviewed.
 */
export function mergePullRequest(token, owner, repo, pullNumber, { sha, commitTitle }) {
  return request(token, `/repos/${owner}/${repo}/pulls/${pullNumber}/merge`, {
    method: 'PUT',
    body: JSON.stringify({ sha, commit_title: commitTitle, merge_method: 'merge' }),
  })
}
