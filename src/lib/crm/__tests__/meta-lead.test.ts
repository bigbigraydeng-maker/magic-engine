/**
 * Facebook 表单 lead → 联系人 + 触点的测试。
 *
 * 钉住的四件事，每一件错了都会在生产里变成「看不见的漏人」或「弄脏干净的表」：
 *   1. 幂等键 = Meta 的 lead id —— 跟人手导入脚本对齐，回补时不会写出第二份
 *   2. 电话邮箱都不成形就不建人 —— contacts 被垃圾提交灌脏比漏一条 lead 贵得多
 *   3. 归因照实写，拿不到就 NULL —— 自然贴文的表单本来就没有广告
 *      （含素材：ad_id 回查 ad_creative_links，查不到照样 NULL，不猜）
 *   4. 「感兴趣的团」只认问题名带 tour 的自定义问题 —— 不是随便抓第一个自定义答案
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { ingestMetaLead, parseLeadAnswers } from '../meta-lead'
import type { MetaLead } from '@/lib/meta/lead-forms'

const CLIENT = 'client-cts'

const lead = (over: Partial<MetaLead> = {}): MetaLead => ({
  leadId: 'lead-1',
  createdTime: '2026-07-28T04:19:48.000Z',
  formId: 'form-1',
  adId: 'ad1',
  adName: 'Reel A',
  adsetId: 'as1',
  campaignId: 'c1',
  platform: 'fb',
  isOrganic: false,
  answers: [
    { name: 'full_name', value: 'Chris Brown' },
    { name: 'email', value: 'Chris@Example.com' },
    { name: 'phone_number', value: 'p:+6421363598' },
  ],
  ...over,
})

let contactInserts: Record<string, unknown>[]
let touchpointUpserts: Record<string, unknown>[]
let upsertOptions: Record<string, unknown>[]

function mockDb(
  identityHits: { contact_id: string; kind: string; value: string }[] = [],
  /** ad_creative_links 里这条广告对应的片子；null = 这条广告不是 ME 建的。 */
  creativeLinkRow: { creative_ref: string } | null = null,
) {
  contactInserts = []
  touchpointUpserts = []
  upsertOptions = []
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    if (table === 'ad_creative_links') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: () => Promise.resolve({ data: creativeLinkRow, error: null }) }),
            }),
          }),
        }),
      }
    }
    if (table === 'contact_identities') {
      return {
        select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: identityHits }) }) }),
        update: () => ({ in: () => Promise.resolve({ error: null }) }),
        upsert: () => Promise.resolve({ error: null }),
      }
    }
    if (table === 'contacts') {
      return {
        insert: (payload: Record<string, unknown>) => {
          contactInserts.push(payload)
          return {
            select: () => ({ single: () => Promise.resolve({ data: { id: 'person-new' } }) }),
          }
        },
        select: () => ({ in: () => ({ order: () => Promise.resolve({ data: [] }) }) }),
        update: () => ({
          eq: () => Object.assign(Promise.resolve({ error: null }), { is: () => Promise.resolve({ error: null }) }),
        }),
      }
    }
    if (table === 'contact_touchpoints') {
      return {
        update: () => ({ in: () => Promise.resolve({ error: null }) }),
        upsert: (row: Record<string, unknown>, opts: Record<string, unknown>) => {
          touchpointUpserts.push(row)
          upsertOptions.push(opts)
          return Promise.resolve({ error: null })
        },
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('parseLeadAnswers', () => {
  it('标准字段各归各位', () => {
    const p = parseLeadAnswers([
      { name: 'full_name', value: 'Chris Brown' },
      { name: 'email', value: 'chris@example.com' },
      { name: 'phone_number', value: 'p:+6421363598' },
    ])
    expect(p).toMatchObject({
      name: 'Chris Brown',
      email: 'chris@example.com',
      phone: 'p:+6421363598',
    })
  })

  it('没有 full_name 时用 first + last 拼', () => {
    const p = parseLeadAnswers([
      { name: 'first_name', value: 'Chris' },
      { name: 'last_name', value: 'Brown' },
    ])
    expect(p.name).toBe('Chris Brown')
  })

  it('「感兴趣的团」只认问题名带 tour 的', () => {
    const p = parseLeadAnswers([
      { name: 'which_tour_interests_you_most?', value: 'Best of China' },
      { name: 'budget', value: '$5000' },
    ])
    expect(p.tourInterest).toBe('Best of China')
    expect(p.custom).toEqual({
      'which_tour_interests_you_most?': 'Best of China',
      budget: '$5000',
    })
  })

  it('没有 tour 问题就留空 —— 不拿别的自定义答案冒充', () => {
    const p = parseLeadAnswers([{ name: 'budget', value: '$5000' }])
    expect(p.tourInterest).toBeNull()
    expect(p.custom).toEqual({ budget: '$5000' })
  })

  it('空值不占位', () => {
    const p = parseLeadAnswers([
      { name: 'email', value: '   ' },
      { name: '', value: 'x' },
    ])
    expect(p.email).toBeNull()
    expect(p.custom).toEqual({})
  })
})

describe('ingestMetaLead', () => {
  it('新 lead 建人 + 写一条 inbound 触点', async () => {
    mockDb()
    const res = await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(res).toMatchObject({ contactId: 'person-new', createdContact: true, skipped: null })
    expect(contactInserts).toHaveLength(1)
    expect(contactInserts[0]).toMatchObject({
      primary_phone: '+6421363598',
      primary_email: 'chris@example.com',
      display_name: 'Chris Brown',
    })

    expect(touchpointUpserts).toHaveLength(1)
    expect(touchpointUpserts[0]).toMatchObject({
      channel: 'meta_lead_form',
      direction: 'inbound',
      occurred_at: '2026-07-28T04:19:48.000Z',
      source: 'meta_lead_form',
      attr_platform: 'meta',
      attr_ad_id: 'ad1',
    })
  })

  it('幂等键就是 Meta 的 lead id —— 跟人手导入脚本对齐，回补不会写第二份', async () => {
    mockDb()
    await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(touchpointUpserts[0].source_ref).toBe('lead-1')
    expect(upsertOptions[0]).toMatchObject({
      onConflict: 'client_id,source,source_ref',
      ignoreDuplicates: true,
    })
  })

  it('电话邮箱都不成形 → 不建人（不能让垃圾提交灌脏 contacts）', async () => {
    mockDb()
    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: lead({ answers: [{ name: 'full_name', value: '张三' }] }),
    })

    expect(res).toMatchObject({ contactId: null, createdContact: false, skipped: 'no_identity' })
    expect(contactInserts).toEqual([])
    expect(touchpointUpserts).toEqual([])
  })

  it('自然贴文的表单：platform 仍是 meta，广告字段照实留 NULL', async () => {
    mockDb()
    await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: lead({ adId: null, adName: null, adsetId: null, campaignId: null, isOrganic: true }),
    })

    expect(touchpointUpserts[0]).toMatchObject({
      attr_platform: 'meta',
      attr_ad_id: null,
      attr_campaign_id: null,
    })
    expect((touchpointUpserts[0].metadata as Record<string, unknown>).is_organic).toBe(true)
  })

  /**
   * 断链闭合的最后一跳：Meta 的 lead 接口不给 creative id，只能拿 ad_id 回查 ME 在
   * 建广告那一刻记下的对应关系。这条钉住「查到了就写进人和触点两处」。
   */
  it('拿 ad_id 回查得到片子 → 人和触点两处都写上 attr_creative_ref', async () => {
    mockDb([], { creative_ref: 'wo-1' })
    await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(touchpointUpserts[0]).toMatchObject({ attr_ad_id: 'ad1', attr_creative_ref: 'wo-1' })
    expect(contactInserts[0]).toMatchObject({ attr_creative_ref: 'wo-1' })
  })

  /** 这条广告不是 ME 建的（或者建的时候就没认出片子）→ 照实留白，绝不拿别的片子顶上。 */
  it('回查不到片子 → attr_creative_ref 留 NULL', async () => {
    mockDb([], null)
    await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(touchpointUpserts[0]).toMatchObject({ attr_ad_id: 'ad1', attr_creative_ref: null })
  })

  it('「感兴趣的团」进 metadata.tour_interest_raw（CRM 横表那一列读它）', async () => {
    mockDb()
    await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: lead({
        answers: [
          { name: 'email', value: 'chris@example.com' },
          { name: 'which_tour_interests_you_most?', value: 'Best of China' },
        ],
      }),
    })

    const row = touchpointUpserts[0]
    expect((row.metadata as Record<string, unknown>).tour_interest_raw).toBe('Best of China')
    expect(row.summary).toBe('填了 Facebook 表单 · Best of China')
  })

  it('AU 客户的本地号码补 +61，不是 +64', async () => {
    mockDb()
    await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'AU',
      lead: lead({
        answers: [{ name: 'phone_number', value: '0412 345 678' }],
      }),
    })
    expect(contactInserts[0].primary_phone).toBe('+61412345678')
  })

  it('单条炸掉不抛异常，如实回报 error（一条脏 lead 不能停掉整批）', async () => {
    mockDb()
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('db down')
    })

    const res = await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })
    expect(res).toMatchObject({ contactId: null, skipped: 'error' })
  })
})
