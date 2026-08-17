/**
 * 测试用假 provider —— 按数据建模(预置 PR/issue/recent 三张「表」),
 * 支持按号码注入失败与限流,零网络。遵守 provider.ts 的限流契约:
 * 限流时已抓的照常返回,没轮到的进 failed,rateLimited=true。
 */

import type { BatchResult, GithubReadProvider, WorkItemState } from './provider'
import type { IssueFact, PrFactDetail, RecentWorkItem } from './types'

export class FakeGithubProvider implements GithubReadProvider {
  mainHeadSha = 'fake-main-sha'
  readonly prs = new Map<number, PrFactDetail>()
  readonly issues = new Map<number, IssueFact>()
  /** 存量复核表(收编判定):number → state/body。 */
  readonly workItemStates = new Map<number, WorkItemState>()
  recentWork: RecentWorkItem[] = []
  recentTruncated = false
  /** 这些号码抓取时报错(单条失败,不拖垮整批)。 */
  readonly failNumbers = new Set<number>()
  /** 全局抓取预算:第 N 次抓取后触发 REST 限流(跨批累计,模拟真实配额池)。 */
  rateLimitAfter: number | null = null
  private fetchedTotal = 0
  /** getMainHead 直接炸(模拟整轮 error)。 */
  mainHeadError: Error | null = null

  private batch<T>(
    numbers: readonly number[],
    lookup: (n: number) => T | undefined,
  ): BatchResult<T> {
    const facts: T[] = []
    const failed: { number: number; reason: string }[] = []
    let rateLimited = false
    for (let i = 0; i < numbers.length; i++) {
      const n = numbers[i]
      if (this.rateLimitAfter !== null && this.fetchedTotal >= this.rateLimitAfter) {
        rateLimited = true
        for (const rest of numbers.slice(i)) failed.push({ number: rest, reason: 'rest 限流,未尝试' })
        break
      }
      this.fetchedTotal++
      if (this.failNumbers.has(n)) {
        failed.push({ number: n, reason: 'fake failure' })
        continue
      }
      const fact = lookup(n)
      if (fact) facts.push(fact)
      else failed.push({ number: n, reason: 'not found' })
    }
    return { facts, failed, rateLimited }
  }

  async getMainHead(): Promise<{ sha: string; observedAt: string }> {
    if (this.mainHeadError) throw this.mainHeadError
    return { sha: this.mainHeadSha, observedAt: new Date().toISOString() }
  }

  async getPullRequestFacts(numbers: readonly number[]): Promise<BatchResult<PrFactDetail>> {
    return this.batch(numbers, (n) => this.prs.get(n))
  }

  async getIssueFacts(numbers: readonly number[]): Promise<BatchResult<IssueFact>> {
    return this.batch(numbers, (n) => this.issues.get(n))
  }

  /** 单独模拟「轮到存量复核时配额已尽」,不必跟登记册规模做算术耦合。 */
  rateLimitWorkItems = false

  async getWorkItemStates(numbers: readonly number[]): Promise<BatchResult<WorkItemState>> {
    if (this.rateLimitWorkItems) {
      return {
        facts: [],
        failed: numbers.map((n) => ({ number: n, reason: 'rest 限流,未尝试' })),
        rateLimited: true,
      }
    }
    return this.batch(numbers, (n) => this.workItemStates.get(n))
  }

  async listRecentWork(): Promise<{ items: RecentWorkItem[]; truncated: boolean }> {
    return { items: this.recentWork, truncated: this.recentTruncated }
  }
}

export function makePrFact(overrides: Partial<PrFactDetail> & { number: number }): PrFactDetail {
  return {
    state: 'open',
    isDraft: false,
    baseRef: 'main',
    headSha: `sha-${overrides.number}`,
    mergedCommitSha: null,
    mergeableState: 'unknown',
    unresolvedThreads: 0,
    unresolvedThreadsError: null,
    checks: [],
    checksTruncated: false,
    changedFiles: [],
    changedFilesTruncated: false,
    title: `PR ${overrides.number}`,
    body: '',
    updatedAt: '2026-08-15T00:00:00Z',
    observedAt: '2026-08-15T00:00:00Z',
    ...overrides,
  }
}
