/**
 * Facebook 表单 lead → 联系人 + 触点 + Mailchimp 出口的测试。
 *
 * 钉住的事，每一件错了都会在生产里变成「看不见的漏人」或「弄脏干净的表」或
 * 「把没同意的人发进 Welcome journey」：
 *   1. 幂等键 = Meta 的 lead id —— 跟人手导入脚本对齐，回补时不会写出第二份
 *   2. 电话邮箱都不成形就不建人 —— contacts 被垃圾提交灌脏比漏一条 lead 贵得多
 *   3. 归因照实写，拿不到就 NULL —— 自然贴文的表单本来就没有广告
 *      （含素材：ad_id 回查 ad_creative_links，查不到照样 NULL，不猜）
 *   4. 「感兴趣的团」只认问题名带 tour 的自定义问题 —— 不是随便抓第一个自定义答案
 *   5. Mailchimp 出口只在**有 provable consent** 时才打 provider（Issue #1188）
 *   6. Provider 失败**不能**把 lead 接入回滚 —— 主管道优先
 *   7. `mailchimp_synced_at` 只在 subscribed / 明确 already_member 时才写
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

vi.mock('@/lib/mailchimp/client', async () => {
  const actual = await vi.importActual<typeof import('@/lib/mailchimp/client')>(
    '@/lib/mailchimp/client',
  )
  return {
    ...actual,
    subscribeMember: vi.fn(),
  }
})

import { supabaseAdmin } from '@/lib/supabase'
import { subscribeMember } from '@/lib/mailchimp/client'
import { DEFAULT_META_LEAD_SOURCE_TAG } from '@/lib/mailchimp/audience-config'
import { ingestMetaLead, parseLeadAnswers } from '../meta-lead'
import type { MetaLead } from '@/lib/meta/lead-forms'

const CLIENT = 'client-cts'
const subscribeMock = subscribeMember as unknown as ReturnType<typeof vi.fn>

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
let contactUpdates: Record<string, unknown>[]
/** Phase C 触点 receipt UPDATE 的 payload —— 每条对应一次 `.update(...)` 调用。 */
let touchpointUpdates: Record<string, unknown>[]
/**
 * subscribeMock 被调用**当时**看到的 (Phase A upserts, Phase B/D updates) 数量。
 * 用来钉「provider 之前一定已经落了触点 + pre-provider evidence UPDATE」。
 */
let providerCallState: Array<{ upserts: number; updates: number }>

interface MockDbOptions {
  identityHits?: { contact_id: string; kind: string; value: string }[]
  /**
   * 这个客户在 `leads_config.meta_leads.source_tag` 里配的来源标签名。
   * 不传 = 没配，代码该落到平台默认值上。
   */
  sourceTag?: string | null
  /** ad_creative_links 里这条广告对应的片子；null = 这条广告不是 ME 建的。 */
  creativeLinkRow?: { creative_ref: string } | null
  /**
   * 这个客户配好的 audience id；null/'' = 未配置。
   *
   * **默认落在 `clients.leads_config.mailchimp_audience_id` 里** —— 那是生产
   * 今天的真实形态：专列 `clients.mailchimp_audience_id` 的 migration
   * (20260826010000) 至今没 apply，对生产库选它会 42703。假件必须照真 schema
   * 建模，否则「查询写错」这类事故测不出来（测试全绿 / 生产全空，正是本次要修的病）。
   */
  audienceId?: string | null
  /**
   * 专列在库里存不存在。默认 `'absent'` = 复刻生产：select 到它整条查询 42703。
   * 传 `'present'` 时 `audienceId` 改放在专列上（模拟 migration apply 之后）。
   */
  dedicatedColumn?: 'absent' | 'present'
  /** 降级读 `leads_config` 那一次也失败（探测「不许把两次失败都吞掉」）。 */
  leadsConfigReadError?: string | null
  /** 真实的读失败（**不是** 42703）——权限被回收 / 网络抖动那一类。 */
  clientReadError?: string | null
  contactUpdateError?: string | null
  /** DNC 判据的输入。默认：do_not_contact=false，触点没有任何 dnc 类记录。 */
  contactDncFlag?: boolean
  /** 触点里已存在的 DNC 类记录（用来测跨渠道拒联）。默认 `[]`。 */
  existingDncTouches?: Array<{ outcome?: string | null; do_not_contact?: boolean; occurred_at: string }>
  /** 读 contacts.do_not_contact 失败；默认 null（成功）。 */
  contactReadError?: string | null
  /** 读 contact_touchpoints 的 select 失败；默认 null（成功）。 */
  touchpointReadError?: string | null
  /**
   * @deprecated 用 preProviderUpdateError / postProviderUpdateError 替代。
   * 保留只为让老用例编译不报错；行为等同 postProviderUpdateError。
   */
  touchpointUpdateError?: string | null
  /**
   * Phase B（pre-provider evidence UPDATE）是否报错。默认 null（成功）。
   * mock 靠 metadata.mailchimp_result.status === 'pending' 识别这次 UPDATE。
   */
  preProviderUpdateError?: string | null
  /**
   * Phase D（post-provider receipt UPDATE）是否报错。默认 null（成功）。
   * mock 靠 metadata.mailchimp_result.status !== 'pending' 识别这次 UPDATE。
   */
  postProviderUpdateError?: string | null
}

