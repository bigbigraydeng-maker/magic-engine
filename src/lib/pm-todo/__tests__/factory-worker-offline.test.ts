import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushFactoryWorkerItems, type ManualItem } from '../manual-items'

// 「出片机离线」场景：队列里有活 + 按表建模的假库（工单表 + 运行记录表）。
const now = new Date('2026-10-05T10:00:00Z')
const minsAgo = (m: number) => new Date(now.getTime() - m * 60_000).toISOString()
type Row = Record<string, unknown>

function database(orders: Row[], logs: Row[]) {
  return { from: (table: string) => {
    let data = [...(table === 'cron_run_logs' ? logs : orders)]
    const query = {
      select: () => query,
      eq: (k: string, v: unknown) => { data = data.filter(r => r[k] === v); return query },
      not: (k: string, _op: string, v: unknown) => { data = data.filter(r => r[k] !== v); return query },
      order: (k: string, o: { ascending: boolean }) => {
        data.sort((a, b) => String(a[k]).localeCompare(String(b[k])) * (o.ascending ? 1 : -1)); return query
      },
      limit: (n: number) => { data = data.slice(0, n); return query },
      then: (resolve: (r: unknown) => unknown) => resolve({ data, error: null }),
    }
    return query
  } } as unknown as SupabaseClient
}

const order = (client_id: string, waitedMin: number): Row => ({
  client_id, status: 'queued', created_at: minsAgo(waitedMin), heartbeat_at: null, reject_reason: null,
})
const ping = (pingedMinAgo: number, client_ids: string[] = ['a', 'b']): Row => ({
  job_name: 'factory-worker-alive', started_at: minsAgo(pingedMinAgo), summary: { worker_id: 'mac-1', client_ids },
})
const names = new Map([['a', { name: 'Client A' }], ['b', { name: 'Client B' }]])
const run = async (orders: Row[], logs: Row[]) => {
  const items: ManualItem[] = []
  await pushFactoryWorkerItems(database(orders, logs), items, now, names)
  return items
}

describe('出片机离线提醒（30 分钟）', () => {
  it('🔴 离线 45 分钟 + 队列有活 → 下发，三件套齐全，how 带可复制的重启命令', async () => {
    const [item] = await run([order('a', 50)], [ping(45)])
    expect(item.kind).toBe('factory_worker_idle')
    expect(item.what).toContain('Client A')
    expect(item.what).toContain('45 分钟没有工人动过')
    expect(item.how).toContain('launchctl kickstart -k gui/$(id -u)/com.magicengine.factory-worker')
    expect(item.href).toBe('https://app.magicengine.com.au/dashboard/factory')
  })

  it('🔴 活着但没领到单（4 分钟前刚报过存活，排了 2 小时）→ 不下发', async () => {
    expect(await run([order('a', 120)], [ping(4)])).toEqual([])
  })

  it('🔴 恢复后自动消失：同一批排队的活，出片机重新报了存活 → 待办清空', async () => {
    const orders = [order('a', 50)]
    expect(await run(orders, [ping(45)])).toHaveLength(1)
    expect(await run(orders, [ping(1)])).toEqual([])
  })

  it('出片机还活着但代码太旧 → 告诉人怎么更新，单子不进死信', async () => {
    const logs = [ping(2)]
    logs[0].summary = {
      worker_id: 'mac-1',
      client_ids: ['a'],
      engine_stale: true,
      engine_notice: '出片机版本过旧。在你那台 Mac 的出片机文件夹里：先拉取最新代码。队列里的单子还在，不会作废。',
    }
    const items = await run([order('a', 20)], logs)
    expect(items.map((item) => item.what).join('')).toContain('出片机版本过旧')
    expect(items.map((item) => item.how).join('')).toContain('不会作废')
    expect(items.every((item) => item.kind !== 'factory_dead_letter_stuck')).toBe(true)
  })

  it('只限定了客户 B 的出片机在报存活，不能替客户 A 担保', async () => {
    const items = await run([order('a', 50), order('b', 50)], [ping(1, ['b'])])
    expect(items.map(i => i.what).join('')).toContain('Client A')
    expect(items.map(i => i.what).join('')).not.toContain('Client B')
  })
})
