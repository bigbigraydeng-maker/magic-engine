/**
 * 归因**真的落库**了吗 —— 写入路径的测试。
 *
 * 本仓有过「加了字段没接线」的前科（字段建好、写入方从来没传值，看板上永远空白）。
 * 这份测试钉住三件事：
 *   1. 新建的人身上带着这次的归因（不然 contacts 上的来源永远是 NULL）
 *   2. 已有的人**只补空**，绝不覆盖 —— first-touch 语义。被覆盖掉就变成 last-touch，
 *      功劳全记给最后那封提醒邮件，真正带来人的那条广告永远拿不到分
 *   3. 公开的官网表单端点**不许触发联系人合并** —— 合并不可逆，公开端点能触发它
 *      就等于把两个真人的历史交给任何一个会发 POST 的人
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn() },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { resolveContact } from '../identity'
import { EMPTY_ATTRIBUTION, type Attribution } from '../attribution'
import { mirrorWebFormLead } from '../web-form-lead'

const CLIENT = 'client-a'
const PHONE = { kind: 'phone' as const, value: '+6421363598' }
const EMAIL = { kind: 'email' as const, value: 'chris@example.com' }

const META_AD: Attribution = {
  platform: 'meta',
  campaignId: 'c1',
  adsetId: 'as1',
  adId: 'ad1',
  adName: 'Reel A',
  creativeRef: null,
}

interface UpdateCall {
  patch: Record<string, unknown>
  /** update 后面挂的 .is(col, value) 过滤条件 —— first-touch 的护栏就是它。 */
  isFilters: [string, unknown][]
}

let contactInserts: Record<string, unknown>[]
let contactUpdates: UpdateCall[]
let touchpointUpserts: Record<string, unknown>[]

/** update(...).eq(...) 既要能 await，又要能接 .is(...)。 */
function updatableChain(call: UpdateCall) {
  const done = { error: null }
  const withIs = () =>
    Object.assign(Promise.resolve(done), {
      is: (col: string, value: unknown) => {
        call.isFilters.push([col, value])
        return Promise.resolve(done)
      },
    })
  return { eq: () => withIs() }
}

/**
 * identityHits 决定走哪条分支：
 *   []           一个都没命中 → 新建人
 *   [一条]       命中已有的人 → 只补空
 */
function mockDb(identityHits: { contact_id: string; kind: string; value: string }[]) {
  contactInserts = []
  contactUpdates = []
  touchpointUpserts = []
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
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
          return { select: () => ({ single: () => Promise.resolve({ data: { id: 'new-person' } }) }) }
        },
        select: () => ({
          in: () => ({ order: () => Promise.resolve({ data: [] }) }),
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: { country: 'NZ' } }) }),
        }),
        update: (patch: Record<string, unknown>) => {
          const call: UpdateCall = { patch, isFilters: [] }
          contactUpdates.push(call)
          return updatableChain(call)
        },
      }
    }
    if (table === 'contact_touchpoints') {
      return {
        update: () => ({ in: () => Promise.resolve({ error: null }) }),
        upsert: (row: Record<string, unknown>) => {
          touchpointUpserts.push(row)
          return Promise.resolve({ error: null })
        },
      }
    }
    if (table === 'clients') {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: { country: 'NZ' } }) }),
        }),
      }
    }
    throw new Error(`unexpected table ${table}`)
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('新建的人：这次的归因就是 first-touch', () => {
  it('attr_* 列 + 首次归因时间一起写进 insert', async () => {
    mockDb([])
    await resolveContact({
      clientId: CLIENT,
      identities: [PHONE],
      attribution: META_AD,
      seenAt: '2026-07-30T01:00:00Z',
    })

    expect(contactInserts).toHaveLength(1)
    expect(contactInserts[0]).toMatchObject({
      attr_platform: 'meta',
      attr_ad_id: 'ad1',
      attr_adset_id: 'as1',
      attr_campaign_id: 'c1',
      attr_ad_name: 'Reel A',
      first_attributed_at: '2026-07-30T01:00:00Z',
    })
  })

  it('房子也挂上（地产客户）', async () => {
    mockDb([])
    await resolveContact({
      clientId: CLIENT,
      identities: [PHONE],
      attribution: META_AD,
      listingId: 'listing-1',
    })
    expect(contactInserts[0].listing_id).toBe('listing-1')
  })

  it('渠道拿不到归因时不写任何 attr_ 列（留 NULL 是事实，不是漏了）', async () => {
    mockDb([])
    await resolveContact({ clientId: CLIENT, identities: [PHONE] })
    const keys = Object.keys(contactInserts[0])
    expect(keys.filter((k) => k.startsWith('attr_'))).toEqual([])
    expect(keys).not.toContain('first_attributed_at')
    expect(keys).not.toContain('listing_id')
  })
})