function mockDb(opts: MockDbOptions = {}) {
  const {
    identityHits = [],
    sourceTag = null,
    creativeLinkRow = null,
    audienceId = null,
    dedicatedColumn = 'absent',
    leadsConfigReadError = null,
    clientReadError = null,
    contactUpdateError = null,
    contactDncFlag = false,
    existingDncTouches = [],
    contactReadError = null,
    touchpointReadError = null,
    touchpointUpdateError = null,
    preProviderUpdateError = null,
    postProviderUpdateError = null,
  } = opts
  // Legacy alias：旧用例传 touchpointUpdateError 时保持「post-provider 失败」语义。
  const effectivePostErr = postProviderUpdateError ?? touchpointUpdateError
  contactInserts = []
  touchpointUpserts = []
  upsertOptions = []
  contactUpdates = []
  touchpointUpdates = []
  providerCallState = []
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
    if (table === 'clients') {
      // **按表建模，不按调用次序**：看 select 到底点了哪几列，再决定这一次
      // 查询在真库上会发生什么。选到一列库里没有的 → PostgREST 整条 400/42703，
      // 不是「那一列返回 null」。
      return {
        select: (cols: string) => ({
          eq: () => ({
            maybeSingle: () => {
              const wantsDedicated = cols.includes('mailchimp_audience_id')
              if (wantsDedicated && dedicatedColumn === 'absent') {
                return Promise.resolve({
                  data: null,
                  error: {
                    code: '42703',
                    message: 'column clients.mailchimp_audience_id does not exist',
                  },
                })
              }
              if (clientReadError) {
                return Promise.resolve({ data: null, error: { message: clientReadError } })
              }
              if (!wantsDedicated && leadsConfigReadError) {
                return Promise.resolve({ data: null, error: { message: leadsConfigReadError } })
              }
              const row: Record<string, unknown> = {}
              if (cols.includes('leads_config')) {
                // 专列 present 时故意在 leads_config 里留一个**不一样**的旧值：
                // 真库上这两处可以同时有值，代码必须只认专列。
                row.leads_config = {
                  mailchimp_audience_id:
                    dedicatedColumn === 'present' ? 'stale-leads-config-value' : audienceId,
                  ...(sourceTag ? { meta_leads: { source_tag: sourceTag } } : {}),
                }
              }
              if (wantsDedicated) row.mailchimp_audience_id = audienceId
              return Promise.resolve({ data: row, error: null })
            },
          }),
        }),
      }
    }
    if (table === 'contacts') {
      // 两种 select 形态：
      //   • resolveContact 走 .in(...).order(...) —— 返回 []（新人）
      //   • syncMailchimp/evaluateDnc 走 .eq('id',…).maybeSingle() —— 返回单条
      const selectApi = () => ({
        // 给 resolveContact 用（.in().order()）
        in: () => ({ order: () => Promise.resolve({ data: [] }) }),
        // 给 evaluateDnc 用（.eq().maybeSingle()）
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(
              contactReadError
                ? { data: null, error: { message: contactReadError } }
                : { data: { do_not_contact: contactDncFlag }, error: null },
            ),
        }),
      })
      return {
        insert: (payload: Record<string, unknown>) => {
          contactInserts.push(payload)
          return {
            select: () => ({ single: () => Promise.resolve({ data: { id: 'person-new' } }) }),
          }
        },
        select: selectApi,
        update: (payload: Record<string, unknown>) => {
          contactUpdates.push(payload)
          return {
            eq: () =>
              Object.assign(
                Promise.resolve(
                  contactUpdateError ? { error: { message: contactUpdateError } } : { error: null },
                ),
                {
                  is: () =>
                    Promise.resolve(
                      contactUpdateError ? { error: { message: contactUpdateError } } : { error: null },
                    ),
                },
              ),
          }
        },
      }
    }
    if (table === 'contact_touchpoints') {
      // 三种 write / read 形态：
      //   • evaluateDnc 走 .select('metadata,occurred_at').eq('contact_id', …)
      //     —— thenable，直接 await 拿 { data, error }
      //   • 老 helper 有 .update(...).in(...)（保留 no-op 兜底）
      //   • Phase C 走 .update({metadata}).eq('client_id').eq('source').eq('source_ref')
      //     —— 三次 .eq() 后 thenable 一次
      const dncData = existingDncTouches.map((t) => ({
        metadata: {
          outcome: t.outcome ?? null,
          do_not_contact: t.do_not_contact === true,
        },
        occurred_at: t.occurred_at,
      }))
      // Phase B/D 的 .update(payload).eq().eq().eq() —— 支持任意长度链式 .eq()。
      // 按 payload.metadata.mailchimp_result.status 分辨是 pre-provider（pending）
      // 还是 post-provider（真实结果），从而选择性触发失败。
      const buildTpUpdateBuilder = (errMsg: string | null) => {
        const builder: {
          eq: () => typeof builder
          then: <T>(onFulfilled: (v: { error: { message: string } | null }) => T) => Promise<T>
        } = {
          eq: () => builder,
          then: (onFulfilled) =>
            Promise.resolve(errMsg ? { error: { message: errMsg } } : { error: null }).then(
              onFulfilled,
            ),
        }
        return builder
      }
      return {
        update: (payload: Record<string, unknown>) => {
          // Phase B/D receipt update：payload 包含 metadata 字段。老 helper 用
          // .update(...).in(...) 我们兜底，但 metadata-shaped 才计入 receipt。
          if (payload && Object.prototype.hasOwnProperty.call(payload, 'metadata')) {
            touchpointUpdates.push(payload)
            const meta = payload.metadata as Record<string, unknown> | undefined
            const mc = (meta?.mailchimp_result ?? {}) as Record<string, unknown>
            const isPending = mc.status === 'pending'
            const err = isPending ? preProviderUpdateError : effectivePostErr
            return buildTpUpdateBuilder(err)
          }
          return { in: () => Promise.resolve({ error: null }) }
        },
        select: () => ({
          eq: () =>
            Promise.resolve(
              touchpointReadError
                ? { data: null, error: { message: touchpointReadError } }
                : { data: dncData, error: null },
            ),
        }),
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
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  subscribeMock.mockReset()
  // Default: 出口没配 audience —— 上游看到 skipped: no_audience_config，
  // subscribeMember 不该被调用。测试要打 provider 的用例自行覆写。
  subscribeMock.mockResolvedValue({ status: 'skipped', reason: 'no_audience_config' })
  process.env.MAILCHIMP_API_KEY = 'test-key-us19'
})

/**
 * subscribeMember 的一次性覆写，同时把「provider 被调时已经落盘的触点数」
 * 记进 `touchpointsAtProviderCall`。用来钉「Phase A 早于 Phase B」的硬顺序。
 */
function provideOnce(result: import('@/lib/mailchimp/client').SubscribeMemberResult) {
  subscribeMock.mockImplementationOnce(async () => {
    providerCallState.push({
      upserts: touchpointUpserts.length,
      updates: touchpointUpdates.length,
    })
    return result
  })
}

/**
 * 最终触点 metadata：优先看 Phase C 的 receipt update（有则代表已被替换成
 * provider 真实结果），否则回落到 Phase A 的 upsert（例如 upsert 之前就 throw
 * 掉了的路径）。
 */
function finalTouchpointMeta(): Record<string, unknown> {
  const last = touchpointUpdates[touchpointUpdates.length - 1]
  if (last && typeof last.metadata === 'object' && last.metadata !== null) {
    return last.metadata as Record<string, unknown>
  }
  return (touchpointUpserts[0]?.metadata ?? {}) as Record<string, unknown>
}

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

  it('consent 类问题 + 明确肯定短值 → provable consent', () => {
    const p = parseLeadAnswers([
      { name: 'consent_to_marketing_emails', value: 'Yes' },
    ])
    expect(p.consentEvidence).toBe('consent_to_marketing_emails')
    expect(p.optOutEvidence).toBeNull()
  })

  it('consent 字段答 "No" → 不算 provable consent', () => {
    const p = parseLeadAnswers([
      { name: 'subscribe_to_newsletter', value: 'No' },
      { name: 'opt_in', value: 'false' },
    ])
    expect(p.consentEvidence).toBeNull()
  })

  it('没有 consent 类问题 → consentEvidence 为 null（不猜）', () => {
    const p = parseLeadAnswers([{ name: 'budget', value: '$5000' }])
    expect(p.consentEvidence).toBeNull()
  })

  // ── Remediation P1 `PRRT_kwDOSTHiF86cIG3N`：consent = 明确肯定白名单 ────────

  it('长句拒绝 "No, I do not consent" → consentEvidence 为 null（fail-closed）', () => {
    const p = parseLeadAnswers([
      { name: 'consent_to_marketing_emails', value: 'No, I do not consent' },
    ])
    expect(p.consentEvidence).toBeNull()
  })

  it('长句拒绝 "I don\'t want updates" → consentEvidence 为 null', () => {
    const p = parseLeadAnswers([
      { name: 'marketing_updates', value: "I don't want updates" },
    ])
    expect(p.consentEvidence).toBeNull()
  })

  it('未知短值 "OK maybe" → consentEvidence 为 null（未知不当同意）', () => {
    const p = parseLeadAnswers([
      { name: 'consent', value: 'OK maybe' },
    ])
    expect(p.consentEvidence).toBeNull()
  })

  it('opt-out 问题 + 明确肯定 "Yes" → optOutEvidence 命中，consentEvidence 保持 null', () => {
    const p = parseLeadAnswers([
      { name: 'marketing_opt_out', value: 'Yes' },
    ])
    expect(p.optOutEvidence).toBe('marketing_opt_out')
    expect(p.consentEvidence).toBeNull()
  })

  it('opt-out 问题 + 别的 consent 问题同时存在 —— optOutEvidence 保留，供上游 fail-closed', () => {
    const p = parseLeadAnswers([
      { name: 'subscribe_to_newsletter', value: 'Yes' },
      { name: 'marketing_opt_out', value: 'Yes' },
    ])
    // opt-out 命中；上游 syncMailchimp 会看到 optOutEvidence 后直接 skip
    expect(p.optOutEvidence).toBe('marketing_opt_out')
    expect(p.consentEvidence).toBe('subscribe_to_newsletter')
  })

  it('unsubscribe 问题 + "Yes" → optOutEvidence 命中', () => {
    const p = parseLeadAnswers([
      { name: 'unsubscribe_from_emails', value: 'Yes' },
    ])
    expect(p.optOutEvidence).toBe('unsubscribe_from_emails')
  })

  it('email 字段本身不算 consent（就算 email 值非空）', () => {
    const p = parseLeadAnswers([
      { name: 'email', value: 'chris@example.com' },
    ])
    expect(p.consentEvidence).toBeNull()
  })

  it('full_name → firstName/lastName 按第一个空格拆一次', () => {
    const p = parseLeadAnswers([{ name: 'full_name', value: 'Chris van der Berg' }])
    expect(p.firstName).toBe('Chris')
    expect(p.lastName).toBe('van der Berg')
  })

  it('first_name + last_name 显式给出 → 直接用，不重拼', () => {
    const p = parseLeadAnswers([
      { name: 'first_name', value: 'Chris' },
      { name: 'last_name', value: 'Brown' },
    ])
    expect(p.firstName).toBe('Chris')
    expect(p.lastName).toBe('Brown')
  })
})

