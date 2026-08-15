/**
 * ME2 Product Map v1 —— 只读 GitHub adapter（Issue #974「GitHub 动态同步」一节）。
 *
 * 🔴 只读。没有任何写操作 —— 不 merge、不 close、不 comment、不改 label。
 *    这是 Issue #974 的硬红线：「GitHub 只读，不允许 Product Map 回写、合并或关闭 Issue/PR」。
 *
 * REST 拿得到 Issue / PR 状态、head/base SHA、changed files、checks；
 * unresolved review threads 是 GraphQL-only 字段（REST 完全没有），所以这里两条通道都用。
 *
 * 🔴 凭证在函数调用时读取（`validateEnvVar` 在被调用的那一刻才访问 `process.env`），
 *    不在模块顶层初始化 —— 遵循 CLAUDE.md 铁律 7「SDK 客户端必须在 handler 内部初始化」，
 *    同一条原则也适用于任何需要凭证的外部 API 封装，不只是 SDK 对象。
 *
 * 本次会话的沙箱没有出站网络权限，以下实现未经真实请求验证（见 PR 说明）。
 * 单元测试用 mocked `fetch` 覆盖解析 / 分类 / 错误处理逻辑，不能替代一次真实调用。
 */

import { validateEnvVar } from '@/lib/validation-utils'

const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_GRAPHQL_URL = 'https://api.github.com/graphql'
const OWNER = 'bigbigraydeng-maker'
const REPO = 'magic-engine'
const DEFAULT_BRANCH = 'main'

function getToken(): string {
  return validateEnvVar('GITHUB_TOKEN')
}

export class GithubSyncError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
  ) {
    super(message)
    this.name = 'GithubSyncError'
  }
}

async function githubRest<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'magic-engine-product-map',
    },
  })
  if (!res.ok) {
    throw new GithubSyncError(`GitHub REST ${path} 返回 ${res.status}`, res.status)
  }
  return (await res.json()) as T
}

async function githubGraphQL<T>(query: string, variables: Record<string, unknown>, token: string): Promise<T> {
  const res = await fetch(GITHUB_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'magic-engine-product-map',
    },
    body: JSON.stringify({ query, variables }),
  })
  if (!res.ok) {
    throw new GithubSyncError(`GitHub GraphQL 返回 ${res.status}`, res.status)
  }
  const json = (await res.json()) as { data?: T; errors?: readonly { message: string }[] }
  if (json.errors && json.errors.length > 0) {
    throw new GithubSyncError(`GitHub GraphQL 错误：${json.errors.map((e) => e.message).join('; ')}`, null)
  }
  if (!json.data) {
    throw new GithubSyncError('GitHub GraphQL 返回了空 data', null)
  }
  return json.data
}

// ── main SHA ─────────────────────────────────────────────────────────────────

interface BranchResponse {
  readonly commit: { readonly sha: string }
}

export async function getMainSha(token: string = getToken()): Promise<string> {
  const branch = await githubRest<BranchResponse>(`/repos/${OWNER}/${REPO}/branches/${DEFAULT_BRANCH}`, token)
  return branch.commit.sha
}

// ── Issue ────────────────────────────────────────────────────────────────────

export interface GithubIssueSnapshot {
  readonly number: number
  readonly state: 'open' | 'closed'
  readonly title: string
  readonly htmlUrl: string
}

interface IssueResponse {
  readonly number: number
  readonly state: string
  readonly title: string
  readonly html_url: string
}

export async function getIssueSnapshot(
  issueNumber: number,
  token: string = getToken(),
): Promise<GithubIssueSnapshot> {
  const issue = await githubRest<IssueResponse>(`/repos/${OWNER}/${REPO}/issues/${issueNumber}`, token)
  return {
    number: issue.number,
    state: issue.state === 'closed' ? 'closed' : 'open',
    title: issue.title,
    htmlUrl: issue.html_url,
  }
}

// ── Pull Request ─────────────────────────────────────────────────────────────

export type PullRequestState = 'draft' | 'open' | 'merged' | 'closed'

export interface GithubCheckRun {
  readonly name: string
  readonly status: string
  readonly conclusion: string | null
}

