/**
 * `pushKnowledgeFactExpiringItems()` 测试 —— 客户资料库里 `valid_until` 14 天内
 * 到期（或已过期）的已批准条目，汇总成一条待办（issue #1589 第 4 栏）。
 */
import { describe, expect, it, vi } from 'vitest'
import { pushKnowledgeFactExpiringItems } from '../knowledge-fact-expiring-items'
import type { ManualItem } from '../manual-items'
import type { ClientRow } from '../client-roster'

type Row = Record<string, unknown>

function fakeSupabase(rows: Row[] | null, error: { message: string } | null = null) {
  return {
    from: vi.fn(() => ({
      select: () => ({
        eq: () => ({
          not: () => ({
            lte: () => ({
              order: () => ({
                range: () => Promise.resolve({ data: rows, error }),
              }),
            }),
          }),
        }),
      }),
    })),
  }
}

const CLIENTS = new Map<string, ClientRow>([
  ['c1', { id: 'c1', name: 'CTS', domain: 'ctstours.co.nz' }],
])
const NOW = new Date('2026-09-15T12:00:00+13:00')

describe('pushKnowledgeFactExpiringItems', () => {
  it('两条快到期的事实 → 汇总成一条待办，报最早到期天数', async () => {
    const supabase = fakeSupabase([
      { client_id: 'c1', valid_until: '2026-09-20T00:00:00+13:00' },
      { client_id: 'c1', valid_until: '2026-09-25T00:00:00+13:00' },
    ])
    const items: ManualItem[] = []
    await pushKnowledgeFactExpiringItems(supabase as never, items, CLIENTS, NOW)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'knowledge_fact_expiring_soon', client_id: 'c1', client_name: 'CTS' })
    expect(items[0].what).toContain('2 条')
    expect(items[0].what).toContain('5 天过期')
    expect(items[0].href).toContain('c1')
    expect(items[0].href).toContain('knowledge')
  })

  it('已经过期的条目 → 文案说"已经过期"而不是负数天数', async () => {
    const supabase = fakeSupabase([{ client_id: 'c1', valid_until: '2026-09-10T00:00:00+13:00' }])
    const items: ManualItem[] = []
    await pushKnowledgeFactExpiringItems(supabase as never, items, CLIENTS, NOW)
    expect(items[0].what).toContain('已经过期')
  })

  it('客户不在服务名单里（已下线）→ 跳过，不下发「未知客户」噪音', async () => {
    const supabase = fakeSupabase([{ client_id: 'retired-client', valid_until: '2026-09-20T00:00:00+13:00' }])
    const items: ManualItem[] = []
    await pushKnowledgeFactExpiringItems(supabase as never, items, CLIENTS, NOW)
    expect(items).toHaveLength(0)
  })

  it('没有任何条目命中 14 天窗口 → 不生成待办', async () => {
    const supabase = fakeSupabase([])
    const items: ManualItem[] = []
    await pushKnowledgeFactExpiringItems(supabase as never, items, CLIENTS, NOW)
    expect(items).toHaveLength(0)
  })

  it('查询失败 → 抛错（由调用方 manual-items.ts 的 .catch() 兜底，不在这里吞掉）', async () => {
    const supabase = fakeSupabase(null, { message: '模拟故障' })
    const items: ManualItem[] = []
    await expect(pushKnowledgeFactExpiringItems(supabase as never, items, CLIENTS, NOW)).rejects.toThrow('模拟故障')
  })
})
