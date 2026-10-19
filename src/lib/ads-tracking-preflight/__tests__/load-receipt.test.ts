import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('../client-config', () => ({
  getTrackingClientConfig: (id: string) => (id === 'c1' ? {} : null),
  listTrackingClientIds: () => ['c1'],
}))

import { loadTrackingGateFacts } from '../load-receipt'
import { TRACKING_PREFLIGHT_JOB, buildClientReceipt, buildRunReceipt } from '../receipt'
import { HARD_GATE } from '../types'

const AT = '2026-10-19T07:00:00.000Z'

function receiptFor(clientId: string) {
  return buildClientReceipt({
    requestId: `r-${clientId}`, clientId, checkedAt: AT, trigger: 'cron', phase: 'preflight',
    gates: [{ key: 'tracking.pixel_alive', status: 'green', reason: 'ok', how: '', evidence: {}, as_of: AT, hard: HARD_GATE['tracking.pixel_alive'] }],
    readErrors: [], links: { fallback: 'https://app.example.test/plan' },
  })
}

interface Recorded { table: string; filters: [string, unknown][]; order: string | null; limit: number | null }

function fakeDb(result: { data: unknown; error: { message: string } | null } | 'throw') {
  const rec: Recorded = { table: '', filters: [], order: null, limit: null }
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = (c: string, v: unknown) => { rec.filters.push([c, v]); return chain }
  chain.order = (c: string) => { rec.order = c; return chain }
  chain.limit = async (n: number) => {
    rec.limit = n
    if (result === 'throw') throw new Error('连接断了')
    return result
  }
  // 假库只实现被测代码真会调用的链式方法（已跑：下面每条用例都走过它），仓库里其它测试同款写法
  const supabase = { from: (t: string) => { rec.table = t; return chain } } as unknown as SupabaseClient
  return { supabase, rec }
}

describe('loadTrackingGateFacts · 给推广计划检查清单读最近一份回执', () => {
  it('客户没配置追踪检查 → undefined（清单里不出现追踪门），而且一次库都不读', async () => {
    // 一碰就炸的假库：证明没配置的客户一次库都不读（已跑：这条用例会在被测代码读库时直接红）
    const supabase = { from: () => { throw new Error('不该读库') } } as unknown as SupabaseClient
    await expect(loadTrackingGateFacts(supabase, 'stranger')).resolves.toBeUndefined()
  })

  it('配置了、最近的运行记录里有这个客户的回执 → 带回时间和各道门', async () => {
    const run = buildRunReceipt({ requestId: 'run', checkedAt: AT, trigger: 'cron', clients: [receiptFor('c1')] })
    const { supabase, rec } = fakeDb({ data: [{ status: 'completed', started_at: AT, summary: run }], error: null })

    const out = await loadTrackingGateFacts(supabase, 'c1')

    expect(out?.receipt?.checked_at).toBe(AT)
    expect(out?.receipt?.gates.map(g => g.key)).toEqual(['tracking.pixel_alive'])
    expect(rec.table).toBe('cron_run_logs')
    expect(rec.filters).toContainEqual(['job_name', TRACKING_PREFLIGHT_JOB])
    expect(rec.order).toBe('started_at')
    expect(rec.limit).toBeGreaterThanOrEqual(10)
  })

  it('配置了但最近的运行里没有这个客户 → receipt 为 null（全灰），不是 undefined', async () => {
    const run = buildRunReceipt({ requestId: 'run', checkedAt: AT, trigger: 'cron', clients: [receiptFor('other')] })
    const { supabase } = fakeDb({ data: [{ status: 'completed', started_at: AT, summary: run }], error: null })
    await expect(loadTrackingGateFacts(supabase, 'c1')).resolves.toEqual({ receipt: null })
  })

  // 🔴 审查整改：开投后读回的回执和体检写在同一个任务名下，不挑阶段会让看板十道门全灰
  const postRunFor = (clientId: string, checkedAt: string) => buildRunReceipt({
    requestId: 'run-post', checkedAt, trigger: 'postlaunch',
    clients: [buildClientReceipt({
      requestId: `r-post-${clientId}`, clientId, checkedAt, trigger: 'postlaunch', phase: 'post_t1h', launchedAt: AT,
      gates: [{ key: 'post.t1h', status: 'green', reason: 'ok', how: '', evidence: {}, as_of: checkedAt, hard: HARD_GATE['post.t1h'] }],
      readErrors: [], links: { fallback: 'https://app.example.test/plan' },
    })],
  })

  it('更新的一轮是开投后读回（只有 post.t1h 一道门）→ 仍读更早的开投前回执，不被读回顶掉', async () => {
    const pre = buildRunReceipt({ requestId: 'run-pre', checkedAt: AT, trigger: 'cron', clients: [receiptFor('c1')] })
    const laterAt = '2026-10-19T09:30:00.000Z'
    const { supabase } = fakeDb({
      data: [
        { status: 'completed', started_at: laterAt, summary: postRunFor('c1', laterAt) },
        { status: 'completed', started_at: AT, summary: pre },
      ],
      error: null,
    })
    const out = await loadTrackingGateFacts(supabase, 'c1')
    expect(out?.receipt?.checked_at).toBe(AT)
    expect(out?.receipt?.gates.map(g => g.key)).toEqual(['tracking.pixel_alive'])
  })

  it('最近几轮里只有开投后读回 → receipt 为 null（全灰），不拿读回当体检', async () => {
    const { supabase } = fakeDb({ data: [{ status: 'completed', started_at: AT, summary: postRunFor('c1', AT) }], error: null })
    await expect(loadTrackingGateFacts(supabase, 'c1')).resolves.toEqual({ receipt: null })
  })

  it('读库报错 / 直接抛错 → receipt 为 null（读不到就灰，不当成没问题）', async () => {
    await expect(loadTrackingGateFacts(fakeDb({ data: null, error: { message: 'boom' } }).supabase, 'c1')).resolves.toEqual({ receipt: null })
    await expect(loadTrackingGateFacts(fakeDb('throw').supabase, 'c1')).resolves.toEqual({ receipt: null })
  })
})
