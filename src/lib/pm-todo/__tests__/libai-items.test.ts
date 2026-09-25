/**
 * 李白 · 两个待办出口。
 *
 * 铁律 3 下半句：机器做不了的必须下发，且带齐 what / how / href。
 * 这里验的是——该报的报了、不该报的不刷屏、未证实句列得清、月检只报告不改。
 */

import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from '../manual-item-types'
import {
  buildCopyTodo,
  buildPromptLibraryTodo,
  fetchLibaiCopyTodos,
  fetchPromptLibraryTodo,
  pushLibaiItems,
  boardUrl,
  COPY_LOOKBACK_DAYS,
  MAX_UNVERIFIED_IN_WHAT,
  type PostRow,
} from '../libai-items'

const NOW = new Date('2026-10-05T20:00:00Z')

function post(over: Partial<PostRow> = {}): PostRow {
  return {
    id: 'p1',
    client_id: 'client-a',
    title: '秋日咖啡特辑',
    script: '欢迎光临。',
    created_at: '2026-10-05T10:00:00Z',
    status: 'draft',
    generation_context_snapshot: null,
    ...over,
  }
}

function labelledSnapshot(unverified: number, total = unverified) {
  const sentences = Array.from({ length: total }, (_, i) => ({
    field: 'script',
    index: i,
    text: `句子${i}`,
    label: i < unverified ? 'unverified' : 'website',
    note: i < unverified ? `依据缺失${i}` : '官网可溯',
  }))
  return {
    libai_provenance: {
      status: 'labelled',
      checked_at: '2026-10-05T12:00:00Z',
      website_url: 'https://example.com',
      brief_id: null,
      sentences,
      unverified_count: unverified,
      cost_usd: 0,
    },
  }
}

