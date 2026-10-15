/**
 * 今日待办里的「推广计划每日检查」：读每日函数留下的回执，不自己现算。
 * 假的 cron_run_logs；只读（假库没有任何写方法，调用就会抛错）。
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from '../manual-item-types'
import { buildPromoPlanWatchItems, isWatchReceiptLike, pushPromoPlanWatchItems } from '../promo-plan-watch-items'
import { PROMO_WATCH_JOB, type WatchReceipt, type WatchReceiptItem } from '@/lib/marketing-plan/promo/daily-watch-run'
import { PROMO_WATCH_CRON } from '@/lib/inngest/functions/promo-plan-daily-watch'
import { CRON_REGISTRY } from '@/lib/cron/registry'
import { LANE_OF_KIND } from '../five-kinds'
import { NEVER_DROP_KINDS } from '../manual-item-types'

const nameOf = (id: string) => (id === 'c1' ? '客户甲' : '未知客户')
const NOW = new Date('2026-10-14T01:00:00Z') // 周三（UTC）

const item = (over: Partial<WatchReceiptItem> = {}): WatchReceiptItem => ({
  client_id: 'c1', plan_id: 'p1', code: 'draft_ready_to_approve', what: '计划已经排好，等你批准。', how: '打开推广计划页，点「批准计划」。', ...over,
})
const receipt = (over: Partial<WatchReceipt> = {}): WatchReceipt => ({
  request_id: 'r1', checked_at: '2026-10-14T00:10:00Z', status: 'ok', error: null, no_publish: true,
  plans_checked: 1, plans_with_findings: 0, plans: [], items: [], ...over,
})

interface Row { status: string | null; started_at: string; error_message: string | null; summary: unknown }
function fakeSupabase(rows: Row[] | null, queryError: string | null = null): SupabaseClient {
  const chain: Record<string, unknown> = {}
  chain.select = () => chain
  chain.eq = () => chain
  chain.gte = () => chain
  chain.order = () => chain
  chain.limit = async () => (queryError ? { data: null, error: { message: queryError } } : { data: rows, error: null })
  return { from: (t: string) => { if (t !== 'cron_run_logs') throw new Error(`不该读这张表：${t}`); return chain } } as unknown as SupabaseClient
}
const run = async (rows: Row[] | null, err: string | null = null): Promise<ManualItem[]> => {
  const items: ManualItem[] = []
  await pushPromoPlanWatchItems(fakeSupabase(rows, err), items, nameOf, NOW)
  return items
}
const okRow = (r: WatchReceipt, startedAt = '2026-10-14T00:10:00Z', status = 'success'): Row => ({ status, started_at: startedAt, error_message: null, summary: r })

describe('每日检查自己没跑成时，一定要出声（不能静默）', () => {
  it('读不到运行记录 → 一条开发欠账待办', async () => {
    const out = await run(null, '连不上库')
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('promo_plan_watch_broken')
    expect(out[0].what).toContain('查不到')
  })
  it('两周内一条运行记录都没有 → 出声（多半没同步）', async () => {
    const out = await run([])
    expect(out[0].kind).toBe('promo_plan_watch_broken')
    expect(out[0].what).toContain('没有任何运行记录')
  })
  it('最近一轮超过 36 小时 → 出声', async () => {
    const out = await run([okRow(receipt(), '2026-10-12T00:10:00Z')])
    expect(out[0].kind).toBe('promo_plan_watch_broken')
    expect(out[0].what).toContain('超过一天没跑')
  })
  it('最近一轮失败 → 出声并带原因', async () => {
    const out = await run([{ status: 'failed', started_at: '2026-10-14T00:10:00Z', error_message: '重试耗尽后仍失败：boom', summary: null }])
    expect(out[0].what).toContain('boom')
  })
  it('卡在 running 超过 2 小时 → 出声；2 小时内不吵', async () => {
    expect((await run([{ status: 'running', started_at: '2026-10-13T20:00:00Z', error_message: null, summary: null }]))[0].what).toContain('没收尾')
    expect(await run([{ status: 'running', started_at: '2026-10-14T00:30:00Z', error_message: null, summary: null }])).toEqual([])
  })
  it('回执格式不对 → 出声', async () => {
    const out = await run([{ status: 'success', started_at: '2026-10-14T00:10:00Z', error_message: null, summary: { hello: 1 } }])
    expect(out[0].what).toContain('读不出来')
  })
  it('回执说读不到计划列表 → 出一条 infra 的欠账，且不假装没事', async () => {
    const out = await run([okRow(receipt({ status: 'read_failed', error: '库挂了', plans_checked: 0 }))])
    expect(out).toHaveLength(1)
    expect(out[0].client_id).toBe('infra')
    expect(out[0].what).toContain('读不到计划列表')
  })
  it('某份计划算失败 → 出一条带客户名和链接的欠账，别的计划不受影响', async () => {
    const r = receipt({
      status: 'partial', plans_with_findings: 1,
      plans: [
        { client_id: 'c1', plan_id: 'p1', title: '甲的计划', plan_status: 'approved', findings: [], error: '读库超时' },
        { client_id: 'c1', plan_id: 'p2', title: '乙的计划', plan_status: 'draft', findings: ['draft_ready_to_approve'], error: null },
      ],
      items: [item({ plan_id: 'p2' })],
    })
    const out = await run([okRow(r)])
    const broken = out.filter(i => i.kind === 'promo_plan_watch_broken')
    expect(broken).toHaveLength(1)
    expect(broken[0].client_name).toBe('客户甲')
    expect(broken[0].href).toContain('/dashboard/clients/c1/promo-plan')
    expect(out.filter(i => i.kind === 'promo_plan_watch')).toHaveLength(1)
  })
})

describe('正常下发', () => {
  it('回执里没有发现 → 0 条（没事不出声）', async () => {
    expect(await run([okRow(receipt())])).toEqual([])
  })
  it('一份计划多条发现合成一条待办，带客户名和直达链接', async () => {
    const out = await run([okRow(receipt({ items: [item(), item({ code: 'phase_gate_failed', what: '马上要开始的阶段有检查没过。', how: '先在广告设置里确认账户状态。' })] }))])
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe('promo_plan_watch')
    expect(out[0].client_name).toBe('客户甲')
    expect(out[0].what).toContain('等你批准')
    expect(out[0].what).toContain('检查没过')
    expect(out[0].how).toContain('批准计划')
    expect(out[0].href).toBe('https://app.magicengine.com.au/dashboard/clients/c1/promo-plan')
  })
  it('两份计划各出一条', async () => {
    const out = await run([okRow(receipt({ items: [item(), item({ plan_id: 'p2', client_id: 'c2' })] }))])
    expect(out).toHaveLength(2)
  })
})

describe('同一件事连着出现：前 3 天每天提醒，之后只在周日', () => {
  const days = (start: string, n: number) => Array.from({ length: n }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) - i * 86_400_000).toISOString().slice(0, 10))
  const same = (n: number) => Array.from({ length: n }, () => receipt({ items: [item()] }))

  it('连续第 3 天仍然提醒，并写明已连续几天', () => {
    const out = buildPromoPlanWatchItems(same(3), days('2026-10-14', 3), nameOf, NOW)
    expect(out).toHaveLength(1)
    expect(out[0].what).toContain('连续 3 天')
  })
  it('连续第 4 天（周三）不再提醒', () => {
    expect(buildPromoPlanWatchItems(same(4), days('2026-10-14', 4), nameOf, NOW)).toEqual([])
  })
  it('连续第 4 天但今天是周日 → 提醒', () => {
    const sunday = new Date('2026-10-18T01:00:00Z')
    expect(buildPromoPlanWatchItems(same(4), days('2026-10-18', 4), nameOf, sunday)).toHaveLength(1)
  })
  it('中间隔了一天（昨天没出现）→ 从今天重新数，当作第 1 天', () => {
    const rs = [receipt({ items: [item()] }), receipt(), receipt({ items: [item()] })]
    const out = buildPromoPlanWatchItems(rs, ['2026-10-14', '2026-10-13', '2026-10-12'], nameOf, NOW)
    expect(out).toHaveLength(1)
    expect(out[0].what).not.toContain('连续')
  })
})

describe('读不到每日计划是我们这边的欠账，不进 PM 的清单', () => {
  it('daily_plan_unreadable 走 promo_plan_watch_broken，不并进 promo_plan_watch', async () => {
    const out = await run([okRow(receipt({ items: [
      item(),
      item({ code: 'daily_plan_unreadable', what: '每日计划这次读不出来，没法核对条数。', how: '这条不用你动手，是我们这边的欠账。' }),
    ] }))])
    expect(out.filter(i => i.kind === 'promo_plan_watch')).toHaveLength(1)
    const broken = out.filter(i => i.kind === 'promo_plan_watch_broken')
    expect(broken).toHaveLength(1)
    expect(broken[0].what).toContain('读不出来')
    expect(out.find(i => i.kind === 'promo_plan_watch')?.what).not.toContain('读不出来')
  })
})

describe('登记与护栏', () => {
  it('两种待办都登记了车道：要 PM 拍板的进 decide，检查自己没跑成的进 dev；都不会被探活丢掉', () => {
    expect(LANE_OF_KIND.promo_plan_watch).toBe('decide')
    expect(LANE_OF_KIND.promo_plan_watch_broken).toBe('dev')
    expect(NEVER_DROP_KINDS.has('promo_plan_watch')).toBe(true)
    expect(NEVER_DROP_KINDS.has('promo_plan_watch_broken')).toBe(true)
  })
  it('定时登记表里的时间 = 函数里的时间（不许手抄漂移）', () => {
    const entry = CRON_REGISTRY.find(e => e.jobName === PROMO_WATCH_JOB)
    expect(entry?.schedule).toBe(PROMO_WATCH_CRON)
    expect(entry?.scheduler).toBe('inngest')
  })
  it('回执校验：缺字段的不认', () => {
    expect(isWatchReceiptLike(receipt())).toBe(true)
    expect(isWatchReceiptLike({ status: 'ok', plans: [], items: [{ client_id: 'c1' }] })).toBe(false)
    expect(isWatchReceiptLike(null)).toBe(false)
  })
})