describe('ingestMetaLead', () => {
  it('新 lead 建人 + 写一条 inbound 触点', async () => {
    mockDb({})
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
    mockDb({})
    await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(touchpointUpserts[0].source_ref).toBe('lead-1')
    expect(upsertOptions[0]).toMatchObject({
      onConflict: 'client_id,source,source_ref',
      ignoreDuplicates: true,
    })
  })

  it('电话邮箱都不成形 → 不建人（不能让垃圾提交灌脏 contacts）', async () => {
    mockDb({})
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
    mockDb({})
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
    mockDb({ creativeLinkRow: { creative_ref: 'wo-1' } })
    await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(touchpointUpserts[0]).toMatchObject({ attr_ad_id: 'ad1', attr_creative_ref: 'wo-1' })
    expect(contactInserts[0]).toMatchObject({ attr_creative_ref: 'wo-1' })
  })

  /** 这条广告不是 ME 建的（或者建的时候就没认出片子）→ 照实留白，绝不拿别的片子顶上。 */
  it('回查不到片子 → attr_creative_ref 留 NULL', async () => {
    mockDb({ creativeLinkRow: null })
    await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(touchpointUpserts[0]).toMatchObject({ attr_ad_id: 'ad1', attr_creative_ref: null })
  })

  it('「感兴趣的团」进 metadata.tour_interest_raw（CRM 横表那一列读它）', async () => {
    mockDb({})
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
    mockDb({})
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
    mockDb({})
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('db down')
    })

    const res = await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })
    expect(res).toMatchObject({ contactId: null, skipped: 'error', mailchimp: null })
  })
})

// ── Mailchimp 出口 ──────────────────────────────────────────────────────────
// 这些用例照着 Issue #1188 的 required regressions 逐条钉，每一条对应一种
// 真的会在生产里出现的形态。

/** Meta 表单里带一个 marketing consent 类型答案的 lead —— provable consent。 */
const consented = () =>
  lead({
    answers: [
      { name: 'full_name', value: 'Chris Brown' },
      { name: 'email', value: 'chris@example.com' },
      { name: 'phone_number', value: 'p:+6421363598' },
      // 明确肯定短值 —— 命中新的白名单（Yes / I agree / Subscribe / …）
      { name: 'consent_to_marketing_emails', value: 'Yes' },
    ],
  })