describe('buildCopyTodo', () => {
  it('🔴 有未证实句就出三件套，署名李白，href 直达看板', () => {
    const t = buildCopyTodo(
      post({ generation_context_snapshot: labelledSnapshot(2) }),
      NOW,
    )!
    expect(t.kind).toBe('libai_copy_unverified')
    expect(t.what.startsWith('李白：')).toBe(true)
    expect(t.what).toContain('2 句')
    expect(t.what).toContain('句子0')
    expect(t.what).toContain('句子1')
    expect(t.href.endsWith('/content-factory')).toBe(true)
  })

  it('未证实句超过上限时只列前几条，其余指向看板', () => {
    const t = buildCopyTodo(
      post({ generation_context_snapshot: labelledSnapshot(6) }),
      NOW,
    )!
    expect(t.what).toContain('6 句')
    expect(t.what).toContain('句子3')
    expect(t.what).not.toContain('句子4')
    expect(t.what).toContain(`另有 ${6 - MAX_UNVERIFIED_IN_WHAT} 句`)
  })

  it('没有未证实句就不出待办', () => {
    expect(
      buildCopyTodo(post({ generation_context_snapshot: labelledSnapshot(0, 3) }), NOW),
    ).toBeNull()
  })

  it('🔴 检不了要报，而且要说清原因', () => {
    const t = buildCopyTodo(
      post({
        generation_context_snapshot: {
          libai_provenance: {
            status: 'unverifiable',
            checked_at: '2026-10-05T12:00:00Z',
            reason: '官网正文太短或为空，无法溯源',
          },
        },
      }),
      NOW,
    )!
    expect(t.kind).toBe('libai_check_unverifiable')
    expect(t.what).toContain('官网正文太短或为空，无法溯源')
    expect(t.href).toBe(boardUrl('client-a'))
  })

  it('🔴 有逐字稿却过了宽限期还没溯源记录 → 判「没检」', () => {
    const t = buildCopyTodo(
      post({ created_at: '2026-10-05T17:00:00Z', generation_context_snapshot: null }),
      NOW,
    )!
    expect(t.kind).toBe('libai_check_missing')
    expect(t.what).toContain('没检 ≠ 句句有依据')
    expect(t.how).toContain('不用你动手')
  })

  it('刚生成 30 分钟还没溯源记录 → 宽限期内，不说话', () => {
    expect(
      buildCopyTodo(
        post({ created_at: '2026-10-05T19:30:00Z', generation_context_snapshot: null }),
        NOW,
      ),
    ).toBeNull()
  })

  it('没有逐字稿就不判「没检」', () => {
    expect(
      buildCopyTodo(
        post({ script: null, created_at: '2026-10-05T10:00:00Z', generation_context_snapshot: null }),
        NOW,
      ),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------

interface FakeResult {
  data: unknown[]
  error: { message: string } | null
}

function fakeSupabase(tables: Record<string, FakeResult>): SupabaseClient {
  const makeChain = (result: FakeResult) => {
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.in = () => chain
    chain.eq = () => chain
    chain.gte = () => chain
    chain.order = () => chain
    chain.limit = () => Promise.resolve(result)
    return chain
  }
  return {
    from: (table: string) => makeChain(tables[table] ?? { data: [], error: null }),
  } as unknown as SupabaseClient
}

describe('fetchLibaiCopyTodos', () => {
  it('映射行、丢掉 null，只留该报的', async () => {
    const todos = await fetchLibaiCopyTodos(
      fakeSupabase({
        content_posts: {
          data: [
            post({ id: 'p1', generation_context_snapshot: labelledSnapshot(2) }),
            post({ id: 'p2', generation_context_snapshot: labelledSnapshot(0, 3) }),
          ],
          error: null,
        },
      }),
      NOW,
    )
    expect(todos).toHaveLength(1)
    expect(todos[0].kind).toBe('libai_copy_unverified')
  })

  it('查询出错就抛，由调用方隔离', async () => {
    await expect(
      fetchLibaiCopyTodos(
        fakeSupabase({ content_posts: { data: [], error: { message: 'boom' } } }),
        NOW,
      ),
    ).rejects.toThrow('boom')
  })

  it('回看窗口是 14 天', () => {
    expect(COPY_LOOKBACK_DAYS).toBe(14)
  })
})

describe('buildPromptLibraryTodo', () => {
  const finding = (i: number) => ({
    file: `docs/agents/prompt-library/f${i}.md`,
    line: i,
    reference: `ref${i}`,
    reason: `reason${i}`,
  })

  it('skipped 就不说话', () => {
    expect(buildPromptLibraryTodo({ skipped: true, findings: [finding(1)] })).toBeNull()
  })

  it('没有 findings 就不说话', () => {
    expect(buildPromptLibraryTodo({ skipped: false, findings: [] })).toBeNull()
  })

  it('🔴 有 findings 就出一条平台治理待办，只列前 3 条', () => {
    const t = buildPromptLibraryTodo({
      skipped: false,
      findings: [finding(1), finding(2), finding(3), finding(4), finding(5)],
    })!
    expect(t.kind).toBe('libai_prompt_library_stale')
    expect(t.client_id).toBe('infra')
    expect(t.what).toContain('5 处')
    expect(t.what).toContain('f1.md:1')
    expect(t.what).toContain('f3.md:3')
    expect(t.what).not.toContain('f4.md:4')
    expect(t.how).toContain('只报告')
  })
})

describe('fetchPromptLibraryTodo', () => {
  const run = (over: Record<string, unknown> = {}) => ({
    finished_at: '2026-10-04T20:00:00Z',
    status: 'completed',
    summary: { skipped: false, findings: [{ file: 'f.md', line: 1, reference: 'r', reason: 'x' }] },
    ...over,
  })

  it('回执太旧就不说话', async () => {
    const todo = await fetchPromptLibraryTodo(
      fakeSupabase({
        cron_run_logs: { data: [run({ finished_at: '2026-09-05T20:00:00Z' })], error: null },
      }),
      NOW,
    )
    expect(todo).toBeNull()
  })

  it('回执够新且有 findings 就出待办', async () => {
    const todo = await fetchPromptLibraryTodo(
      fakeSupabase({ cron_run_logs: { data: [run()], error: null } }),
      NOW,
    )
    expect(todo?.kind).toBe('libai_prompt_library_stale')
  })
})

describe('pushLibaiItems', () => {
  it('href 要么空要么是 https，月检条目归平台治理', async () => {
    const items: ManualItem[] = []
    await pushLibaiItems(
      fakeSupabase({
        content_posts: {
          data: [post({ generation_context_snapshot: labelledSnapshot(2) })],
          error: null,
        },
        cron_run_logs: {
          data: [
            {
              finished_at: '2026-10-04T20:00:00Z',
              status: 'completed',
              summary: {
                skipped: false,
                findings: [{ file: 'f.md', line: 1, reference: 'r', reason: 'x' }],
              },
            },
          ],
          error: null,
        },
      }),
      items,
      NOW,
      id => `Name of ${id}`,
    )
    expect(items).toHaveLength(2)
    for (const item of items) {
      expect(item.href === '' || item.href.startsWith('https://')).toBe(true)
    }
    const promptItem = items.find(i => i.kind === 'libai_prompt_library_stale')!
    expect(promptItem.client_id).toBe('infra')
    expect(promptItem.client_name).toBe('Magic Engine 平台治理')
  })
})
