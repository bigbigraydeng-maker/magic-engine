/**
 * 表单同步编排层的测试。
 *
 * 钉住的都是「跑了等于没跑」的失败模式：
 *   · 缺 leads_retrieval 权限 → 必须报错，不能长得像「今天没人填表」
 *   · 一个表单炸掉 → 剩下的表单还得继续跑（防护 C）
 *   · 水位线要从库里最新一条表单触点算，并且往回多留一天
 *   · 第一次跑不能把几年的历史全拉一遍
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
// 主页是不是这个客户的、用哪把令牌 —— 由同步闸判定（规则测试在 page-sync-authorization.test.ts）。
vi.mock('@/lib/meta/page-sync-authorization', () => ({ authorizePageSync: vi.fn() }))
vi.mock('@/lib/meta/lead-forms', () => ({
  fetchPageLeadForms: vi.fn(),
  fetchFormLeads: vi.fn(),
}))
vi.mock('@/lib/crm/meta-lead', () => ({ ingestMetaLead: vi.fn() }))

import { supabaseAdmin } from '@/lib/supabase'
import { authorizePageSync } from '@/lib/meta/page-sync-authorization'
import { fetchFormLeads, fetchPageLeadForms, type MetaLead } from '@/lib/meta/lead-forms'
import { ingestMetaLead } from '@/lib/crm/meta-lead'
import { getLeadWatermark, resolveDefaultCountry, syncClientMetaLeads } from '../leads-sync'

const CLIENT = {
  id: 'client-cts',
  name: 'CTS Tours NZ',
  facebook_page_id: 'page-1',
  country: 'NZ',
  semrush_db: 'nz',
}

const mock = <T>(fn: T) => fn as unknown as ReturnType<typeof vi.fn>

/** contact_touchpoints 的水位线查询 —— 返回给定的最新一条 occurred_at。 */
function mockWatermark(newest: string | null) {
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          order: () => ({
            limit: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: newest ? { occurred_at: newest } : null }),
            }),
          }),
        }),
      }),
    }),
  }))
}

const lead = (id: string): MetaLead => ({
  leadId: id,
  createdTime: '2026-07-28T04:19:48.000Z',
  formId: 'f1',
  adId: null,
  adName: null,
  adsetId: null,
  campaignId: null,
  platform: null,
  isOrganic: null,
  answers: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  mockWatermark('2026-07-25T11:48:46.000Z')
  mock(authorizePageSync).mockResolvedValue({ ok: true, pageToken: 'page-token', via: 'client_oauth' })
  mock(ingestMetaLead).mockResolvedValue({
    contactId: 'c1',
    createdContact: true,
    skipped: null,
  })
})

describe('resolveDefaultCountry', () => {
  it('NZ 客户补 +64', () => {
    expect(resolveDefaultCountry({ country: 'NZ', semrush_db: null })).toBe('NZ')
    expect(resolveDefaultCountry({ country: null, semrush_db: 'nz' })).toBe('NZ')
  })
  it('其余按 AU', () => {
    expect(resolveDefaultCountry({ country: 'AU', semrush_db: 'au' })).toBe('AU')
    expect(resolveDefaultCountry({ country: null, semrush_db: null })).toBe('AU')
  })
})

describe('getLeadWatermark', () => {
  const NOW = new Date('2026-07-30T00:00:00Z')

  it('用库里最新一条表单触点往回留一天（Meta 侧偶有延迟入库）', async () => {
    mockWatermark('2026-07-25T12:00:00.000Z')
    const since = await getLeadWatermark('client-cts', NOW)
    expect(since.toISOString()).toBe('2026-07-24T12:00:00.000Z')
  })

  it('第一次跑往回补 30 天，不是把历史全拉一遍', async () => {
    mockWatermark(null)
    const since = await getLeadWatermark('client-cts', NOW)
    expect(since.toISOString()).toBe('2026-06-30T00:00:00.000Z')
  })

  it('水位线再老也不往回超过 90 天', async () => {
    mockWatermark('2020-01-01T00:00:00.000Z')
    const since = await getLeadWatermark('client-cts', NOW)
    expect(since.toISOString()).toBe('2026-05-01T00:00:00.000Z')
  })
})

