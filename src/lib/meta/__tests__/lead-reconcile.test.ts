/**
 * 对账的测试。
 *
 * 钉死的是三个「算出来像真的、其实是假的」的坑：
 *   · 不按层过滤 → 数字正好翻倍（同一份 lead 在 campaign 和 ad 两层各记一遍）
 *   · 结束日当上界直接比 → 最后一整天的人全漏掉
 *   · 查询失败被当成「真没有」→ 造出一条假警报
 */

import { describe, expect, it } from 'vitest'

import {
  findClientsWithUnsyncedLeads,
  isoDay,
  reconcileClientLeads,
} from '../lead-reconcile'
import { makeFakeSupabase } from './fake-supabase'

const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const WINDOW = { from: '2026-06-24', to: '2026-08-08' }

/** 同一天、同一个客户，campaign 和 ad 两层各记一份完整的 lead 数（实测就是这样）。 */
const INSIGHTS = [
  { client_id: OZTOP, level: 'campaign', insight_date: '2026-06-24', leads: 2 },
  { client_id: OZTOP, level: 'ad', insight_date: '2026-06-24', leads: 2 },
  { client_id: OZTOP, level: 'campaign', insight_date: '2026-08-08', leads: 1 },
  { client_id: OZTOP, level: 'ad', insight_date: '2026-08-08', leads: 1 },
  // 窗口外的一天 —— 不该被算进来
  { client_id: OZTOP, level: 'campaign', insight_date: '2026-08-09', leads: 9 },
  // 别的客户 —— 更不该被算进来
  { client_id: 'other', level: 'campaign', insight_date: '2026-07-01', leads: 100 },
]

describe('reconcileClientLeads', () => {
  it('只数 campaign 层 —— 两层都数会让数字正好翻倍', async () => {
    const { client } = makeFakeSupabase({
      ad_daily_insights: { rows: INSIGHTS },
      contact_touchpoints: { rows: [] },
    })

    const r = await reconcileClientLeads(client, OZTOP, WINDOW)
    expect(r.adsReportedLeads).toBe(3)
    expect(r.gap).toBe(3)
  })

  it('结束日当天的触点要算进来（含当天）', async () => {
    const { client } = makeFakeSupabase({
      ad_daily_insights: { rows: INSIGHTS },
      contact_touchpoints: {
        rows: [
          // 结束日的傍晚 —— 上界写成 `to` 本身的话这条会被漏掉
          {
            client_id: OZTOP,
            channel: 'meta_lead_form',
            occurred_at: '2026-08-08T21:30:00.000Z',
            contact_id: 'p1',
          },
          // 同一个人第二次填表 → 触点算两条，人只算一个
          {
            client_id: OZTOP,
            channel: 'meta_lead_form',
            occurred_at: '2026-06-24T01:00:00.000Z',
            contact_id: 'p1',
          },
          // 别的渠道不算
          {
            client_id: OZTOP,
            channel: 'messenger',
            occurred_at: '2026-07-01T01:00:00.000Z',
            contact_id: 'p2',
          },
          // 窗口外
          {
            client_id: OZTOP,
            channel: 'meta_lead_form',
            occurred_at: '2026-08-09T01:00:00.000Z',
            contact_id: 'p3',
          },
        ],
      },
    })

    const r = await reconcileClientLeads(client, OZTOP, WINDOW)
    expect(r.crmLeadTouchpoints).toBe(2)
    expect(r.crmContacts).toBe(1)
    expect(r.gap).toBe(1)
  })

  it('查询失败时带上 error —— 数字不能被当成事实', async () => {
    const { client } = makeFakeSupabase({
      ad_daily_insights: { rows: [], error: 'column does not exist' },
      contact_touchpoints: { rows: [] },
    })

    const r = await reconcileClientLeads(client, OZTOP, WINDOW)
    expect(r.error).toContain('column does not exist')
    expect(r.adsReportedLeads).toBe(0)
  })
})

describe('findClientsWithUnsyncedLeads', () => {
  const NOW = new Date('2026-08-10T00:00:00Z')

  const clients = [
    { id: OZTOP, name: 'oztop', client_status: 'active' },
    { id: 'healthy', name: 'CTS Tours NZ', client_status: 'active' },
    { id: 'quiet', name: '没投广告的客户', client_status: 'active' },
  ]

  it('只报「广告在收人、CRM 零条」的客户', async () => {
    const { client } = makeFakeSupabase({
      clients: { rows: clients },
      ad_daily_insights: {
        rows: [
          { client_id: OZTOP, level: 'campaign', insight_date: '2026-08-01', leads: 12 },
          { client_id: 'healthy', level: 'campaign', insight_date: '2026-08-01', leads: 5 },
        ],
      },
      contact_touchpoints: {
        rows: [
          {
            client_id: 'healthy',
            channel: 'meta_lead_form',
            occurred_at: '2026-08-01T02:00:00.000Z',
            contact_id: 'c1',
          },
        ],
      },
    })

    const gaps = await findClientsWithUnsyncedLeads(client, NOW)
    expect(gaps.map((g) => g.clientId)).toEqual([OZTOP])
    expect(gaps[0].adsReportedLeads).toBe(12)
    expect(gaps[0].clientName).toBe('oztop')
  })

  it('查不出来 ≠ 一条都没接到 —— 查询失败的客户不报警', async () => {
    const { client } = makeFakeSupabase({
      clients: { rows: clients },
      ad_daily_insights: { rows: [], error: 'boom' },
      contact_touchpoints: { rows: [] },
    })

    expect(await findClientsWithUnsyncedLeads(client, NOW)).toEqual([])
  })
})

describe('isoDay', () => {
  it('给出 insight_date 那种 YYYY-MM-DD', () => {
    expect(isoDay(new Date('2026-08-10T23:59:00Z'))).toBe('2026-08-10')
  })
})