describe('ingestMetaLead → Mailchimp 出口', () => {
  // 「人已在名单里 → 补打来源标签」那一刀走的是真 `fetch`（`applyMemberTags`）。
  // 不接管就会在跑测试时真的打 Mailchimp —— 慢、不稳，而且拿到的
  // `failed:network` 会把「补打成功」的用例伪装成通过。
  let tagCalls: { url: string; body: unknown }[] = []
  let tagStatus = 204
  const realFetch = globalThis.fetch

  beforeEach(() => {
    tagCalls = []
    tagStatus = 204
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      tagCalls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null })
      // GET /members/{hash} —— 查这个人现在有哪些标签
      if (!init?.method || init.method === 'GET') {
        return new Response(JSON.stringify({ status: 'subscribed', tags: [] }), { status: 200 })
      }
      // POST /members/{hash}/tags —— 真正写标签
      return new Response(null, { status: tagStatus })
    }) as unknown as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = realFetch
  })

  it('R1 valid + consented + audience 已配 → 触发 subscribeMember，写 mailchimp_synced_at', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    subscribeMock.mockResolvedValueOnce({ status: 'subscribed' })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).toHaveBeenCalledTimes(1)
    // ⚠️ SOURCE 和 tag 必须是**精确字符串** `facebook_leadgen` —— 跟原 #1188
    // Task Contract 客户 audience 自动化/分组条款硬绑。改动 = 打断客户
    // segmentation。合同 5425534006 明确锁定这两个精确值。
    expect(subscribeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        audienceId: 'dda97b7e61',
        email: 'chris@example.com',
        firstName: 'Chris',
        lastName: 'Brown',
        source: 'facebook_leadgen',
        tag: 'facebook_leadgen',
      }),
    )
    // 再显式钉一次两个精确值，绝不放过。
    const passedInput = subscribeMock.mock.calls[0][0] as { source: string; tag: string }
    expect(passedInput.source).toBe('facebook_leadgen')
    expect(passedInput.tag).toBe('facebook_leadgen')
    expect(res.mailchimp).toEqual({ status: 'subscribed' })

    // mailchimp_result 落进触点 metadata（不是新表）
    const meta = finalTouchpointMeta()
    expect(meta.mailchimp_result).toEqual({ status: 'subscribed' })

    // contacts.mailchimp_synced_at 被写上，且是 ISO 字符串
    expect(contactUpdates).toHaveLength(1)
    expect(typeof contactUpdates[0].mailchimp_synced_at).toBe('string')
    expect(contactUpdates[0].mailchimp_synced_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('R2 Member Exists → 触点上如实记录，contacts.mailchimp_synced_at 也写，绝不重订阅', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    subscribeMock.mockResolvedValueOnce({ status: 'already_member' })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).toHaveBeenCalledTimes(1)
    // 只调用了一次 —— 不会为 already_member 再 PATCH 一次去重新订阅
    expect(res.mailchimp).toEqual({ status: 'already_member', tagRepair: 'applied' })
    expect(contactUpdates).toHaveLength(1)
  })

  it('R2b Member Exists → 来源标签**真的**补打上去（这条链路整月漏掉的就是它）', async () => {
    // 2026-09-06 生产实测：CTS 每小时 10 条全 already_member，跑了一个月，
    // 来源标签在他们名单里从来没出现过 —— `POST /members` 对已存在的人整个
    // 不生效，标签一个字都没写进去。这条用例钉的就是那一刀。
    mockDb({ audienceId: 'dda97b7e61', sourceTag: 'fb_lead' })
    subscribeMock.mockResolvedValueOnce({ status: 'already_member' })

    const res = await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: consented() })

    expect(res.mailchimp).toEqual({ status: 'already_member', tagRepair: 'applied' })
    const write = tagCalls.find((c) => c.url.endsWith('/tags'))
    expect(write).toBeDefined()
    expect(write?.body).toEqual({ tags: [{ name: 'fb_lead', status: 'active' }] })
  })

  it('R2c 补打标签失败 → 不当成一切正常，原因如实带回给上游', async () => {
    // 会员关系是真的（人确实在名单里），但归因证据没落地。两件事必须分开报，
    // 否则又变成「看起来一切正常」。
    mockDb({ audienceId: 'dda97b7e61', sourceTag: 'fb_lead' })
    subscribeMock.mockResolvedValueOnce({ status: 'already_member' })
    tagStatus = 429

    const res = await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: consented() })

    expect(res.mailchimp).toEqual({ status: 'already_member', tagRepair: 'failed:http_429' })
  })

  it('R2d 客户没配标签名 → 用平台默认值，不是不打', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    subscribeMock.mockResolvedValueOnce({ status: 'already_member' })

    await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: consented() })

    const write = tagCalls.find((c) => c.url.endsWith('/tags'))
    expect(write?.body).toEqual({ tags: [{ name: DEFAULT_META_LEAD_SOURCE_TAG, status: 'active' }] })
  })

  it('标签名配置读失败 → 本条不发，不拿默认值糊过去', async () => {
    // 「读不到」和「客户就是要默认」是两件事。拿默认值糊过去 = 用一个可能是错的
    // 标签把广告归因证据打歪，而且没有任何人会发现 —— 这条链路刚栽过同款跟头。
    // 专列 present 让 audience 那次读走专列成功，把失败精确隔离在标签这次读上。
    mockDb({
      audienceId: 'dda97b7e61',
      dedicatedColumn: 'present',
      leadsConfigReadError: 'connection reset',
    })

    const res = await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: consented() })

    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'source_tag_read_failed' })
    expect(subscribeMock).not.toHaveBeenCalled()
    expect(tagCalls).toHaveLength(0)
  })

  it('新进名单的人不走补打那一刀 —— 标签已经在建会员那次请求里带上了', async () => {
    mockDb({ audienceId: 'dda97b7e61', sourceTag: 'fb_lead' })
    subscribeMock.mockResolvedValueOnce({ status: 'subscribed' })

    const res = await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: consented() })

    expect(res.mailchimp).toEqual({ status: 'subscribed' })
    expect(tagCalls).toHaveLength(0)
  })

  it('标签名从客户配置读，不是写死的 —— 换个客户就该换个名字', async () => {
    mockDb({ audienceId: 'dda97b7e61', sourceTag: 'oztop_showroom_lead' })
    subscribeMock.mockResolvedValueOnce({ status: 'subscribed' })

    await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: consented() })

    expect(subscribeMock.mock.calls[0][0]).toMatchObject({ tag: 'oztop_showroom_lead' })
  })

  it('R3 provider 5xx → 主管道照常写入，synced_at 不写，触点里如实留 failed', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    subscribeMock.mockResolvedValueOnce({
      status: 'failed',
      reason: 'provider_5xx',
      providerStatus: 503,
    })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    // 主管道成了 —— 触点写了、contact 建了
    expect(touchpointUpserts).toHaveLength(1)
    expect(res.contactId).toBe('person-new')
    // 但 synced_at 没被碰 —— failed 不算「同步成功」
    expect(contactUpdates).toHaveLength(0)
    // 失败原因如实进 metadata
    const meta = finalTouchpointMeta()
    expect(meta.mailchimp_result).toMatchObject({
      status: 'failed',
      reason: 'provider_5xx',
      providerStatus: 503,
    })
  })

  it('R4 客户没配 audience → 触点照常写，零 provider 调用', async () => {
    mockDb({ audienceId: null })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(touchpointUpserts).toHaveLength(1)
    expect(contactUpdates).toHaveLength(0)
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'no_audience_config' })
  })

  it('R5 lead 没邮箱（只有电话） → 触点照常写，零 provider 调用', async () => {
    mockDb({ audienceId: 'dda97b7e61' })

    await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: lead({
        answers: [
          { name: 'full_name', value: 'Chris Brown' },
          { name: 'phone_number', value: '+6421363598' },
          { name: 'consent', value: 'yes' },
        ],
      }),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    const meta = finalTouchpointMeta()
    expect(meta.mailchimp_result).toEqual({ status: 'skipped', reason: 'no_email' })
  })

  // R7 老用例（没 consent 字段 → 零调用）已被 PM override 5425996255 取代 ——
  // 现在没有 consent 字段的 lead 也会走 Mailchimp，依据是 form-level disclosure。
  // 相反方向的新回归 = form_disclosure_attested 路径正例，见后面
  // `PM override: form_disclosure_attested` describe 块。

  it('MAILCHIMP_API_KEY 未配置 → 零 provider 调用，reason=no_api_key', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    delete process.env.MAILCHIMP_API_KEY

    await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    const meta = finalTouchpointMeta()
    expect(meta.mailchimp_result).toEqual({ status: 'skipped', reason: 'no_api_key' })
  })

  /**
   * 隐私红线：Mailchimp 出口的观测栏**不能**回显邮箱、provider body 或 API key。
   * 只允许 status + reason（+ 数字 providerStatus）。
   */
  it('触点 metadata 里的 mailchimp_result 不含邮箱或 provider body', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    subscribeMock.mockResolvedValueOnce({
      status: 'failed',
      reason: 'validation',
      providerStatus: 400,
    })

    await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    const meta = finalTouchpointMeta()
    const mc = meta.mailchimp_result as Record<string, unknown>
    const asString = JSON.stringify(mc)
    expect(asString).not.toContain('@')
    expect(asString).not.toContain('chris')
    expect(asString).not.toContain('test-key')
  })

  it('subscribeMember 意外抛异常时不会拖挂主管道', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    subscribeMock.mockRejectedValueOnce(new Error('boom'))

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(res.contactId).toBe('person-new')
    expect(res.skipped).toBeNull()
    expect(res.mailchimp).toEqual({ status: 'failed', reason: 'unexpected_exception' })
    expect(contactUpdates).toHaveLength(0)
  })

  it('查客户配置本身失败 → 出口 skipped: client_config_read_failed，不拖挂主管道', async () => {
    mockDb({ audienceId: null, clientReadError: 'timeout' })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'client_config_read_failed' })
    expect(res.contactId).toBe('person-new')
  })
})

// ── Remediation P1 `PRRT_kwDOSTHiF86cIG3H`：统一 DNC 判据 fail-closed ────────
// 每条都要保证：主管道（contact + touchpoint）仍然写成功；只有出口被拦。

