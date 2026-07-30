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
vi.mock('@/lib/meta/token-manager', () => ({
  getStoredPageToken: vi.fn(),
  getMetaTokenForClient: vi.fn(),
}))
vi.mock('@/lib/meta/page-posts', () => ({ getPageAccessToken: vi.fn() }))
vi.mock('@/lib/meta/lead-forms', () => ({
  fetchPageLeadForms: vi.fn(),
  fetchFormLeads: vi.fn(),
}))
vi.mock('@/lib/crm/meta-lead', () => ({ ingestMetaLead: vi.fn() }))

import { supabaseAdmin } from '@/lib/supabase'
import { getStoredPageToken } from '@/lib/meta/token-manager'
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
  mock(getStoredPageToken).mockResolvedValue('page-token')
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
