/**
 * `pushMessengerDraftItems()` 测试 —— 一次查询按 `verifier_status` 分成
 * 待批准 / 发送失败 / 超时升级三档待办（issue #1589）。
 */
import { describe, expect, it, vi } from 'vitest'
import { pushMessengerDraftItems } from '../messenger-draft-items'
import type { ManualItem } from '../manual-items'
import type { ClientRow } from '../client-roster'

type Row = Record<string, unknown>

function fakeSupabase(rows: Row[] | null, error: { message: string } | null = null) {
  return {
    from: vi.fn(() => ({
      select: () => ({
        in: () => ({
          is: () => ({
            order: () => ({
              range: () => Promise.resolve({ data: rows, error }),
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

describe('pushMessengerDraftItems', () => {
  it('pending 草稿 → 生成待批准待办，报最早一条等了多少小时', async () => {
    const supabase = fakeSupabase([
      { client_id: 'c1', verifier_status: 'pending', created_at: '2026-09-15T08:00:00+13:00' },
      { client_id: 'c1', verifier_status: 'pending', created_at: '2026-09-15T10:00:00+13:00' },
    ])
    const items: ManualItem[] = []
    await pushMessengerDraftItems(supabase as never, items, CLIENTS, NOW)
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'messenger_draft_pending_approval', client_id: 'c1', client_name: 'CTS' })
    expect(items[0].what).toContain('2 位')
    expect(items[0].what).toContain('4 小时')
    expect(items[0].href).toContain('c1')
  })

  it('send_failed → 生成发送失败待办', async () => {
    const supabase = fakeSupabase([
      { client_id: 'c1', verifier_status: 'send_failed', created_at: '2026-09-15T08:00:00+13:00' },
    ])
    const items: ManualItem[] = []
    await pushMessengerDraftItems(supabase as never, items, CLIENTS, NOW)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('messenger_draft_send_failed')
    expect(items[0].what).toContain('发送失败')
  })

  it('timed_out → 生成超时升级待办', async () => {
    const supabase = fakeSupabase([
      { client_id: 'c1', verifier_status: 'timed_out', created_at: '2026-09-15T08:00:00+13:00' },
    ])
    const items: ManualItem[] = []
    await pushMessengerDraftItems(supabase as never, items, CLIENTS, NOW)
    expect(items).toHaveLength(1)
    expect(items[0].kind).toBe('messenger_draft_escalation')
    expect(items[0].what).toContain('4 小时')
  })

  it('三档同一个客户 → 各自独立成一条，互不合并', async () => {
    const supabase = fakeSupabase([
      { client_id: 'c1', verifier_status: 'pending', created_at: '2026-09-15T08:00:00+13:00' },
      { client_id: 'c1', verifier_status: 'send_failed', created_at: '2026-09-15T08:00:00+13:00' },
      { client_id: 'c1', verifier_status: 'timed_out', created_at: '2026-09-15T08:00:00+13:00' },
    ])
    const items: ManualItem[] = []
    await pushMessengerDraftItems(supabase as never, items, CLIENTS, NOW)
    expect(items).toHaveLength(3)
    expect(items.map((i) => i.kind).sort()).toEqual(
      ['messenger_draft_escalation', 'messenger_draft_pending_approval', 'messenger_draft_send_failed'].sort(),
    )
  })

  it('没有任何草稿命中三档状态 → 不生成待办', async () => {
    const supabase = fakeSupabase([])
    const items: ManualItem[] = []
    await pushMessengerDraftItems(supabase as never, items, CLIENTS, NOW)
    expect(items).toHaveLength(0)
  })

  it('客户不在服务名单里（已下线）→ 跳过，不下发「未知客户」噪音', async () => {
    const supabase = fakeSupabase([
      { client_id: 'retired-client', verifier_status: 'pending', created_at: '2026-09-15T08:00:00+13:00' },
    ])
    const items: ManualItem[] = []
    await pushMessengerDraftItems(supabase as never, items, CLIENTS, NOW)
    expect(items).toHaveLength(0)
  })

  it('查询失败 → 抛错（由调用方 manual-items.ts 的 .catch() 兜底，不在这里吞掉）', async () => {
    const supabase = fakeSupabase(null, { message: '模拟故障' })
    const items: ManualItem[] = []
    await expect(pushMessengerDraftItems(supabase as never, items, CLIENTS, NOW)).rejects.toThrow('模拟故障')
  })
})