describe('syncClientMetaLeads', () => {
  it('AD-SEC-4：主页没核实是这个客户的 → 一个表单都不读，并记成 error 让定时任务算失败', async () => {
    mock(authorizePageSync).mockResolvedValue({ ok: false, skipped: 'page_not_verified', reason: 'bound_to_other_client' })

    const res = await syncClientMetaLeads(CLIENT)

    expect(mock(authorizePageSync)).toHaveBeenCalledWith(expect.anything(), CLIENT.id, CLIENT.facebook_page_id, expect.anything())
    expect(res.skipped).toBe('page_not_verified')
    expect(res.error).toContain('bound_to_other_client')
    expect(mock(fetchPageLeadForms)).not.toHaveBeenCalled()
    expect(mock(fetchFormLeads)).not.toHaveBeenCalled()
  })

  it('用同步闸交回来的那把主页令牌读表单', async () => {
    mock(fetchPageLeadForms).mockResolvedValue({ rows: [], error: null })

    await syncClientMetaLeads(CLIENT)

    expect(mock(fetchPageLeadForms)).toHaveBeenCalledWith(CLIENT.facebook_page_id, 'page-token')
  })

  it('正常路径：拉到的 lead 逐条接进 CRM 并计数', async () => {
    mock(fetchPageLeadForms).mockResolvedValue({
      rows: [{ formId: 'f1', name: '表单一', status: 'ACTIVE' }],
      error: null,
    })
    mock(fetchFormLeads).mockResolvedValue({ rows: [lead('l1'), lead('l2')], error: null })

    const res = await syncClientMetaLeads(CLIENT)
    expect(res).toMatchObject({
      forms: 1,
      leadsFetched: 2,
      leadsIngested: 2,
      newContacts: 2,
      failed: 0,
    })
    expect(res.error).toBeUndefined()
  })

  it('缺 leads_retrieval 权限时如实报错 —— 不能长得像「今天没人填表」', async () => {
    mock(fetchPageLeadForms).mockResolvedValue({
      rows: [],
      error: 'leadgen_forms HTTP 403: (#278) Requires leads_retrieval permission',
    })

    const res = await syncClientMetaLeads(CLIENT)
    expect(res.error).toContain('leads_retrieval')
    expect(res.leadsFetched).toBe(0)
    expect(mock(fetchFormLeads)).not.toHaveBeenCalled()
  })

  it('一个表单炸掉，剩下的表单继续跑', async () => {
    mock(fetchPageLeadForms).mockResolvedValue({
      rows: [
        { formId: 'bad', name: null, status: null },
        { formId: 'good', name: null, status: null },
      ],
      error: null,
    })
    mock(fetchFormLeads).mockImplementation(async (formId: string) => {
      if (formId === 'bad') throw new Error('boom')
      return { rows: [lead('l1')], error: null }
    })

    const res = await syncClientMetaLeads(CLIENT)
    expect(res.forms).toBe(2)
    expect(res.leadsIngested).toBe(1)
    expect(res.failed).toBe(1)
    expect(res.error).toContain('bad')
  })

  it('认不出联系方式的 lead 单独计数，不算失败也不算接上', async () => {
    mock(fetchPageLeadForms).mockResolvedValue({
      rows: [{ formId: 'f1', name: null, status: null }],
      error: null,
    })
    mock(fetchFormLeads).mockResolvedValue({ rows: [lead('l1')], error: null })
    mock(ingestMetaLead).mockResolvedValue({
      contactId: null,
      createdContact: false,
      skipped: 'no_identity',
    })

    const res = await syncClientMetaLeads(CLIENT)
    expect(res).toMatchObject({ leadsIngested: 0, skippedNoIdentity: 1, failed: 0 })
  })

  it('没连主页的客户直接跳过', async () => {
    const res = await syncClientMetaLeads({ ...CLIENT, facebook_page_id: null })
    expect(res.skipped).toBe('no_page_id')
  })
})