describe('ingestMetaLead → 统一 DNC 判据 fail-closed', () => {
  it('明确 opt-out 表单答案 → 出口 skipped: explicit_opt_out，零 provider 调用；主管道照常', async () => {
    mockDb({ audienceId: 'dda97b7e61' })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: lead({
        answers: [
          { name: 'full_name', value: 'Chris Brown' },
          { name: 'email', value: 'chris@example.com' },
          { name: 'consent', value: 'Yes' },
          { name: 'marketing_opt_out', value: 'Yes' },
        ],
      }),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'explicit_opt_out' })
    // 主管道成了
    expect(touchpointUpserts).toHaveLength(1)
    expect(contactInserts).toHaveLength(1)
    // synced_at 不写
    expect(contactUpdates).toHaveLength(0)
  })

  it('contacts.do_not_contact=true → 出口 skipped: contact_dnc，零 provider 调用', async () => {
    mockDb({ audienceId: 'dda97b7e61', contactDncFlag: true })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'contact_dnc' })
    expect(touchpointUpserts).toHaveLength(1) // 主管道照常
    expect(contactUpdates).toHaveLength(0)
  })

  it('镜像列 false 但触点里有跨渠道拒联证据 → 出口 skipped: contact_dnc', async () => {
    mockDb({
      audienceId: 'dda97b7e61',
      contactDncFlag: false,
      // 电话渠道上有人明确说别再联系 —— 跨渠道，Mailchimp 出口也得拦
      existingDncTouches: [
        { outcome: 'do_not_contact', occurred_at: '2026-08-01T10:00:00Z' },
      ],
    })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'contact_dnc' })
  })

  it('触点里 metadata.do_not_contact=true 也算（不是只看 outcome）', async () => {
    mockDb({
      audienceId: 'dda97b7e61',
      existingDncTouches: [
        { do_not_contact: true, occurred_at: '2026-08-01T10:00:00Z' },
      ],
    })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'contact_dnc' })
  })

  it('DNC 触点读失败 → 出口 skipped: dnc_check_failed（fail-closed，不猜「没有」）', async () => {
    mockDb({ audienceId: 'dda97b7e61', touchpointReadError: 'timeout' })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'dnc_check_failed' })
    // 主管道照常
    expect(touchpointUpserts).toHaveLength(1)
  })

  it('DNC contact 读失败 → 出口 skipped: dnc_check_failed', async () => {
    mockDb({ audienceId: 'dda97b7e61', contactReadError: 'db down' })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'dnc_check_failed' })
  })

  it('历史 do_not_contact 触点已被明确 dnc_cleared 判决晚于其后 → 出口正常放行', async () => {
    mockDb({
      audienceId: 'dda97b7e61',
      contactDncFlag: true, // 镜像列可能还是旧值 —— 判据看的是最后一次判决
      existingDncTouches: [
        { outcome: 'do_not_contact', occurred_at: '2026-07-01T10:00:00Z' },
        { outcome: 'dnc_cleared', occurred_at: '2026-08-15T10:00:00Z' },
      ],
    })
    subscribeMock.mockResolvedValueOnce({ status: 'subscribed' })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).toHaveBeenCalledTimes(1)
    expect(res.mailchimp).toEqual({ status: 'subscribed' })
  })

  it('新 lead consent 不自动覆盖历史 DNC —— 没有 dnc_cleared 触点时照样拦', async () => {
    // 表单里的 consent = Yes；触点里有陈年 do_not_contact；但从没被人明确纠正过
    mockDb({
      audienceId: 'dda97b7e61',
      existingDncTouches: [
        { outcome: 'do_not_contact', occurred_at: '2026-06-01T10:00:00Z' },
      ],
    })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'contact_dnc' })
  })
})

// ── Remediation V2：POST 硬超时 + Phase A/B/C 顺序 + receipt 替换 ─────────
// 全部对应 Build Control 合同 5425039661 指定的 focused regressions。

