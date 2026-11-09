import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushFactoryWorkerItems, type ManualItem } from '../manual-items'

const now = new Date('2026-09-08T10:00:00Z')
const ago = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString()
type Order = { client_id: string; created_at: string; heartbeat_at: string | null; status: string; reject_reason: string | null }
const queued = (client_id: string): Order => ({ client_id, status: 'queued', created_at: ago(40), heartbeat_at: null, reject_reason: 'temporary error' })
const heartbeat = (client_id: string, hours: number): Order => ({ ...queued(client_id), status: 'completed', heartbeat_at: ago(hours) })

// Apply filters, ordering and limits in query order against actual rows.
function database(rows: Order[], failedClient?: string) {
  return { from: () => {
    let data = [...rows]
    let error: { message: string } | null = null
    const query = {
      select: () => query,
      eq: (key: keyof Order, value: unknown) => {
        data = data.filter(r => r[key] === value)
        if (key === 'client_id' && value === failedClient) error = { message: 'connection unavailable' }
        return query
      },
      in: (key: keyof Order, values: unknown[]) => { data = data.filter(r => values.includes(r[key])); return query },
      not: (key: keyof Order, _op: string, value: unknown) => { data = data.filter(r => r[key] !== value); return query },
      order: (key: keyof Order, opts: { ascending: boolean }) => {
        data.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (opts.ascending ? 1 : -1)); return query
      },
      limit: (limit: number) => { data = data.slice(0, limit); return query },
      then: (resolve: (result: unknown) => unknown) => resolve({ data: error ? null : data, error }),
    }
    return query
  } } as unknown as SupabaseClient
}

const names = new Map([['client-a', { name: 'Client A' }], ['client-b', { name: 'Client B' }]])

describe('factory worker evidence through todo generation', () => {
  it.each([499, 500, 501])('keeps client B online behind %i more recent client A heartbeats', async count => {
    const items: ManualItem[] = []
    await pushFactoryWorkerItems(database([
      queued('client-a'), queued('client-b'),
      ...Array.from({ length: count }, () => heartbeat('client-a', 0.1)), heartbeat('client-b', 0.2),
    ]), items, now, names)
    expect(items).toHaveLength(2)
    const clientB = items.find(item => item.what.includes('Client B'))!
    // 这组测的是「B 的心跳没被 A 的 500 条挤掉」，判据是 B 被判成**在线**而不是离线。
    // 断言挑不随文案漂移的两条：在线才会说「工人在线」，离线才会给 --loop 开机指引。
    expect(clientB.what).toContain('工人在线')
    expect(clientB.how).not.toContain('--loop')
  })

  it('does not diagnose a worker as offline when the heartbeat query fails', async () => {
    const items: ManualItem[] = []
    await expect(pushFactoryWorkerItems(database([
      queued('client-a'), queued('client-b'), heartbeat('client-a', 0.1), heartbeat('client-b', 0.2),
    ], 'client-b'), items, now, names)).rejects.toThrow('factory heartbeat query failed')
    expect(items).toEqual([])
  })

  it.each([null, 30])('does not use client A heartbeats when B has missing/stale evidence (%s)', async hours => {
    const items: ManualItem[] = []
    await pushFactoryWorkerItems(database([
      queued('client-a'), queued('client-b'), heartbeat('client-a', 0.1),
      ...(hours === null ? [] : [heartbeat('client-b', hours)]),
    ]), items, now, names)
    const clientB = items.find(item => item.what.includes('Client B'))!
    expect(clientB.how).toContain('--loop')
    expect(clientB.what).toContain('temporary error')
    expect(clientB.what).not.toContain('工人在线')
  })
})

/**
 * 🔴 「工人在线但活过不去」这条必须给真动作，不能写成「先观察下一次重试」。
 *
 * 事实依据：`factory/worker/[id]/fail` 把可重试失败**直接退回 queued，没有任何
 * 退避字段**（`next_retry_at` 只在 publish-worker 那条线上）。失败工单立刻就能
 * 被重新领走，所以「工人在线 + 卡了 6 小时以上」时，重试早该发生了 ——
 * 「在等重试」不成立。
 *
 * 而这条 kind 会进「需要你动手」栏并计入 totalItems（daily-todo.ts），话术却让
 * 人干等的话，就是在制造假待办（Codex P2 复审 PR #1485）。
 */
describe('stuck_on_failure 的话术必须可执行', () => {
  it('🔴 不许出现「先观察」这类干等指引', async () => {
    const items: ManualItem[] = []
    await pushFactoryWorkerItems(
      database([queued('client-a'), heartbeat('client-a', 0.1)]),
      items,
      now,
      names,
    )
    const it0 = items.find((i) => i.kind === 'factory_worker_idle')
    expect(it0, '工人在线 + 活都失败过 → 应该出一条').toBeTruthy()
    expect(it0!.how).not.toContain('先观察')
    expect(it0!.how).not.toContain('等待重试')
    // 必须指向真动作：要么去充值，要么回一句让开发查
    expect(it0!.how).toMatch(/充值|回我一句/)
  })
})
