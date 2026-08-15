/**
 * 只读 GitHub adapter 的单元测试 —— 用 mocked `fetch` 覆盖解析 / 分类 / 错误处理逻辑。
 *
 * 🔴 这些测试**不能**证明真实 GitHub API 请求会成功；它们只证明「给定 GitHub API
 *    会返回的形状，这份代码解析得对不对」。本次沙箱没有出站网络权限，一次真实调用
 *    留给 CI / 生产环境验证（见 PR 说明「GitHub 已证实 vs 本地声称」）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  getIssueSnapshot,
  getMainSha,
  getPullRequestSnapshot,
  GithubSyncError,
  listOpenPullRequests,
} from '../github-adapter'

vi.mock('@/lib/validation-utils', () => ({ validateEnvVar: () => 'test-token' }))

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function jsonResponse(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response)
}

function routeFetch(handlers: Record<string, unknown>) {
  // Longest pattern first — e.g. '/pulls/1/files' must win over the shorter '/pulls/1',
  // which is also a substring of it.
  const entries = Object.entries(handlers)
    .filter(([pattern]) => pattern !== 'graphql')
    .sort(([a], [b]) => b.length - a.length)

  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === 'POST' && url.includes('/graphql')) {
      return jsonResponse(200, handlers.graphql)
    }
    for (const [pattern, body] of entries) {
      if (url.includes(pattern)) return jsonResponse(200, body)
    }
    throw new Error(`unhandled mock fetch: ${url}`)
  })
}

beforeEach(() => mockFetch.mockReset())

describe('getMainSha', () => {
  it('从 branches/main 响应里取 commit.sha', async () => {
    routeFetch({ '/branches/main': { commit: { sha: 'abc123' } } })
    expect(await getMainSha()).toBe('abc123')
  })

  it('非 2xx 响应抛出 GithubSyncError 并带 httpStatus', async () => {
    mockFetch.mockReturnValue(jsonResponse(404, { message: 'Not Found' }))
    await expect(getMainSha()).rejects.toThrow(GithubSyncError)
    try {
      await getMainSha()
    } catch (error) {
      expect(error).toBeInstanceOf(GithubSyncError)
      expect((error as GithubSyncError).httpStatus).toBe(404)
    }
  })
})

describe('getIssueSnapshot', () => {
  it('把 state 归一化成 open/closed', async () => {
    routeFetch({
      '/issues/974': { number: 974, state: 'open', title: 'Product Map v1', html_url: 'https://x/974' },
    })
    const snapshot = await getIssueSnapshot(974)
    expect(snapshot).toEqual({ number: 974, state: 'open', title: 'Product Map v1', htmlUrl: 'https://x/974' })
  })
})

describe('getPullRequestSnapshot', () => {
  it('draft PR 归类为 draft', async () => {
    routeFetch({
      '/pulls/1': {
        number: 1, state: 'open', draft: true, merged_at: null,
        html_url: 'https://x/1', head: { sha: 'headsha' }, base: { sha: 'basesha' },
      },
      '/pulls/1/files': [{ filename: 'a.ts' }, { filename: 'b.ts' }],
      '/commits/headsha/check-runs': { check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }] },
      graphql: { data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } },
    })
    const snapshot = await getPullRequestSnapshot(1)
    expect(snapshot.state).toBe('draft')
    expect(snapshot.headSha).toBe('headsha')
    expect(snapshot.baseSha).toBe('basesha')
    expect(snapshot.changedFiles).toEqual(['a.ts', 'b.ts'])
    expect(snapshot.checks).toEqual([{ name: 'ci', status: 'completed', conclusion: 'success' }])
    expect(snapshot.unresolvedReviewThreadCount).toBe(0)
    expect(snapshot.reviewThreadDataTruncated).toBe(false)
  })

  it('merged_at 存在 → merged，即使 draft=false 且 state=closed', async () => {
    routeFetch({
      '/pulls/2': {
        number: 2, state: 'closed', draft: false, merged_at: '2026-08-10T00:00:00Z',
        html_url: 'https://x/2', head: { sha: 's' }, base: { sha: 'b' },
      },
      '/pulls/2/files': [],
      '/commits/s/check-runs': { check_runs: [] },
      graphql: { data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } },
    })
    expect((await getPullRequestSnapshot(2)).state).toBe('merged')
  })

  it('state=closed 且未 merge → closed', async () => {
    routeFetch({
      '/pulls/3': {
        number: 3, state: 'closed', draft: false, merged_at: null,
        html_url: 'https://x/3', head: { sha: 's' }, base: { sha: 'b' },
      },
      '/pulls/3/files': [],
      '/commits/s/check-runs': { check_runs: [] },
      graphql: { data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } },
    })
    expect((await getPullRequestSnapshot(3)).state).toBe('closed')
  })

  it('state=open 且非 draft → open', async () => {
    routeFetch({
      '/pulls/4': {
        number: 4, state: 'open', draft: false, merged_at: null,
        html_url: 'https://x/4', head: { sha: 's' }, base: { sha: 'b' },
      },
      '/pulls/4/files': [],
      '/commits/s/check-runs': { check_runs: [] },
      graphql: { data: { repository: { pullRequest: { reviewThreads: { nodes: [], pageInfo: { hasNextPage: false } } } } } },
    })
    expect((await getPullRequestSnapshot(4)).state).toBe('open')
  })

  it('unresolved review thread 计数只数 isResolved=false 的，并透传 truncated 标志', async () => {
    routeFetch({
      '/pulls/5': {
        number: 5, state: 'open', draft: false, merged_at: null,
        html_url: 'https://x/5', head: { sha: 's' }, base: { sha: 'b' },
      },
      '/pulls/5/files': [],
      '/commits/s/check-runs': { check_runs: [] },
      graphql: {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                nodes: [{ isResolved: true }, { isResolved: false }, { isResolved: false }],
                pageInfo: { hasNextPage: true },
              },
            },
          },
        },
      },
    })
    const snapshot = await getPullRequestSnapshot(5)
    expect(snapshot.unresolvedReviewThreadCount).toBe(2)
    expect(snapshot.reviewThreadDataTruncated).toBe(true)
  })

  it('GraphQL 返回 errors 时抛出 GithubSyncError（不是静默吞掉）', async () => {
    routeFetch({
      '/pulls/6': {
        number: 6, state: 'open', draft: false, merged_at: null,
        html_url: 'https://x/6', head: { sha: 's' }, base: { sha: 'b' },
      },
      '/pulls/6/files': [],
      '/commits/s/check-runs': { check_runs: [] },
      graphql: { errors: [{ message: 'bad credentials' }] },
    })
    await expect(getPullRequestSnapshot(6)).rejects.toThrow(GithubSyncError)
  })
})

describe('listOpenPullRequests', () => {
  it('把 head.ref 映射成 headRefName', async () => {
    routeFetch({
      '/pulls?state=open': [
        { number: 973, head: { ref: 'canonical-inventory-wp' }, draft: false },
        { number: 962, head: { ref: 'kernel-approval-wp' }, draft: true },
      ],
    })
    const result = await listOpenPullRequests()
    expect(result).toEqual([
      { number: 973, headRefName: 'canonical-inventory-wp', draft: false },
      { number: 962, headRefName: 'kernel-approval-wp', draft: true },
    ])
  })
})