describe('ingestMetaLead → durable receipt order + receipt replacement', () => {
  it('provider 被调时，contact + source touchpoint（含 consent 证据）已耐久落盘', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    provideOnce({ status: 'subscribed' })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    // provider 被调 1 次
    expect(subscribeMock).toHaveBeenCalledTimes(1)
    // 那一刻已经有 1 条 upsert（Phase A）+ 1 条 UPDATE（Phase B pre-provider
    // evidence）落盘 —— 硬顺序 Phase A → Phase B → Phase C
    expect(providerCallState).toEqual([{ upserts: 1, updates: 1 }])
    // Phase A 上的触点带**真相 consent basis**（form_disclosure_attested）+
    // form_id + 存在的话的 consent_evidence（此 fixture 里恰好有）+ 无 opt-out。
    const upsertMeta = touchpointUpserts[0].metadata as Record<string, unknown>
    expect(upsertMeta.consent_basis).toBe('form_disclosure_attested')
    expect(upsertMeta.form_id).toBe('form-1')
    expect(upsertMeta.consent_evidence).toBe('consent_to_marketing_emails')
    expect(upsertMeta.opt_out_evidence).toBeNull()
    // Phase A 期占位 = pending；Phase D 才替换成 subscribed
    expect((upsertMeta.mailchimp_result as Record<string, unknown>).status).toBe('pending')
    // Phase B 也是 pending（同样的 evidence，只是通过 UPDATE 强制持久化一次）
    const phaseBMeta = touchpointUpdates[0].metadata as Record<string, unknown>
    expect(phaseBMeta.consent_basis).toBe('form_disclosure_attested')
    expect(phaseBMeta.form_id).toBe('form-1')
    expect(phaseBMeta.consent_evidence).toBe('consent_to_marketing_emails')
    expect((phaseBMeta.mailchimp_result as Record<string, unknown>).status).toBe('pending')
    // Phase D 才是真实结果
    expect(finalTouchpointMeta().mailchimp_result).toEqual({ status: 'subscribed' })

    expect(res.mailchimp).toEqual({ status: 'subscribed' })
  })

  it('同一 source_ref 上一轮 failed → 这一轮 subscribed，receipt 被替换，无重复触点', async () => {
    // 第一次：provider 失败
    mockDb({ audienceId: 'dda97b7e61' })
    provideOnce({ status: 'failed', reason: 'provider_5xx', providerStatus: 503, retryable: true })

    const res1 = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(res1.mailchimp).toMatchObject({ status: 'failed', reason: 'provider_5xx' })
    expect(touchpointUpserts).toHaveLength(1)
    // 第一轮：Phase B (pending) + Phase D (failed) = 2 次 UPDATE
    expect(touchpointUpdates).toHaveLength(2)
    // Phase D 已经把 pending 换成 failed
    expect((touchpointUpdates[1].metadata as Record<string, unknown>).mailchimp_result).toMatchObject({
      status: 'failed',
      reason: 'provider_5xx',
    })
    // 第一次的 mailchimp_synced_at 不写
    expect(contactUpdates).toHaveLength(0)

    // 第二次：同一 lead 再来一次，provider 成功。**不重开 mockDb** —— 保留
    // 累积数组，好断言「触点没多写一条」。
    provideOnce({ status: 'subscribed' })

    const res2 = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    expect(res2.mailchimp).toEqual({ status: 'subscribed' })
    // Phase A 又跑了一次（幂等键相同，实际库里不会真的多一条 —— upsert
    // ignoreDuplicates=true 的语义；这里只钉「代码逻辑没绕开幂等键」）
    expect(touchpointUpserts).toHaveLength(2)
    expect(touchpointUpserts[1].source_ref).toBe(touchpointUpserts[0].source_ref)
    expect(upsertOptions[1]).toMatchObject({
      onConflict: 'client_id,source,source_ref',
      ignoreDuplicates: true,
    })
    // 第二轮又 2 次 UPDATE（Phase B pending + Phase D subscribed）—— 共 4 条
    expect(touchpointUpdates).toHaveLength(4)
    // 最后一条 UPDATE 覆盖成 subscribed
    expect((touchpointUpdates[3].metadata as Record<string, unknown>).mailchimp_result).toEqual({
      status: 'subscribed',
    })
    // 现在才动 mailchimp_synced_at —— receipt 和 synced_at 语义一致
    expect(contactUpdates).toHaveLength(1)
    expect(typeof contactUpdates[0].mailchimp_synced_at).toBe('string')
  })

  it('post-provider receipt UPDATE 失败 → 主管道保留 contact/consent，不写 mailchimp_synced_at，不声称投递', async () => {
    mockDb({ audienceId: 'dda97b7e61', postProviderUpdateError: 'db timeout' })
    provideOnce({ status: 'subscribed' })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    // Phase A + Phase B（contact + touchpoint + consent 证据）已经落盘
    expect(contactInserts).toHaveLength(1)
    expect(touchpointUpserts).toHaveLength(1)
    expect((touchpointUpserts[0].metadata as Record<string, unknown>).consent_evidence).toBe(
      'consent_to_marketing_emails',
    )
    // provider 也跑了
    expect(subscribeMock).toHaveBeenCalledTimes(1)
    // 两次 UPDATE 都被尝试记录了 —— Phase B 成，Phase D 失败
    expect(touchpointUpdates).toHaveLength(2)
    // 关键：mailchimp_synced_at 不写（不能声称已投递 / 已同步）
    expect(contactUpdates).toHaveLength(0)
    // 返回值保留 provider 的真实结果 —— 上游看得见 provider 说了 subscribed，
    // 但 DB 那边 receipt 没落上，本地状态与远端可能暂时不一致
    expect(res.mailchimp).toEqual({ status: 'subscribed' })
    // 主管道 skipped=null 说明 lead 依然接进来了
    expect(res.skipped).toBeNull()
    expect(res.contactId).toBe('person-new')
  })

  it('零重复触点 —— 幂等键还是 (client_id, source, source_ref)', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    provideOnce({ status: 'subscribed' })

    await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    // Phase A upsert 一次，upsertOptions 带 ignoreDuplicates=true。
    expect(touchpointUpserts).toHaveLength(1)
    expect(upsertOptions[0]).toMatchObject({
      onConflict: 'client_id,source,source_ref',
      ignoreDuplicates: true,
    })
    // Phase B (pending) + Phase D (subscribed) 各一次；两次都是 UPDATE，不是
    // INSERT / UPSERT —— 幂等键不会被绕开，实际库里不会多出一条触点。
    expect(touchpointUpdates).toHaveLength(2)
  })

  it('subscribe POST 挂起 → 内置 AbortSignal 在 timeoutMs 内 abort，返回 retryable failed 且不阻塞主管道', async () => {
    // 这条只测客户端函数本身；用它检查生产代码里 syncMailchimp 出的调用
    // 也有超时兜底的路径能力（timeoutMs 参数在 SubscribeMemberInput 上）。
    const { subscribeMember: realSubscribe } = await vi.importActual<
      typeof import('@/lib/mailchimp/client')
    >('@/lib/mailchimp/client')

    // 只有 signal.aborted 才让 promise 落地 —— 模拟连接建了但对方不回。
    const hungFetch = ((_url: string | URL, init: RequestInit = {}) =>
      new Promise((_, reject) => {
        const signal = init.signal
        if (!signal) return // 没 signal 就永远挂 —— 测试到这就出错
        if (signal.aborted) {
          reject(new DOMException('The operation was aborted.', 'AbortError'))
          return
        }
        signal.addEventListener('abort', () => {
          const reason = (signal as AbortSignal & { reason?: unknown }).reason
          const err =
            reason instanceof Error
              ? reason
              : new DOMException('The operation was aborted.', 'AbortError')
          reject(err)
        })
      })) as unknown as typeof fetch

    const t0 = performance.now()
    const res = await realSubscribe({
      apiKey: 'key123-us19',
      audienceId: 'dda97b7e61',
      email: 'chris@example.com',
      source: 'Meta Lead Form',
      timeoutMs: 50,
      fetchImpl: hungFetch,
    })
    const elapsed = performance.now() - t0

    expect(res).toMatchObject({ status: 'failed', reason: 'timeout', retryable: true })
    // 有明确上限：不能被拖到默认 20s。留 2s 缓冲扛调度抖动。
    expect(elapsed).toBeLessThan(2000)
  })
})

// ── Remediation V3：consent 字段名 allowlist + pre-provider evidence 耐久 ────
// 对应 Build Control 合同 5425312107 逐条 focused regression。

describe('parseLeadAnswers → 只允许精确的营销订阅字段名', () => {
  it('consent_to_terms_and_conditions=Yes → NOT provable consent（条款同意 ≠ 营销同意）', () => {
    const p = parseLeadAnswers([
      { name: 'consent_to_terms_and_conditions', value: 'Yes' },
    ])
    expect(p.consentEvidence).toBeNull()
  })

  it('consent_to_privacy_policy=Yes → NOT provable consent', () => {
    const p = parseLeadAnswers([
      { name: 'consent_to_privacy_policy', value: 'Yes' },
    ])
    expect(p.consentEvidence).toBeNull()
  })

  it('have_you_received_our_marketing_before=Yes → NOT provable consent（历史问题不是订阅）', () => {
    const p = parseLeadAnswers([
      { name: 'have_you_received_our_marketing_before', value: 'Yes' },
    ])
    expect(p.consentEvidence).toBeNull()
  })

  it('generic "consent"=Yes → NOT provable consent（问题名不够具体）', () => {
    const p = parseLeadAnswers([{ name: 'consent', value: 'Yes' }])
    expect(p.consentEvidence).toBeNull()
  })

  it('generic "marketing_updates"=Yes → NOT provable consent', () => {
    const p = parseLeadAnswers([{ name: 'marketing_updates', value: 'Yes' }])
    expect(p.consentEvidence).toBeNull()
  })

  it('精确的营销订阅字段名 + 明确肯定 → provable consent', () => {
    for (const name of [
      'consent_to_marketing_emails',
      'consent_to_receive_marketing_emails',
      'subscribe_to_newsletter',
      'subscribe_to_marketing_emails',
      'newsletter_signup',
      'receive_marketing_emails',
      'opt_in_to_marketing_emails',
    ]) {
      const p = parseLeadAnswers([{ name, value: 'Yes' }])
      expect(p.consentEvidence, `${name} should be provable`).toBe(name)
    }
  })

  it('字段名的分隔符 / 大小写差异会被归一（`Consent-To-Marketing-Emails` = `consent_to_marketing_emails`）', () => {
    const p = parseLeadAnswers([{ name: 'Consent-To-Marketing-Emails', value: 'Yes' }])
    expect(p.consentEvidence).toBe('Consent-To-Marketing-Emails') // 保留原名给审计
  })
})

