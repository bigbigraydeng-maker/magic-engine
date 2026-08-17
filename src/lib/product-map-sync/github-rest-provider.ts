/**
 * 真实 GitHub 只读 provider —— REST(事实/检查/文件)+ GraphQL(review threads)。
 *
 * 🔴 为什么不复用 `@/lib/cms/github-client`:它在 kernel/boundaries 的
 *    PROVIDER_WRITE_MODULES 清单上,只许 capabilities/ import。本文件是纯读、
 *    单仓锁死的独立实现;header 规范与「错误绝不带 token」约定与其保持一致。
 *
 * 🔴 仓库锁死:所有路径模板内联 APPROVED_REPO,构造函数不收 owner/repo;
 *    响应侧再验一次 full_name(双保险,不符或缺失 = RepoBoundaryError,绝不入库)。
 *
 * 🔴 限流是两个独立池:REST 看 x-ratelimit-remaining(带 secondary limit);
 *    GraphQL 打爆常以 200 + errors 返回。批量方法遵守
 *    provider.ts 的限流契约:已抓成果不丢,未尝试号码进 failed,rateLimited=true。
 *    GraphQL 失败只影响该 PR 的 threads(null,上层留旧值),不拖垮整轮。
 *
 * 🔴 threads 抓不到必须带原因(2026-08-15 事故):旧版把 GraphQL 异常 catch 成
 *    裸 null,生产 12/12 PR 的 unresolved_threads 全空、整轮恒 partial,却没有
 *    任何一条线索能说出为什么 —— 静默失败。现在 null 一律配 error 字符串,
 *    由 runner 汇总进 run.stats.threadsFailures。
 *
 * token 由构造参数注入 —— 本目录 lib 层不读环境变量(架构测试盯)。
 */

import { GITHUB_API_BASE } from '@/lib/cms/vocabulary'
import { APPROVED_REPO } from '@/lib/product-map/types'
import type { BatchResult, GithubReadProvider, WorkItemState } from './provider'
import type { CheckFact, IssueFact, PrFactDetail, RecentWorkItem } from './types'
import { GithubReadError, RateLimitedError, RepoBoundaryError } from './types'

const MAX_PAGES = 10
const MAX_CHANGED_FILES = 100
const REST_REMAINING_FLOOR = 50

/** threads 探测结果 —— count 为 null 时 error 必有值(失败绝不静默)。 */
interface ThreadsProbe {
  readonly count: number | null
  readonly error: string | null
}

interface ProviderOptions {
  readonly token: string
  /** 测试注入;生产不传,用全局 fetch。 */
  readonly fetchImpl?: typeof fetch
  readonly timeoutMs?: number
}

/** 批量抓取的通用骨架:单个失败进 failed;限流中止时保住已抓成果。 */
async function collectBatch<T>(
  numbers: readonly number[],
  fetchOne: (n: number) => Promise<T>,
): Promise<BatchResult<T>> {
  const facts: T[] = []
  const failed: { number: number; reason: string }[] = []
  let rateLimited = false
  for (let i = 0; i < numbers.length; i++) {
    const n = numbers[i]
    try {
      facts.push(await fetchOne(n))
    } catch (err) {
      if (err instanceof RateLimitedError && err.pool === 'rest') {
        rateLimited = true
        for (const rest of numbers.slice(i)) {
          failed.push({ number: rest, reason: `rest 限流,本轮未尝试(${err.message})` })
        }
        break
      }
      failed.push({ number: n, reason: err instanceof Error ? err.message : 'unknown' })
    }
  }
  return { facts, failed, rateLimited }
}

export class GithubRestProvider implements GithubReadProvider {
  private readonly token: string
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  /**
   * 本轮 GraphQL 已被限流。GraphQL 配额是**按 GitHub 用户**算的一个池,
   * 打爆之后同一轮里再逐个 PR 空打只是白烧请求、还会招 secondary limit ——
   * 记下来直接跳过,并如实报「未尝试」。
   */
  private graphqlRateLimited: string | null = null