describe('已有的人：只补空，绝不覆盖（first-touch 的护栏）', () => {
  it('回填 attr_* 的那次 update 必须带 first_attributed_at IS NULL 条件', async () => {
    mockDb([{ contact_id: 'person-old', kind: 'phone', value: PHONE.value }])
    await resolveContact({
      clientId: CLIENT,
      identities: [PHONE],
      attribution: META_AD,
      seenAt: '2026-07-30T02:00:00Z',
    })

    const backfill = contactUpdates.find((u) => 'attr_ad_id' in u.patch)
    expect(backfill).toBeDefined()
    // 没有这个条件就是 last-touch：第二次广告会盖掉第一次，学出来的结论是反的。
    expect(backfill?.isFilters).toEqual([['first_attributed_at', null]])
  })

  it('挂房子同理：只在原来没挂过的时候写', async () => {
    mockDb([{ contact_id: 'person-old', kind: 'phone', value: PHONE.value }])
    await resolveContact({
      clientId: CLIENT,
      identities: [PHONE],
      listingId: 'listing-2',
    })
    const patch = contactUpdates.find((u) => 'listing_id' in u.patch)
    expect(patch?.isFilters).toEqual([['listing_id', null]])
  })

  it('归因全空时根本不发那次 update（不会把已有归因清成 null）', async () => {
    mockDb([{ contact_id: 'person-old', kind: 'phone', value: PHONE.value }])
    await resolveContact({
      clientId: CLIENT,
      identities: [PHONE],
      attribution: EMPTY_ATTRIBUTION,
    })
    expect(contactUpdates.some((u) => 'attr_platform' in u.patch)).toBe(false)
  })
})

describe('官网表单 lead → CRM', () => {
  it('utm 带广告参数时，触点上带着归因', async () => {
    mockDb([])
    const r = await mirrorWebFormLead({
      clientId: CLIENT,
      leadId: 'lead-1',
      name: 'Chris',
      phone: '021 363 598',
      email: 'chris@example.com',
      utmSource: 'facebook',
      utmCampaign: 'kiteroa-open-home',
      submittedAt: '2026-07-30T03:00:00Z',
    })

    expect(r.contactId).toBe('new-person')
    expect(touchpointUpserts).toHaveLength(1)
    expect(touchpointUpserts[0]).toMatchObject({
      channel: 'web_form',
      direction: 'inbound',
      attr_platform: 'meta',
      attr_campaign_id: 'kiteroa-open-home',
      // 幂等键 = leads.id，同一条 lead 重放不会写出第二条触点
      source_ref: 'lead-1',
    })
  })

  it('电话邮箱都不成形 → 不建人（否则垃圾提交会灌满联系人表）', async () => {
    mockDb([])
    const r = await mirrorWebFormLead({
      clientId: CLIENT,
      leadId: 'lead-2',
      name: 'bot',
      phone: 'abc',
      email: 'not-an-email',
    })
    expect(r).toEqual({ contactId: null, skipped: 'no_identity' })
    expect(contactInserts).toEqual([])
    expect(touchpointUpserts).toEqual([])
  })

  it('电话和邮箱分别属于两个老客户时，绝不合并 —— 公开端点不许触发不可逆操作', async () => {
    mockDb([
      { contact_id: 'person-old', kind: 'phone', value: PHONE.value },
      { contact_id: 'person-other', kind: 'email', value: EMAIL.value },
    ])
    const r = await mirrorWebFormLead({
      clientId: CLIENT,
      leadId: 'lead-3',
      name: '攻击者',
      phone: '021 363 598',
      email: 'chris@example.com',
    })

    expect(r).toEqual({ contactId: null, skipped: 'ambiguous' })
    // 一条记录都不许动：合并不可逆，公开端点能触发它就是把两个真人的历史交出去
    expect(contactUpdates).toEqual([])
    expect(touchpointUpserts).toEqual([])
  })

  it('撞到已有客户时，绝不用表单里的名字覆盖他 —— 公开端点不许改已有客户资料', async () => {
    // 场景：某人（或某脚本）知道老客户的邮箱，用它提交表单并填一个别的名字。
    // 如果放过去，CRM 里那位真实客户的姓名就被匿名提交改掉了，销售当场认不出人。
    mockDb([{ contact_id: 'person-old', kind: 'email', value: EMAIL.value }])

    const r = await mirrorWebFormLead({
      clientId: CLIENT,
      leadId: 'lead-4',
      name: '改成别的名字',
      phone: null,
      email: 'chris@example.com',
    })

    expect(r.contactId).toBe('person-old')
    // 归因回填那次 update 可以有，但**任何一次** update 都不许带 display_name
    for (const call of contactUpdates) {
      expect(call.patch).not.toHaveProperty('display_name')
    }
  })

  it('底层报错时不抛出去（lead 已经存了，客户不该看到提交失败）', async () => {
    ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('db down')
    })
    const r = await mirrorWebFormLead({
      clientId: CLIENT,
      leadId: 'lead-4',
      name: 'Chris',
      phone: '021 363 598',
      email: null,
    })
    expect(r).toEqual({ contactId: null, skipped: 'error' })
  })
})
