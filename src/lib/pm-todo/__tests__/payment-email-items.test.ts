/**
 * 「邮件确认收到款、但系统没法自动记成交」的待办出口——钉铁律 3 下半：发现不许死在日志里。
 */
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { pushPaymentEmailNeedsHumanItems } from '../payment-email-items'
import { LANE_OF_KIND } from '../five-kinds'
import type { ManualItem } from '../manual-item-types'

type Row = Record<string, unknown>
const NOW = new Date('2026-10-04T20:00:00.000Z')

function fake(rows: Row[]): SupabaseClient {
  const api: Record<string, unknown> = {}
  const self = () => api
  api.select = self
  api.eq = self
  api.gte = self
  api.order = self
  api.limit = () => Promise.resolve({ data: rows, error: null })
  const from = (table: string) => {
    if (table !== 'cron_run_logs') throw new Error(`没建模的表 ${table}`)
    return api
  }
  // 假库只实现被测代码真调用的方法；缺哪个方法用例会抛 TypeError（已跑实测，不会静默通过）。
  return { from } as unknown as SupabaseClient
}

const names = new Map([['c1', { name: '客户甲' }]])

function run(summary: unknown, status = 'completed') {
  const items: ManualItem[] = []
  return pushPaymentEmailNeedsHumanItems(fake([{ summary, started_at: '2026-10-04T18:00:00Z', status }]), items, names, NOW).then(
    () => items,
  )
}

describe('pushPaymentEmailNeedsHumanItems', () => {
  it('有待人工的 → 下发一条，说清原因分布、怎么做、直达链接，不含客人信息', async () => {
    const items = await run({
      payments: {
        ok: true,
        summary: {
          c1: {
            needsHuman: [
              { messageId: 'm1', reason: 'amount_missing' },
              { messageId: 'm2', reason: 'amount_missing' },
              { messageId: 'm3', reason: 'cancel_words_in_thread' },
            ],
          },
        },
      },
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'payment_email_needs_human', client_id: 'c1', client_name: '客户甲' })
    expect(items[0].what).toContain('3 封')
    expect(items[0].what).toContain('邮件里没写金额 2 封')
    expect(items[0].what).toContain('往来里出现了取消/退款字样 1 封')
    expect(items[0].href).toMatch(/^https:\/\//)
    expect(JSON.stringify(items[0])).not.toContain('m1')
  })

  it('没有待人工的 / 识别段没跑 / 失败 → 不下发（失败另有流水线告警）', async () => {
    expect(await run({ payments: { ok: true, summary: { c1: { needsHuman: [] } } } })).toHaveLength(0)
    expect(await run({ nalSync: { ok: true } })).toHaveLength(0)
    expect(await run({ payments: { ok: false, error: 'x' } })).toHaveLength(0)
  })

  it('🔴 流水线别的段失败导致整条记录是 failed，识别段本身的结果仍要下发', async () => {
    const items = await run(
      { payments: { ok: true, summary: { c1: { needsHuman: [{ messageId: 'm1', reason: 'amount_missing' }] } } } },
      'failed',
    )
    expect(items).toHaveLength(1)
  })

  it('最近一次识别段失败 → 不展示更早一次的过期结果', async () => {
    const items: ManualItem[] = []
    const rows = [
      { summary: { payments: { ok: false, error: 'x' } }, started_at: '2026-10-04T18:00:00Z', status: 'failed' },
      { summary: { payments: { ok: true, summary: { c1: { needsHuman: [{ reason: 'amount_missing' }] } } } }, started_at: '2026-10-03T18:00:00Z', status: 'completed' },
    ]
    await pushPaymentEmailNeedsHumanItems(fake(rows), items, names, NOW)
    expect(items).toHaveLength(0)
  })

  it('这个 kind 在五类车道里是 PM 可见栏（不会悄悄消失）', () => {
    expect(LANE_OF_KIND.payment_email_needs_human).toBe('truth')
  })
})