describe('ingestMetaLead → allowlist + pre-provider evidence durability', () => {
  // 三条 custom-consent-field 门禁老用例（terms / historical-marketing / generic
  // consent → 零 provider 调用）已被 PM override 5425996255 取代 —— 现在这些
  // 字段的存在与否都不再决定是否调用 Mailchimp；决定权在 form-level disclosure
  // + opt-out + DNC + audience config。对应正向路径见后面
  // `PM override: form_disclosure_attested` describe 块。

  it('精确 marketing-email consent field + Yes → 允许（在 DNC 判据放行时）', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    provideOnce({ status: 'subscribed' })
    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: lead({
        answers: [
          { name: 'full_name', value: 'Chris Brown' },
          { name: 'email', value: 'chris@example.com' },
          { name: 'consent_to_marketing_emails', value: 'Yes' },
        ],
      }),
    })
    expect(subscribeMock).toHaveBeenCalledTimes(1)
    expect(res.mailchimp).toEqual({ status: 'subscribed' })
  })

  it('pre-existing 触点也会在 provider 调用前被 Phase B UPDATE 上本次 consent 证据', async () => {
    // mock 里的 upsert 无论存不存在都记录 —— 关键断言是「Phase B UPDATE 在
    // provider 调用之前发生，且带着本次的 consent_evidence」。
    mockDb({ audienceId: 'dda97b7e61' })
    provideOnce({ status: 'subscribed' })

    await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    // provider 被调时至少已经有 1 次 UPDATE（Phase B）落盘
    expect(providerCallState).toHaveLength(1)
    expect(providerCallState[0].updates).toBeGreaterThanOrEqual(1)
    // 第一次 UPDATE 就带了 consent_evidence + pending，证明「哪怕历史触点已存在，
    // 本次 consent 也已经在 provider 调用前耐久写回」
    const phaseB = touchpointUpdates[0].metadata as Record<string, unknown>
    expect(phaseB.consent_evidence).toBe('consent_to_marketing_emails')
    expect((phaseB.mailchimp_result as Record<string, unknown>).status).toBe('pending')
  })

  it('pre-provider evidence UPDATE 失败 → 零 provider 调用，mailchimp=skipped:evidence_persist_failed，主管道保留', async () => {
    mockDb({ audienceId: 'dda97b7e61', preProviderUpdateError: 'db timeout' })
    provideOnce({ status: 'subscribed' }) // 不应被消耗

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: consented(),
    })

    // 核心：**零** Mailchimp 调用
    expect(subscribeMock).not.toHaveBeenCalled()
    // 返回 sanitized skipped，reason=evidence_persist_failed
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'evidence_persist_failed' })
    // 主管道仍然成 —— contact + touchpoint 已经落盘
    expect(res.skipped).toBeNull()
    expect(res.contactId).toBe('person-new')
    expect(contactInserts).toHaveLength(1)
    expect(touchpointUpserts).toHaveLength(1)
    // 只有 Phase B 那次尝试；没有 Phase D
    expect(touchpointUpdates).toHaveLength(1)
    // mailchimp_synced_at 绝不写（不能声称已订阅 / 已投递）
    expect(contactUpdates).toHaveLength(0)
  })
})

// ── PM override 5425996255：form-level disclosure 就是 consent ───────────────
// CTS 已批准的 Meta Lead Form 在 Submit 之前展示 disclosure；提交 = consent。
// 这条路径不再要求自定义 consent 字段；opt-out / DNC / audience config /
// evidence persistence / provider failure 继续拦。

describe('ingestMetaLead → PM override: form_disclosure_attested consent basis', () => {
  it('configured audience + valid email + 没有 custom consent 字段 → provider 被调用', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    provideOnce({ status: 'subscribed' })

    // 默认 lead() 里没有任何 consent 字段
    const res = await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(subscribeMock).toHaveBeenCalledTimes(1)
    expect(res.mailchimp).toEqual({ status: 'subscribed' })
    // synced_at 也如实写上
    expect(contactUpdates).toHaveLength(1)
  })

  it('configured audience + valid email + 只有 unrelated custom 字段 → provider 被调用', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    provideOnce({ status: 'subscribed' })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: lead({
        answers: [
          { name: 'full_name', value: 'Chris Brown' },
          { name: 'email', value: 'chris@example.com' },
          { name: 'which_tour_interests_you_most?', value: 'Best of China' },
          { name: 'budget', value: '$5000' },
        ],
      }),
    })

    expect(subscribeMock).toHaveBeenCalledTimes(1)
    expect(res.mailchimp).toEqual({ status: 'subscribed' })
  })

  it('pre-provider 持久化的 metadata 记 consent_basis=form_disclosure_attested + form_id + null consent_evidence', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    provideOnce({ status: 'subscribed' })

    await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    // Phase A upsert 上真相
    const upsertMeta = touchpointUpserts[0].metadata as Record<string, unknown>
    expect(upsertMeta.consent_basis).toBe('form_disclosure_attested')
    expect(upsertMeta.form_id).toBe('form-1')
    // 没有 checkbox 就是 null，绝不 invent
    expect(upsertMeta.consent_evidence).toBeNull()
    // Phase B pre-provider UPDATE 也同款 metadata
    const phaseB = touchpointUpdates[0].metadata as Record<string, unknown>
    expect(phaseB.consent_basis).toBe('form_disclosure_attested')
    expect(phaseB.form_id).toBe('form-1')
    expect(phaseB.consent_evidence).toBeNull()
  })

  it('explicit opt-out（marketing_opt_out=Yes）→ 即使新规也拦下：零 provider 调用', async () => {
    mockDb({ audienceId: 'dda97b7e61' })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: lead({
        answers: [
          { name: 'full_name', value: 'Chris Brown' },
          { name: 'email', value: 'chris@example.com' },
          { name: 'marketing_opt_out', value: 'Yes' },
        ],
      }),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'explicit_opt_out' })
  })

  it('DNC（contacts.do_not_contact=true）→ 即使新规也拦下：零 provider 调用', async () => {
    mockDb({ audienceId: 'dda97b7e61', contactDncFlag: true })

    // 默认 lead() 没有 consent 字段；DNC 仍然优先拦
    const res = await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'contact_dnc' })
  })

  it('no audience config → 零 provider 调用', async () => {
    mockDb({ audienceId: null })

    const res = await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'no_audience_config' })
  })

  it('provider 失败仍然非阻塞：主管道保留，失败 receipt 如实记录', async () => {
    mockDb({ audienceId: 'dda97b7e61' })
    provideOnce({ status: 'failed', reason: 'provider_5xx', providerStatus: 503, retryable: true })

    const res = await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    // 主管道成
    expect(res.skipped).toBeNull()
    expect(res.contactId).toBe('person-new')
    expect(contactInserts).toHaveLength(1)
    // Provider 结果如实回到触点 metadata
    expect(finalTouchpointMeta().mailchimp_result).toMatchObject({
      status: 'failed',
      reason: 'provider_5xx',
    })
    // synced_at 不写 —— receipt 与投递语义分开
    expect(contactUpdates).toHaveLength(0)
  })
})

// ── 合同 5426843158：Persistent opt-out via unified DNC signal ────────────────
// 明确 opt-out 必须留下**判据读得懂**的耐久标记，同一联系人未来的 lead
// 也会被同一份 DNC 判据继续拦。不加 schema / 表 / DNC framework / provider
// 行为 / settings —— 只在既有 metadata 里补一位布尔。

