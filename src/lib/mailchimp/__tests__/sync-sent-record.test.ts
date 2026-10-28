/**
 * 「我们发出了这封邮件」记录：只记配置里标题前缀匹配的邮件 · 只记已认出的客人 ·
 * 退信不写成已送达 · 出错只记一笔不拖垮原有打开/点击记录 · 没配置时一个字都不多调。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  listSentCampaigns: vi.fn(),
  getCampaignActivity: vi.fn(),
  getCampaignRecipients: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('../client', () => ({
  listSentCampaigns: mocks.listSentCampaigns,
  getCampaignActivity: mocks.getCampaignActivity,
  getCampaignRecipients: mocks.getCampaignRecipients,
}))

import { readSentRecordConfig, syncMailchimpActivity } from '../sync'

const CLIENT = 'client-1'
const camp = (id: string, title: string) => ({
  id,
  title,
  subject: `Subject of ${title}`,
  sentAt: '2026-10-28T19:02:00Z',
  emailsSent: 2,
  opens: 0,
  uniqueOpens: 0,
  clicks: 0,
  openRate: 0,
  clickRate: 0,
})

let upserts: Array<{ rows: Record<string, unknown>[]; opts: unknown }>
let upsertError: string | null

function stubDb() {
  upserts = []
  mocks.from.mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {}
    const self = () => chain
    for (const m of ['select', 'eq', 'order', 'neq']) chain[m] = self
    if (table === 'contacts') {
      chain.range = () =>
        Promise.resolve({ data: [{ id: 'c1', primary_email: 'a@example.com' }, { id: 'c2', primary_email: 'b@example.com' }], error: null })
    } else if (table === 'contact_identities') {
      chain.range = () => Promise.resolve({ data: [], error: null })
    } else if (table === 'contact_touchpoints') {
      chain.upsert = (rows: Record<string, unknown>[], opts: unknown) => {
        upserts.push({ rows, opts })
        return {
          select: () =>
            Promise.resolve(
              upsertError ? { data: null, error: { message: upsertError } } : { data: rows.map((_, i) => ({ id: `t${i}` })), error: null },
            ),
        }
      }
      chain.update = () => chain
    } else throw new Error(`unexpected table ${table}`)
    return chain
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  upsertError = null
  stubDb()
  mocks.getCampaignActivity.mockResolvedValue([])
})

describe('readSentRecordConfig', () => {
  it('is off by default and when prefixes are empty or malformed', () => {
    expect(readSentRecordConfig(null)).toBeNull()
    expect(readSentRecordConfig({})).toBeNull()
    expect(readSentRecordConfig({ mailchimp_sent_record: { title_prefixes: [] } })).toBeNull()
    expect(readSentRecordConfig({ mailchimp_sent_record: { title_prefixes: [1, ' '] } })).toBeNull()
  })
  it('reads the prefixes', () => {
    expect(readSentRecordConfig({ mailchimp_sent_record: { title_prefixes: ['auto_'] } })).toEqual({ titlePrefixes: ['auto_'] })
  })
})

describe('syncMailchimpActivity · sent record', () => {
  it('without config never asks Mailchimp for recipients and writes nothing', async () => {
    mocks.listSentCampaigns.mockResolvedValue([camp('k1', 'auto_e1_batch_20261028')])
    const r = await syncMailchimpActivity({ clientId: CLIENT, apiKey: 'k' })
    expect(mocks.getCampaignRecipients).not.toHaveBeenCalled()
    expect(upserts).toHaveLength(0)
    expect(r).toMatchObject({ sentRecorded: 0, sentUnmatched: 0, sentErrors: 0, sentSkippedBudget: 0 })
  })

  it('records an automated outbound row per known recipient, with a :sent ref and no new contacts', async () => {
    mocks.listSentCampaigns.mockResolvedValue([camp('k1', 'auto_e1_batch_20261028')])
    mocks.getCampaignRecipients.mockResolvedValue([
      { email: 'a@example.com', status: 'sent' },
      { email: 'stranger@example.com', status: 'sent' },
    ])
    const r = await syncMailchimpActivity({ clientId: CLIENT, apiKey: 'k', sentRecord: { titlePrefixes: ['auto_'] } })
    expect(r).toMatchObject({ sentRecorded: 1, sentUnmatched: 1, sentErrors: 0 })
    const row = upserts[0].rows[0]
    expect(row).toMatchObject({
      contact_id: 'c1',
      direction: 'outbound',
      channel: 'email',
      source: 'mailchimp',
      source_ref: 'k1:c1:sent',
      occurred_at: '2026-10-28T19:02:00Z',
      summary: '发出《Subject of auto_e1_batch_20261028》',
    })
    expect(row.metadata).toMatchObject({ kind: 'sent', automated: true, email_campaign_title: 'auto_e1_batch_20261028', email_send_status: 'sent' })
    expect(upserts[0].opts).toMatchObject({ ignoreDuplicates: true })
  })

  it('only records campaigns whose title starts with a configured prefix', async () => {
    mocks.listSentCampaigns.mockResolvedValue([camp('k1', 'Spring 2027 newsletter')])
    await syncMailchimpActivity({ clientId: CLIENT, apiKey: 'k', sentRecord: { titlePrefixes: ['auto_'] } })
    expect(mocks.getCampaignRecipients).not.toHaveBeenCalled()
  })

  it('never writes a bounce as delivered', async () => {
    mocks.listSentCampaigns.mockResolvedValue([camp('k1', 'auto_x')])
    mocks.getCampaignRecipients.mockResolvedValue([
      { email: 'a@example.com', status: 'hard' },
      { email: 'b@example.com', status: 'soft' },
    ])
    await syncMailchimpActivity({ clientId: CLIENT, apiKey: 'k', sentRecord: { titlePrefixes: ['auto_'] } })
    expect(upserts[0].rows.map((r) => r.summary)).toEqual([
      '《Subject of auto_x》退回（地址无效）',
      '《Subject of auto_x》暂时没送达',
    ])
  })

  it('a failing sent-record read is counted but does not throw or stop the sync', async () => {
    mocks.listSentCampaigns.mockResolvedValue([camp('k1', 'auto_a'), camp('k2', 'auto_b')])
    mocks.getCampaignRecipients.mockRejectedValueOnce(new Error('429')).mockResolvedValueOnce([{ email: 'a@example.com', status: 'sent' }])
    const r = await syncMailchimpActivity({ clientId: CLIENT, apiKey: 'k', sentRecord: { titlePrefixes: ['auto_'] } })
    expect(r).toMatchObject({ sentErrors: 1, sentRecorded: 1, campaigns: 2 })
  })

  it('the prefix must match the START of the title, not appear anywhere in it', async () => {
    mocks.listSentCampaigns.mockResolvedValue([camp('k1', 'x_auto_y')])
    await syncMailchimpActivity({ clientId: CLIENT, apiKey: 'k', sentRecord: { titlePrefixes: ['auto_'] } })
    expect(mocks.getCampaignRecipients).not.toHaveBeenCalled()
  })

  it('a later batch failing still reports the rows an earlier batch already wrote', async () => {
    mocks.listSentCampaigns.mockResolvedValue([camp('k1', 'auto_a')])
    mocks.getCampaignRecipients.mockResolvedValue(Array.from({ length: 600 }, () => ({ email: 'a@example.com', status: 'sent' as const })))
    let n = 0
    // 第一批（500）成功，第二批（100）失败
    const orig = mocks.from.getMockImplementation()!
    mocks.from.mockImplementation((table: string) => {
      const c = orig(table) as Record<string, unknown>
      if (table === 'contact_touchpoints') {
        const up = c.upsert as (rows: Record<string, unknown>[], opts: unknown) => { select: () => Promise<unknown> }
        c.upsert = (rows: Record<string, unknown>[], opts: unknown) => {
          n++
          if (n === 2) return { select: () => Promise.resolve({ data: null, error: { message: 'boom' } }) }
          return up(rows, opts)
        }
      }
      return c
    })
    const r = await syncMailchimpActivity({ clientId: CLIENT, apiKey: 'k', sentRecord: { titlePrefixes: ['auto_'] } })
    expect(r).toMatchObject({ sentErrors: 1, sentRecorded: 500 })
  })

  it('a failing write is counted as an error, not thrown', async () => {
    mocks.listSentCampaigns.mockResolvedValue([camp('k1', 'auto_a')])
    mocks.getCampaignRecipients.mockResolvedValue([{ email: 'a@example.com', status: 'sent' }])
    upsertError = 'boom'
    const r = await syncMailchimpActivity({ clientId: CLIENT, apiKey: 'k', sentRecord: { titlePrefixes: ['auto_'] } })
    expect(r).toMatchObject({ sentErrors: 1, sentRecorded: 0 })
  })

  it('writes in batches of at most 500 rows', async () => {
    mocks.listSentCampaigns.mockResolvedValue([camp('k1', 'auto_a')])
    // 同一客人重复出现 1200 次：只验分批，不验去重
    mocks.getCampaignRecipients.mockResolvedValue(Array.from({ length: 1200 }, () => ({ email: 'a@example.com', status: 'sent' as const })))
    await syncMailchimpActivity({ clientId: CLIENT, apiKey: 'k', sentRecord: { titlePrefixes: ['auto_'] } })
    expect(upserts.map((u) => u.rows.length)).toEqual([500, 500, 200])
  })
})
