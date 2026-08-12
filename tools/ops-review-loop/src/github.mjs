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

async function graphql(token, query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const body = await res.json()
  // GraphQL answers 200 with an `errors` array, so a status check alone would
  // let a failed resolve look like a successful one.
  if (!res.ok || body.errors) {
    throw new Error(`GitHub GraphQL failed: ${res.status} ${JSON.stringify(body.errors ?? body)}`)
  }
  return body.data
}

/**
 * Resolve the review threads whose comments are listed in `commentIds`.
 *
 * Product Owner decision, 2026-08-12: the repository ruleset requires every
 * review conversation to be resolved before a merge, so a PR that went through
 * even one fix round could never auto-merge — the threads Codex opened on the
 * earlier commit stayed open forever. The loop now closes the threads it
 * actually acted on.
 *
 * Scope is deliberately narrow: only threads whose comments were in the batch
 * just dispatched to Claude, and only after that round pushed a real commit.
 * If a fix was wrong, Codex's next review raises it again as a new thread on
 * the new commit — resolving here claims "this was addressed", not "this was
 * correct", and the next review is what decides the latter.
 */
/**
 * Unresolved review conversations, with enough detail to name them.
 *
 * Codex finding (PR #931, P2): a round that raises P1 *and* P3 only ever
 * resolves the P1 threads, because only those are dispatched. The repository
 * ruleset requires every conversation resolved before a merge, so the P3 thread
 * silently becomes a permanent block — and since nothing re-triggers this
 * workflow, the pipeline dead-ends with no explanation anywhere. CLAUDE.md's
 * "no dead-end pipelines" rule is the one being broken.
 *
 * The fix is NOT to resolve them: this loop never acted on them, and marking
 * them resolved would be a plain false statement about work that did not
 * happen. It is to make them a named, visible blocker so a human can close
 * them in one click knowing exactly which ones.
 */
export async function listUnresolvedReviewThreads(token, owner, repo, pullNumber) {
  const data = await graphql(
    token,
    `query($owner:String!,$repo:String!,$pr:Int!){
      repository(owner:$owner,name:$repo){ pullRequest(number:$pr){
        reviewThreads(first:100){ nodes {
          isResolved isOutdated
          comments(first:1){ nodes { databaseId path url author { login } } } } } } } }`,
    { owner, repo, pr: pullNumber },
  )
  return (data?.repository?.pullRequest?.reviewThreads?.nodes ?? [])
    .filter((t) => !t.isResolved)
    .map((t) => ({
      path: t.comments?.nodes?.[0]?.path ?? '(unknown file)',
      url: t.comments?.nodes?.[0]?.url ?? '',
      author: t.comments?.nodes?.[0]?.author?.login ?? '(unknown)',
      isOutdated: t.isOutdated === true,
    }))
}

export async function resolveThreadsForComments(token, owner, repo, pullNumber, commentIds) {
  if (!commentIds?.length) return []
  const data = await graphql(
    token,
    `query($owner:String!,$repo:String!,$pr:Int!){
      repository(owner:$owner,name:$repo){ pullRequest(number:$pr){
        reviewThreads(first:100){ nodes { id isResolved comments(first:50){ nodes { databaseId } } } } } } }`,
    { owner, repo, pr: pullNumber },
  )
  const wanted = new Set(commentIds)
  const targets = (data?.repository?.pullRequest?.reviewThreads?.nodes ?? []).filter(
    (t) => !t.isResolved && (t.comments?.nodes ?? []).some((c) => wanted.has(c.databaseId)),
  )
  for (const thread of targets) {
    await graphql(token, `mutation($id:ID!){ resolveReviewThread(input:{threadId:$id}){ thread { isResolved } } }`, {
      id: thread.id,
    })
  }
  return targets.map((t) => t.id)
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