describe('ingestMetaLead → persistent opt-out via metadata.do_not_contact', () => {
  it('lead A 明确 opt-out → 零 provider 调用 + metadata 同时携带 opt_out_evidence 和 do_not_contact:true', async () => {
    mockDb({ audienceId: 'dda97b7e61' })

    const resA = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: lead({
        answers: [
          { name: 'full_name', value: 'Chris Brown' },
          { name: 'email', value: 'chris@example.com' },
          { name: 'marketing_opt_out', value: 'Yes' },
        ],
      }),
    })

    expect(subscribeMock).not.toHaveBeenCalled()
    expect(resA.mailchimp).toEqual({ status: 'skipped', reason: 'explicit_opt_out' })

    // 主管道照常写触点；metadata **同时** 有 audit-truth 和 DNC 判据读位
    expect(touchpointUpserts).toHaveLength(1)
    const metaA = touchpointUpserts[0].metadata as Record<string, unknown>
    expect(metaA.opt_out_evidence).toBe('marketing_opt_out')
    expect(metaA.do_not_contact).toBe(true)
    // Phase B pre-provider UPDATE 上的 metadata 也带上耐久 DNC 位
    const phaseBMeta = touchpointUpdates[0].metadata as Record<string, unknown>
    expect(phaseBMeta.do_not_contact).toBe(true)
    expect(phaseBMeta.opt_out_evidence).toBe('marketing_opt_out')
  })

  it('同一联系人后续 lead B **不再勾 opt-out** → 仍被统一 DNC 判据拦：零 provider 调用', async () => {
    // 场景：lead A 已经把 metadata.do_not_contact=true 落进了触点。后来 lead B
    // 进来时，evaluateDnc() 读 contact_touchpoints 会看到那条持久 DNC 信号。
    mockDb({
      audienceId: 'dda97b7e61',
      existingDncTouches: [
        // 模拟 lead A 那条触点在库里的样子：只有 metadata.do_not_contact=true，
        // outcome 空。这正是本次补丁写入的最小信号。
        { do_not_contact: true, occurred_at: '2026-07-28T04:19:48.000Z' },
      ],
    })

    // Lead B：默认 lead()，**没有** opt-out 答案
    const resB = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: lead({ leadId: 'lead-B' }),
    })

    // 关键：零 Mailchimp 调用；skipped 原因 contact_dnc
    expect(subscribeMock).not.toHaveBeenCalled()
    expect(resB.mailchimp).toEqual({ status: 'skipped', reason: 'contact_dnc' })
    // synced_at 绝不写
    expect(contactUpdates).toHaveLength(0)
  })

  it('已存在明确 dnc_cleared 判决（时间晚于 opt-out 触点）→ 依旧放行，既有行为不变', async () => {
    mockDb({
      audienceId: 'dda97b7e61',
      existingDncTouches: [
        // 早前 lead A 留下的持久 DNC 位
        { do_not_contact: true, occurred_at: '2026-07-01T10:00:00Z' },
        // 后来人明确纠正过一次
        { outcome: 'dnc_cleared', occurred_at: '2026-08-15T10:00:00Z' },
      ],
    })
    provideOnce({ status: 'subscribed' })

    const res = await ingestMetaLead({
      clientId: CLIENT,
      defaultCountry: 'NZ',
      lead: lead({ leadId: 'lead-C' }),
    })

    // dnc_cleared 晚于持久 DNC 位 —— isDoNotContact() 认最后一次判决 → 放行
    expect(subscribeMock).toHaveBeenCalledTimes(1)
    expect(res.mailchimp).toEqual({ status: 'subscribed' })
  })
})

/**
 * audience id 怎么读 —— 本组用例存在的唯一理由是一次真实的静默事故。
 *
 * 2026-08~09 生产上 `syncMailchimp` 直接 `select('mailchimp_audience_id')`，
 * 而那一列的 migration (20260826010000) 从没 apply。PostgREST 整条查询回
 * 42703，代码走 `client_config_read_failed` 分支 **return，没有一行日志、
 * 没有一个计数**。于是 Meta 表单进来的人一个都没进 Mailchimp audience，
 * `facebook_leadgen` 标签一次都没出现过 —— 一整个月没有任何人看得见。
 *
 * 这里钉三件事：
 *   · 专列不存在时**不许**当成失败（要落到 leads_config 继续干活）
 *   · 真失败时**不许**静默（必须 console.error）
 *   · 「读不到」和「查得到但没配」是两个不同的 reason，不许混成一个
 */
describe('Mailchimp audience id 的读法（防静默失败）', () => {
  it('专列没 apply（42703）+ leads_config 里配了 → 照常订阅，绝不静默跳过', async () => {
    // 生产今天的真实形态：dedicatedColumn 缺省就是 'absent'。
    mockDb({ audienceId: 'dda97b7e61' })
    provideOnce({ status: 'subscribed' })

    const res = await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(res.mailchimp).toEqual({ status: 'subscribed' })
    // 用的是 leads_config 里那个值，不是空串
    expect(subscribeMock.mock.calls[0][0]).toMatchObject({ audienceId: 'dda97b7e61' })
    // 42703 是「这一列还没建」，不是故障 —— 不该往错误日志里吼
    expect(console.error).not.toHaveBeenCalled()
  })

  it('专列 apply 之后 → 只认专列，leads_config 里的旧值一律不看', async () => {
    mockDb({ audienceId: 'from-column', dedicatedColumn: 'present' })
    provideOnce({ status: 'subscribed' })

    await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(subscribeMock.mock.calls[0][0]).toMatchObject({ audienceId: 'from-column' })
  })

  it('专列 apply 之后被清空 → 出口真的关掉，不许被 leads_config 的旧值复活', async () => {
    // 运营清空专列 = 明确要停这个客户的出口。假件里 leads_config 仍留着旧值。
    mockDb({ audienceId: null, dedicatedColumn: 'present' })

    const res = await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'no_audience_config' })
    expect(subscribeMock).not.toHaveBeenCalled()
  })

  it('专列没 apply + leads_config 也没配 → no_audience_config（查得到，就是没配）', async () => {
    mockDb({ audienceId: null })

    const res = await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'no_audience_config' })
    expect(subscribeMock).not.toHaveBeenCalled()
  })

  it('真实读失败（非 42703）→ client_config_read_failed **并且吼进错误日志**', async () => {
    mockDb({ audienceId: 'dda97b7e61', clientReadError: 'permission denied for table clients' })

    const res = await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'client_config_read_failed' })
    expect(subscribeMock).not.toHaveBeenCalled()
    // 这条断言就是本次修复的核心：读不到配置不许再无声无息地过去。
    expect(console.error).toHaveBeenCalledTimes(1)
    expect(String((console.error as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain(
      '读配置失败',
    )
  })

  it('42703 降级之后第二次查询也失败 → 照样报 client_config_read_failed，不许吞', async () => {
    mockDb({ audienceId: 'dda97b7e61', leadsConfigReadError: 'connection reset' })

    const res = await ingestMetaLead({ clientId: CLIENT, defaultCountry: 'NZ', lead: lead() })

    expect(res.mailchimp).toEqual({ status: 'skipped', reason: 'client_config_read_failed' })
    expect(console.error).toHaveBeenCalledTimes(1)
  })
})
