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

export function getPullRequest(token, owner, repo, pullNumber) {
  return request(token, `/repos/${owner}/${repo}/pulls/${pullNumber}`)
}

export async function listCheckRunsForRef(token, owner, repo, ref) {
  const data = await request(token, `/repos/${owner}/${repo}/commits/${ref}/check-runs?per_page=100`)
  return data.check_runs ?? []
}