  constructor(options: ProviderOptions) {
    this.token = options.token
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 15_000
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    }
  }

  private async rest(path: string): Promise<{ body: unknown; linkHeader: string | null }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let res: Response
    try {
      res = await this.fetchImpl(`${GITHUB_API_BASE}${path}`, {
        headers: this.headers(),
        signal: controller.signal,
      })
    } catch (err) {
      throw new GithubReadError(0, err instanceof Error ? err.message : 'fetch 异常')
    } finally {
      clearTimeout(timer)
    }
    const remaining = Number(res.headers.get('x-ratelimit-remaining') ?? 'NaN')
    if (res.status === 403 || res.status === 429) {
      if (!Number.isNaN(remaining) && remaining === 0) {
        throw new RateLimitedError('rest', `remaining=0,reset=${res.headers.get('x-ratelimit-reset') ?? '?'}`)
      }
      if (res.headers.get('retry-after')) {
        throw new RateLimitedError('rest', `secondary limit,retry-after=${res.headers.get('retry-after')}`)
      }
    }
    if (!res.ok) {
      throw new GithubReadError(res.status, `${path.split('?')[0]}`)
    }
    if (!Number.isNaN(remaining) && remaining < REST_REMAINING_FLOOR) {
      throw new RateLimitedError('rest', `remaining=${remaining} < ${REST_REMAINING_FLOOR},本轮止步`)
    }
    return { body: await res.json(), linkHeader: res.headers.get('link') }
  }

  private async graphql(query: string, variables: Record<string, unknown>): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let res: Response
    try {
      res = await this.fetchImpl(`${GITHUB_API_BASE}/graphql`, {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
        signal: controller.signal,
      })
    } catch (err) {
      throw new GithubReadError(0, err instanceof Error ? err.message : 'graphql fetch 异常')
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) throw new GithubReadError(res.status, 'graphql')
    const payload = (await res.json()) as {
      data?: unknown
      errors?: { type?: string; code?: string; message?: string }[]
    }
    if (payload.errors?.length) {
      // 🔴 两种写法都实测见过:文档写 type=RATE_LIMITED,配额真打爆时返回的是
      //    type=RATE_LIMIT + code=graphql_rate_limit。只认前者 = 限流被误判成
      //    普通读取失败,分流全错(2026-08-15 实测)。
      if (payload.errors.some((e) => e.type?.startsWith('RATE_LIMIT') || e.code === 'graphql_rate_limit')) {
        throw new RateLimitedError('graphql', payload.errors[0]?.message ?? 'RATE_LIMITED')
      }
      throw new GithubReadError(200, `graphql errors:${payload.errors[0]?.message ?? '?'}`)
    }
    return payload.data
  }

  /** fail-closed:full_name 缺失或不符都算越界,绝不入库。 */
  private assertRepo(fullName: string | undefined): void {
    if (fullName !== APPROVED_REPO) {
      throw new RepoBoundaryError(fullName ?? '(missing)')
    }
  }

  async getMainHead(): Promise<{ sha: string; observedAt: string }> {
    const { body } = await this.rest(`/repos/${APPROVED_REPO}/branches/main`)
    const b = body as { name: string; commit: { sha: string } }
    return { sha: b.commit.sha, observedAt: new Date().toISOString() }
  }

  async getPullRequestFacts(numbers: readonly number[]): Promise<BatchResult<PrFactDetail>> {
    return collectBatch(numbers, (n) => this.fetchOnePr(n))
  }

  private async fetchOnePr(number: number): Promise<PrFactDetail> {
    const { body } = await this.rest(`/repos/${APPROVED_REPO}/pulls/${number}`)
    const pr = body as {
      number: number
      state: 'open' | 'closed'
      draft: boolean
      merged: boolean
      merge_commit_sha: string | null
      mergeable_state?: string
      base: { ref: string; repo: { full_name: string } }
      head: { sha: string }
      title: string
      body: string | null
      updated_at: string
    }
    this.assertRepo(pr.base.repo.full_name)

    const [checks, files, threads] = await Promise.all([
      this.fetchChecks(pr.head.sha),
      this.fetchChangedFiles(number),
      this.fetchUnresolvedThreads(number),
    ])

    return {
      number: pr.number,
      state: pr.merged ? 'merged' : pr.state === 'open' ? 'open' : 'closed',
      isDraft: pr.draft,
      baseRef: pr.base.ref,
      headSha: pr.head.sha,
      mergedCommitSha: pr.merged ? pr.merge_commit_sha : null,
      mergeableState: pr.mergeable_state ?? 'unknown',
      unresolvedThreads: threads.count,
      unresolvedThreadsError: threads.error,
      checks: checks.checks,
      checksTruncated: checks.truncated,
      changedFiles: files.files,
      changedFilesTruncated: files.truncated,
      title: pr.title,
      body: pr.body ?? '',
      updatedAt: pr.updated_at,
      observedAt: new Date().toISOString(),
    }
  }

  private async fetchChecks(sha: string): Promise<{ checks: CheckFact[]; truncated: boolean }> {
    const { body, linkHeader } = await this.rest(
      `/repos/${APPROVED_REPO}/commits/${sha}/check-runs?per_page=100`,
    )
    const b = body as { check_runs?: { name: string; status: string; conclusion: string | null }[] }
    return {
      checks: (b.check_runs ?? []).map((c) => ({
        name: c.name,
        status: c.status,
        conclusion: c.conclusion,
      })),
      // silent cap 禁令:只取第一页,有下一页就明说截断
      truncated: linkHeader?.includes('rel="next"') ?? false,
    }
  }

  private async fetchChangedFiles(
    number: number,
  ): Promise<{ files: string[]; truncated: boolean }> {
    const files: string[] = []
    let lastLink: string | null = null
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { body, linkHeader } = await this.rest(
        `/repos/${APPROVED_REPO}/pulls/${number}/files?per_page=100&page=${page}`,
      )
      lastLink = linkHeader
      files.push(...(body as { filename: string }[]).map((f) => f.filename))
      if (files.length >= MAX_CHANGED_FILES) break
      if (!linkHeader || !linkHeader.includes('rel="next"')) return { files, truncated: false }
    }
    // 恰好等于上限且没有下一页 ≠ 截断
    const hasMore = files.length > MAX_CHANGED_FILES || (lastLink?.includes('rel="next"') ?? false)
    return { files: files.slice(0, MAX_CHANGED_FILES), truncated: hasMore }
  }

  /**
   * threads 只有 GraphQL 有。失败(含 GraphQL 限流)→ count=null,上层留旧值、
   * run 标 partial。**每一个 null 都必须带 error**,否则就退回到静默失败。
   */
  private async fetchUnresolvedThreads(number: number): Promise<ThreadsProbe> {
    if (this.graphqlRateLimited) {
      return { count: null, error: `graphql 本轮已限流,未尝试(${this.graphqlRateLimited})` }
    }
    const [owner, name] = APPROVED_REPO.split('/')
    try {
      const data = (await this.graphql(
        `query($owner:String!,$name:String!,$number:Int!){
          repository(owner:$owner,name:$name){
            pullRequest(number:$number){
              reviewThreads(first:100){nodes{isResolved}}
            }
          }
        }`,
        { owner, name, number },
      )) as {
        repository?: { pullRequest?: { reviewThreads?: { nodes?: { isResolved: boolean }[] } } }
      }
      const nodes = data.repository?.pullRequest?.reviewThreads?.nodes
      if (!nodes) {
        return { count: null, error: 'graphql 200 但缺 reviewThreads 节点(repository/pullRequest 为空)' }
      }
      return { count: nodes.filter((n) => !n.isResolved).length, error: null }
    } catch (err) {
      if (err instanceof RateLimitedError && err.pool === 'graphql') {
        this.graphqlRateLimited = err.message
      }
      // 错误信息由 typed error 构造,与 REST 同约定:绝不携带 token
      return { count: null, error: err instanceof Error ? err.message : 'graphql 未知失败' }
    }
  }

  async getIssueFacts(numbers: readonly number[]): Promise<BatchResult<IssueFact>> {
    return collectBatch(numbers, async (n) => {
      const issue = await this.fetchIssueRaw(n)
      if (issue.pull_request) {
        // 号码指向 PR —— fail-closed,不冒充 issue(PR 走 getPullRequestFacts)
        throw new GithubReadError(200, `#${n} 是 PR,不是 issue`)
      }
      return {
        number: issue.number,
        state: issue.state,
        title: issue.title,
        body: issue.body ?? '',
        updatedAt: issue.updated_at,
        observedAt: new Date().toISOString(),
      }
    })
  }

  private async fetchIssueRaw(n: number): Promise<{
    number: number
    state: 'open' | 'closed'
    title: string
    body: string | null
    updated_at: string
    repository_url?: string
    pull_request?: unknown
  }> {
    const { body } = await this.rest(`/repos/${APPROVED_REPO}/issues/${n}`)
    const issue = body as {
      number: number
      state: 'open' | 'closed'
      title: string
      body: string | null
      updated_at: string
      repository_url?: string
      pull_request?: unknown
    }
    if (!issue.repository_url?.endsWith(`/repos/${APPROVED_REPO}`)) {
      throw new RepoBoundaryError(issue.repository_url ?? '(missing)')
    }
    return issue
  }

  async getWorkItemStates(numbers: readonly number[]): Promise<BatchResult<WorkItemState>> {
    // /issues/ 端点 PR 与 issue 通吃 —— 存量复核只要 state+body,故意不 fail-closed PR
    return collectBatch(numbers, async (n) => {
      const issue = await this.fetchIssueRaw(n)
      return { number: issue.number, state: issue.state, body: issue.body ?? '' }
    })
  }

  async listRecentWork(
    sinceIso: string,
  ): Promise<{ items: RecentWorkItem[]; truncated: boolean }> {
    const items: RecentWorkItem[] = []
    let truncated = false
    let page = 1
    for (; page <= MAX_PAGES; page++) {
      const { body, linkHeader } = await this.rest(
        `/repos/${APPROVED_REPO}/issues?state=open&since=${encodeURIComponent(sinceIso)}&per_page=100&page=${page}`,
      )
      const batch = body as {
        number: number
        title: string
        body: string | null
        html_url: string
        created_at: string
        pull_request?: unknown
      }[]
      for (const it of batch) {
        items.push({
          kind: it.pull_request ? 'pr' : 'issue',
          number: it.number,
          title: it.title,
          body: it.body ?? '',
          url: it.html_url,
          openedAt: it.created_at,
        })
      }
      if (!linkHeader || !linkHeader.includes('rel="next"')) break
    }
    if (page > MAX_PAGES) truncated = true
    return { items, truncated }
  }
}