export interface GithubPullRequestSnapshot {
  readonly number: number
  readonly state: PullRequestState
  readonly headSha: string
  readonly baseSha: string
  readonly htmlUrl: string
  readonly changedFiles: readonly string[]
  readonly checks: readonly GithubCheckRun[]
  readonly unresolvedReviewThreadCount: number
  /** true 表示 unresolved review thread 数量可能不完整（超过单页 100 条）。 */
  readonly reviewThreadDataTruncated: boolean
}

interface PullRequestResponse {
  readonly number: number
  readonly state: string
  readonly draft: boolean
  readonly merged_at: string | null
  readonly html_url: string
  readonly head: { readonly sha: string }
  readonly base: { readonly sha: string }
}

interface PullRequestFilesResponse {
  readonly filename: string
}

interface CheckRunsResponse {
  readonly check_runs: readonly {
    readonly name: string
    readonly status: string
    readonly conclusion: string | null
  }[]
}

function derivePullRequestState(pr: PullRequestResponse): PullRequestState {
  if (pr.merged_at) return 'merged'
  if (pr.state === 'closed') return 'closed'
  if (pr.draft) return 'draft'
  return 'open'
}

const REVIEW_THREADS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          nodes { isResolved }
          pageInfo { hasNextPage }
        }
      }
    }
  }
`

interface ReviewThreadsQueryResult {
  readonly repository: {
    readonly pullRequest: {
      readonly reviewThreads: {
        readonly nodes: readonly { readonly isResolved: boolean }[]
        readonly pageInfo: { readonly hasNextPage: boolean }
      }
    } | null
  } | null
}

async function getUnresolvedReviewThreadCount(
  prNumber: number,
  token: string,
): Promise<{ readonly count: number; readonly truncated: boolean }> {
  const data = await githubGraphQL<ReviewThreadsQueryResult>(
    REVIEW_THREADS_QUERY,
    { owner: OWNER, repo: REPO, number: prNumber },
    token,
  )
  const threads = data.repository?.pullRequest?.reviewThreads
  if (!threads) return { count: 0, truncated: false }
  const count = threads.nodes.filter((n) => !n.isResolved).length
  return { count, truncated: threads.pageInfo.hasNextPage }
}

export async function getPullRequestSnapshot(
  prNumber: number,
  token: string = getToken(),
): Promise<GithubPullRequestSnapshot> {
  const pr = await githubRest<PullRequestResponse>(`/repos/${OWNER}/${REPO}/pulls/${prNumber}`, token)

  const [files, checks, reviewThreads] = await Promise.all([
    githubRest<readonly PullRequestFilesResponse[]>(
      `/repos/${OWNER}/${REPO}/pulls/${prNumber}/files?per_page=100`,
      token,
    ),
    githubRest<CheckRunsResponse>(`/repos/${OWNER}/${REPO}/commits/${pr.head.sha}/check-runs`, token),
    getUnresolvedReviewThreadCount(prNumber, token),
  ])

  return {
    number: pr.number,
    state: derivePullRequestState(pr),
    headSha: pr.head.sha,
    baseSha: pr.base.sha,
    htmlUrl: pr.html_url,
    changedFiles: files.map((f) => f.filename),
    checks: checks.check_runs.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion })),
    unresolvedReviewThreadCount: reviewThreads.count,
    reviewThreadDataTruncated: reviewThreads.truncated,
  }
}

// ── Open PR list (for overlap-check tooling) ─────────────────────────────────

export interface GithubOpenPullRequestSummary {
  readonly number: number
  readonly headRefName: string
  readonly draft: boolean
}

interface OpenPullRequestListResponse {
  readonly number: number
  readonly head: { readonly ref: string }
  readonly draft: boolean
}

export async function listOpenPullRequests(
  token: string = getToken(),
): Promise<readonly GithubOpenPullRequestSummary[]> {
  const list = await githubRest<readonly OpenPullRequestListResponse[]>(
    `/repos/${OWNER}/${REPO}/pulls?state=open&per_page=100`,
    token,
  )
  return list.map((pr) => ({ number: pr.number, headRefName: pr.head.ref, draft: pr.draft }))
}