/**
 * Mailchimp 出口的结果必须被记账。
 *
 * 在此之前这一层把 `ingestMetaLead` 返回的 `mailchimp` **整个丢掉** —— 不计数、
 * 不上报。所以 2026-08~09 生产上「每一条 lead 的邮件出口都因为读不到配置被 skip」
 * 这件事，在 cron 日志里一个字都看不到：`leadsIngested` 照常涨，看起来一切正常。
 * 拿不到数据 ≠ 真没有 —— 跳过了就必须留下痕迹。
 */
describe('Mailchimp 出口结果记账（防第二层静默）', () => {
  beforeEach(() => {
    mock(fetchPageLeadForms).mockResolvedValue({ rows: [{ formId: 'f1', name: 'F1' }], error: null })
    mock(fetchFormLeads).mockResolvedValue({ rows: [lead('l1'), lead('l2'), lead('l3')], error: null })
  })

  it('每条 lead 的出口结果按 status:reason 计数，进 cron summary', async () => {
    mock(ingestMetaLead)
      .mockResolvedValueOnce({
        contactId: 'c1',
        createdContact: true,
        skipped: null,
        mailchimp: { status: 'subscribed' },
      })
      .mockResolvedValueOnce({
        contactId: 'c2',
        createdContact: false,
        skipped: null,
        mailchimp: { status: 'skipped', reason: 'client_config_read_failed' },
      })
      .mockResolvedValueOnce({
        contactId: 'c3',
        createdContact: false,
        skipped: null,
        mailchimp: { status: 'skipped', reason: 'client_config_read_failed' },
      })

    const res = await syncClientMetaLeads(CLIENT)

    expect(res.leadsIngested).toBe(3)
    // 关键：3 条都「进了 CRM」，但其中 2 条根本没进邮件名单 —— 这件事必须看得见
    expect(res.mailchimp).toEqual({
      subscribed: 1,
      'skipped:client_config_read_failed': 2,
    })
  })

  it('failed 也按 reason 分开计，不跟 skipped 混成一个数', async () => {
    mock(ingestMetaLead).mockResolvedValue({
      contactId: 'c1',
      createdContact: false,
      skipped: null,
      mailchimp: { status: 'failed', reason: 'provider_5xx' },
    })

    const res = await syncClientMetaLeads(CLIENT)

    expect(res.mailchimp).toEqual({ 'failed:provider_5xx': 3 })
  })

  it('人在名单里但来源标签没补上 → 单独一个 key，不跟正常的 already_member 混一起', async () => {
    // 混在一起的后果就是 2026-09 那一个月：tally 上全是 already_member，
    // 看起来一切正常，实际广告归因证据一条都没落地。
    mock(ingestMetaLead).mockResolvedValue({
      contactId: 'c1',
      createdContact: false,
      skipped: null,
      mailchimp: { status: 'already_member', tagRepair: 'failed:http_429' },
    })

    const res = await syncClientMetaLeads(CLIENT)

    expect(res.mailchimp).toEqual({ 'already_member:tag_failed:http_429': 3 })
  })

  it('标签补打成功 / 本来就有 → 还是普通 already_member，不制造假警报', async () => {
    mock(ingestMetaLead).mockResolvedValue({
      contactId: 'c1',
      createdContact: false,
      skipped: null,
      mailchimp: { status: 'already_member', tagRepair: 'applied' },
    })

    const res = await syncClientMetaLeads(CLIENT)

    expect(res.mailchimp).toEqual({ already_member: 3 })
  })

  it('没有 lead 走到出口时是空对象，不是缺字段', async () => {
    mock(fetchFormLeads).mockResolvedValue({ rows: [], error: null })

    const res = await syncClientMetaLeads(CLIENT)

    expect(res.mailchimp).toEqual({})
  })
})
