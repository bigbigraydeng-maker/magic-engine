/**
 * Messenger → 联系人 的接线。
 *
 * 钉住四件最容易悄悄错的事：
 *   1. 业务自家邮箱(info@ctstours.co.nz)出现在正文里，绝不能当成客户身份 —— 否则
 *      Meta 自动回复会把几十段对话错并到一个假「info@」客户上。
 *   2. 一段对话命中两个不同的人 = 歧义，宁可不接（错接不可逆）。
 *   3. **建人只能靠 fb_psid**，绝不能靠正文里正则抽出来的邮箱/电话 —— 第 1 条那个
 *      坑必须在结构上进不来。
 *   4. **客户自己开过口才建人**：纯出站的群发 / 自动欢迎语不配升级成一个客户。
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { supabaseAdmin } from '@/lib/supabase'
import {
  matchConversationToContact,
  linkMessengerConversation,
  type IdentityIndex,
} from '../link-contacts'
import { segmentContact, type ContactLike, type TouchpointLike } from '@/lib/crm/segments'

function index(opts: { emails?: [string, string][]; psids?: [string, string][] }): IdentityIndex {
  return {
    byEmail: new Map(opts.emails ?? []),
    byPsid: new Map(opts.psids ?? []),
  }
}

describe('matchConversationToContact', () => {
  it('已知 psid 直接命中', () => {
    const res = matchConversationToContact(
      { psid: 'psid_9', messageBodies: ['hi'] },
      index({ psids: [['psid_9', 'contact-A']] }),
    )
    expect(res).toEqual({ contactId: 'contact-A', matchedBy: 'psid' })
  })

  it('正文里出现已有客户邮箱 → 命中该客户', () => {
    const res = matchConversationToContact(
      { psid: null, messageBodies: ['My email is Robyn.Richards1@gmail.com thanks'] },
      index({ emails: [['robyn.richards1@gmail.com', 'contact-R']] }),
    )
    expect(res).toEqual({ contactId: 'contact-R', matchedBy: 'email' })
  })

  it('业务自家域名邮箱(info@ctstours.co.nz)绝不当客户身份', () => {
    const res = matchConversationToContact(
      { psid: null, messageBodies: ['Please contact us at info@ctstours.co.nz'] },
      // 就算这个业务邮箱恰好被误登记成某个联系人，也必须被域名规则挡掉
      index({ emails: [['info@ctstours.co.nz', 'contact-BUSINESS']] }),
    )
    expect(res).toBeNull()
  })

  it('psid 和邮箱指向两个不同的人 = 歧义 → 不接', () => {
    const res = matchConversationToContact(
      { psid: 'psid_9', messageBodies: ['also reach me at other@gmail.com'] },
      index({
        psids: [['psid_9', 'contact-A']],
        emails: [['other@gmail.com', 'contact-B']],
      }),
    )
    expect(res).toBeNull()
  })

  it('psid 和邮箱指向同一个人 → 命中（不算歧义）', () => {
    const res = matchConversationToContact(
      { psid: 'psid_9', messageBodies: ['me@gmail.com'] },
      index({ psids: [['psid_9', 'contact-A']], emails: [['me@gmail.com', 'contact-A']] }),
    )
    expect(res?.contactId).toBe('contact-A')
  })

  it('对不上任何已有身份 → null（不新建）', () => {
    const res = matchConversationToContact(
      { psid: 'unknown_psid', messageBodies: ['stranger@gmail.com'] },
      index({ emails: [['someone.else@gmail.com', 'contact-X']] }),
    )
    expect(res).toBeNull()
  })
})

// ── 编排层：命中才写，且永不 insert contacts ────────────────────────────────

interface Calls {
  conversationsUpdate: number
  identityUpserts: Record<string, unknown>[]
  touchpointUpserts: Record<string, unknown>[][]
  contactsUpdate: number
  contactsWrite: number // insert/upsert into contacts —— 只有「按 psid 建人」那条路允许 >0
  contactInserts: Record<string, unknown>[]
  /** `:out` 那条的「只增」写法：插入（有则不动）+ 条件推进。 */
  outboundInserts: { row: Record<string, unknown>; opts: unknown }[]
  outboundAdvances: { patch: Record<string, unknown>; onlyIfEarlierThan: string | null }[]
  /**
   * 写 contacts 时的 payload + 它带的 `.is(col, null)` 空值守卫。
   *
   * 守卫必须被断言到 —— 「只补空栏，绝不覆盖」是这条路上唯一防止把表单里的旧
   * 号码盖掉客人后来亲口更正的号码的东西（铁律 8）。
   */
  contactUpdates: { patch: Record<string, unknown>; onlyIfNull: string[] }[]
}

/** attachByUniqueFullName 查同名时，库里返回什么 / 它拿什么名字去查。 */
let nameLookupRows: { id: string; display_name: string | null }[] = []
let nameLookupArg: string | null = null
/** 库里那条 `<会话>:out` 触点已有的时间（测「只往前推，绝不回拨」）。 */
let existingOutboundAt: string | null = null
/** `contact_identities` 里这个号码/邮箱当前归谁（测「归属冲突就不写档案」）。 */
let identityOwner: string | null = null
/** `clients.country` —— 决定本地号码补哪个国码。null = 读不出来。 */
let clientCountry: string | null = 'NZ'
/** 档案上现有的主联系方式（决定旧值能不能挂成身份）。 */
let identityWriteFails = false
let contactCurrent: { primary_phone: string | null; primary_email: string | null } | null = {
  primary_phone: null,
  primary_email: null,
}
/** update() 的 payload 暂存，等 .lt() 来配对成一次「条件推进」。 */
let pendingPatch: Record<string, unknown> | null = null

function stubSupabase(): Calls {
  nameLookupRows = []
  nameLookupArg = null
  existingOutboundAt = null
  identityOwner = null
  clientCountry = 'NZ'
  contactCurrent = { primary_phone: null, primary_email: null }
  identityWriteFails = false
  pendingPatch = null
  const calls: Calls = {
    conversationsUpdate: 0,
    identityUpserts: [],
    touchpointUpserts: [],
    contactsUpdate: 0,
    contactsWrite: 0,
    contactInserts: [],
    outboundInserts: [],
    outboundAdvances: [],
    contactUpdates: [],
  }
  // 当前这条 update 链上收集到的 `.is(col, null)`。
  let isNullCols: string[] = []
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      ilike: (_col: string, value: string) => {
        nameLookupArg = value
        return { limit: async () => ({ data: nameLookupRows, error: null }) }
      },
      eq: () => chain,
      is: (col: string, value: unknown) => {
        if (value === null) isNullCols.push(col)
        return chain
      },
      lt: (_col: string, value: string) => {
        // advanceOutboundTouch 的条件推进：只在库里那条更早时才生效。
        if (table === 'contact_touchpoints' && pendingPatch) {
          calls.outboundAdvances.push({ patch: pendingPatch, onlyIfEarlierThan: value })
          pendingPatch = null
        }
        return chain
      },
      in: () => chain,
      // resolveContact 建人时走 insert().select().single()，要还它一个 id。
      single: async () => ({ data: { id: 'contact-NEW' }, error: null }),
      // latestOutboundTouchAt 读库里那条既有的出站触点。
      maybeSingle: async () => {
        if (table === 'contact_touchpoints') {
          return { data: existingOutboundAt ? { occurred_at: existingOutboundAt } : null, error: null }
        }
        if (table === 'contact_identities') {
          return { data: identityOwner ? { contact_id: identityOwner } : null, error: null }
        }
        if (table === 'contacts') {
          return { data: contactCurrent, error: null }
        }
        if (table === 'clients') {
          return { data: clientCountry ? { country: clientCountry } : null, error: null }
        }
        return { data: null, error: null }
      },
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
      update: (payload: Record<string, unknown>) => {
        if (table === 'conversations') calls.conversationsUpdate++
        else if (table === 'contacts') {
          calls.contactsUpdate++
          // `.is()` 在 update() 之后才被调用。这里给这条链新开一个数组并把
          // **引用**存进 entry —— 后面的 `.is()` 往同一个数组里推，下一条 update
          // 再换一个新数组，互不串味。
          isNullCols = []
          calls.contactUpdates.push({ patch: payload, onlyIfNull: isNullCols })
        } else if (table === 'contact_touchpoints') pendingPatch = payload
        return chain
      },
      insert: (payload: Record<string, unknown>) => {
        if (table === 'contacts') {
          calls.contactsWrite++
          calls.contactInserts.push(payload)
        }
        return chain
      },
      upsert: (payload: Record<string, unknown> | Record<string, unknown>[], upsertOpts?: unknown) => {
        if (table === 'contact_identities') {
          // resolveContact 传数组、link-contacts 传单对象 —— 摊平成一串行，断言只看行。
          calls.identityUpserts.push(...(Array.isArray(payload) ? payload : [payload]))
          if (identityWriteFails) {
            return { error: { message: '身份表写失败' } } as never
          }
        }
        else if (table === 'contact_touchpoints') {
          if (Array.isArray(payload)) calls.touchpointUpserts.push(payload)
          else {
            // 单对象 = advanceOutboundTouch 的第一步（插入，有则不动）。
            // 也并进 touchpointUpserts —— 对「写了哪些触点」这类断言来说，
            // 它跟以前那条 outbound 行是同一件事，只是走了另一条写法。
            calls.outboundInserts.push({ row: payload, opts: upsertOpts })
            calls.touchpointUpserts.push([payload])
          }
        }
        else if (table === 'contacts') calls.contactsWrite++
        return chain
      },
    }
    return chain as never
  })
  return calls
}

const baseInput = {
  clientId: 'client-A',
  conversationId: 'convo-uuid-1',
  psid: 'psid_9',
  participantName: 'Robyn Richards',
  messageCount: 4,
  lastMessageFrom: 'page' as const,
  lastMessageAt: '2026-07-24T10:00:00+0000',
  // 客户先留言(带邮箱)→ 真人在收件箱回复(source:chat)。真人回复才写 outbound 触点。
  messages: [
    { direction: 'inbound' as const, body: 'robyn.richards1@gmail.com', sentAt: '2026-07-24T08:00:00+0000' },
    { direction: 'outbound' as const, body: 'Hi from CTS', sentAt: '2026-07-24T10:00:00+0000', tags: ['source:chat'] },
  ],
  existingContactId: null,
}

describe('linkMessengerConversation', () => {
  it('对不上任何人、但客户开过口 → 按 psid 建一个只带 Facebook 身份的人', async () => {
    const calls = stubSupabase()
    const res = await linkMessengerConversation(
      {
        ...baseInput,
        psid: 'nobody',
        messages: [{ direction: 'inbound', body: 'hi', sentAt: '2026-07-24T10:00:00+0000' }],
      },
      index({}),
    )

    expect(res).toMatchObject({ contactId: 'contact-NEW', linked: true, created: true, matchedBy: 'created' })
    expect(calls.contactsWrite).toBe(1)
    // 只有 Facebook 身份，电话邮箱留空 —— 不假装知道他的联系方式。
    expect(calls.contactInserts[0]).toMatchObject({
      client_id: 'client-A',
      display_name: 'Robyn Richards',
      primary_phone: null,
      primary_email: null,
    })
    // 对话接上了，触点也写了 —— 这个人从此出现在「今天该联系谁」里。
    expect(calls.conversationsUpdate).toBe(1)
    expect(calls.touchpointUpserts.flat()).toHaveLength(1)
  })

  it('建人时只带 fb_psid 一个身份 —— 结构上不可能合并两个真人', async () => {
    const calls = stubSupabase()
    await linkMessengerConversation(
      {
        ...baseInput,
        psid: 'nobody',
        // 正文里同时有邮箱和电话：**都不许**参与建人（那正是假 info@ 客户的来路）。
        messages: [
          { direction: 'inbound', body: 'me@gmail.com / 021 363 598', sentAt: '2026-07-24T10:00:00+0000' },
        ],
      },
      index({}),
    )

    const kinds = calls.identityUpserts.map((i) => i.kind)
    expect(new Set(kinds)).toEqual(new Set(['fb_psid']))
    expect(kinds).not.toContain('email')
    expect(kinds).not.toContain('phone')
  })

  it('没有 psid → 不建人（没有唯一编号就没有可靠身份）', async () => {
    const calls = stubSupabase()
    const res = await linkMessengerConversation(
      {
        ...baseInput,
        psid: null,
        messages: [{ direction: 'inbound', body: 'hi', sentAt: '2026-07-24T10:00:00+0000' }],
      },
      index({}),
    )
    expect(res).toMatchObject({ contactId: null, linked: false, created: false })
    expect(calls.contactsWrite).toBe(0)
    expect(calls.touchpointUpserts.length).toBe(0)
  })

  it('客户一句话都没说（纯出站群发）→ 不建人', async () => {
    const calls = stubSupabase()
    const res = await linkMessengerConversation(
      {
        ...baseInput,
        psid: 'nobody',
        messages: [
          { direction: 'outbound', body: '欢迎联系 CTS', sentAt: '2026-07-24T10:00:00+0000', tags: ['source:chat'] },
        ],
      },
      index({}),
    )
    expect(res).toMatchObject({ contactId: null, linked: false, created: false })
    expect(calls.contactsWrite).toBe(0)
    expect(calls.conversationsUpdate).toBe(0)
  })

  it('命中邮箱 → 接上人、挂 psid 身份、写来信+回复两条触点，绝不建 contact', async () => {
    const calls = stubSupabase()
    const res = await linkMessengerConversation(
      baseInput,
      index({ emails: [['robyn.richards1@gmail.com', 'contact-R']] }),
    )

    expect(res).toMatchObject({ contactId: 'contact-R', linked: true, matchedBy: 'email' })
    expect(calls.conversationsUpdate).toBe(1)
    // 挂上 fb_psid 身份
    expect(calls.identityUpserts).toHaveLength(1)
    expect(calls.identityUpserts[0]).toMatchObject({ kind: 'fb_psid', value: 'psid_9', contact_id: 'contact-R' })
    // 一条 inbound + 一条 outbound 触点
    const tps = calls.touchpointUpserts.flat()
    expect(tps).toHaveLength(2)
    expect(tps.map((t) => t.direction).sort()).toEqual(['inbound', 'outbound'])
    expect(tps.every((t) => t.channel === 'messenger')).toBe(true)
    expect(tps.map((t) => t.source_ref).sort()).toEqual(['convo-uuid-1:in', 'convo-uuid-1:out'])
    // 最关键：整个过程不许 insert/upsert contacts
    expect(calls.contactsWrite).toBe(0)
  })

  it('已接过(existingContactId 有值) → 不重新匹配，只刷新触点', async () => {
    const calls = stubSupabase()
    const res = await linkMessengerConversation(
      { ...baseInput, existingContactId: 'contact-OLD', psid: null },
      index({}), // 空索引也无所谓，因为不该走匹配
    )
    expect(res).toMatchObject({ contactId: 'contact-OLD', linked: false, matchedBy: 'already' })
    expect(calls.conversationsUpdate).toBe(0) // 已接过，不再改 contact_id
    expect(calls.touchpointUpserts.flat()).toHaveLength(2) // 但触点照常刷新
    expect(calls.contactsWrite).toBe(0)
  })
})

// ── 端到端:三种线程 → 分段 ──────────────────────────────────────────────────
//
// 魏征在 PR #673 复审提的:Page 出站包含 Meta 自动回复(instant reply / Business AI),
// 把它当「我们联系过」会让热新线索掉出「今天该联系谁」名单。这里把 linker 实际写出的
// 触点喂回 segments,断言最终分段 —— 核心:一条 AI 自动回复不该改变新线索的分段。

const NOW = new Date('2026-07-25T00:00:00Z')
const AT = (h: number) => `2026-07-24T${String(h).padStart(2, '0')}:00:00+0000`

type ThreadMsg = { direction: 'inbound' | 'outbound'; body: string; sentAt: string; tags?: string[] }

/** 跑一遍 linker（按 psid 强制接上人），把它写出的触点转成 ContactLike，返回最终分段。 */
async function segmentAfterLink(messages: ThreadMsg[]) {
  const calls = stubSupabase()
  await linkMessengerConversation(
    { ...baseInput, messages, existingContactId: null, psid: 'psid_9' },
    index({ psids: [['psid_9', 'contact-Z']] }),
  )
  const rows = calls.touchpointUpserts.flat()
  const touchpoints: TouchpointLike[] = rows.map((r) => ({
    channel: r.channel as string,
    direction: r.direction as 'inbound' | 'outbound',
    occurredAt: r.occurred_at as string,
  }))
  const contact: ContactLike = { id: 'contact-Z', displayName: 'Robyn', doNotContact: false, touchpoints }
  return { segment: segmentContact(contact, NOW).segment, directions: touchpoints.map((t) => t.direction).sort() }
}

describe('linkMessengerConversation → segments（真人回复 vs AI 自动回复）', () => {
  it('customer-last：客户留言、没人回 → new_untouched（从没人碰过）', async () => {
    const { segment, directions } = await segmentAfterLink([
      { direction: 'inbound', body: 'hi, I want the China tour', sentAt: AT(8) },
    ])
    expect(directions).toEqual(['inbound'])
    expect(segment).toBe('new_untouched')
  })

  it('AI-last：客户留言后只有 Business AI 自动回了一句 → 仍是 new_untouched（修复点）', async () => {
    const { segment, directions } = await segmentAfterLink([
      { direction: 'inbound', body: 'hi, I want the China tour', sentAt: AT(8) },
      {
        direction: 'outbound',
        body: 'Thanks for messaging CTS! An agent will reply soon.',
        sentAt: AT(9),
        tags: ['inbox', 'source:business_ai'],
      },
    ])
    // 关键:AI 自动回复没写 outbound 触点 → lastOutbound 仍为 0 → 跟「没人回」同一段。
    expect(directions).toEqual(['inbound'])
    expect(segment).toBe('new_untouched')
  })

  it('human-last：客户留言后真人客服回了（source:chat）→ 写 outbound 触点、脱离 new_untouched', async () => {
    const { segment, directions } = await segmentAfterLink([
      { direction: 'inbound', body: 'hi, I want the China tour', sentAt: AT(8) },
      { direction: 'outbound', body: 'Sure! Which dates suit you?', sentAt: AT(9), tags: ['inbox', 'source:chat'] },
    ])
    expect(directions).toEqual(['inbound', 'outbound'])
    // 真人回过、客户还没接话 → 聊过没下文（仍在名单里，只是不再冒充「从没人碰过」）。
    expect(segment).toBe('stale_conversation')
  })

  it('欢迎语在客户开口之前（即便 tag 像真人）→ 不算人工联系 → new_untouched', async () => {
    const { segment, directions } = await segmentAfterLink([
      { direction: 'outbound', body: 'Welcome to CTS 👋', sentAt: AT(8), tags: ['source:chat'] },
      { direction: 'inbound', body: 'hi', sentAt: AT(10) },
    ])
    expect(directions).toEqual(['inbound'])
    expect(segment).toBe('new_untouched')
  })

  it('真人回复后客户又追问、末尾还有 AI 自动确认 → replied（AI 确认不掩盖真人欠回复）', async () => {
    const { segment } = await segmentAfterLink([
      { direction: 'inbound', body: 'hi', sentAt: AT(8) },
      { direction: 'outbound', body: 'Sure, which dates?', sentAt: AT(9), tags: ['source:chat'] },
      { direction: 'inbound', body: 'early November', sentAt: AT(10) },
      { direction: 'outbound', body: 'Thanks, an agent will follow up.', sentAt: AT(11), tags: ['source:business_ai'] },
    ])
    // lastHumanOut = 09:00，客户最后一条 10:00 更晚 → 客户在等我们（真人）回。
    expect(segment).toBe('replied')
  })
})

// ── 唯一全名认亲（2026-07-31 PM 反馈「有大量重名的」后加的第 2 级）─────────────
//
// 一个人先填表单（留电话邮箱、没有 psid）、后来又来私信（有 psid、没邮箱），
// 两边没有共同的键 → 被拆成两条。这一级用「完整姓名 + 全库唯一 + 对方还没 psid」
// 把 psid 挂到已有的人身上，而不是新建第二条。
describe('唯一全名认亲', () => {
  const inbound = [{ direction: 'inbound' as const, body: '想问长城团', sentAt: '2026-07-24T10:00:00+0000' }]

  it('唯一同名、对方还没 Facebook 身份 → 挂上去，不新建', async () => {
    const calls = stubSupabase()
    nameLookupRows = [{ id: 'contact-FORM', display_name: 'Robyn Richards' }]

    const res = await linkMessengerConversation(
      { ...baseInput, psid: 'new_psid', messages: inbound },
      index({}),
    )

    expect(res).toMatchObject({ contactId: 'contact-FORM', linked: true, created: false, matchedBy: 'name' })
    expect(calls.contactsWrite).toBe(0) // 关键：一条新记录都没多出来
    expect(calls.identityUpserts).toContainEqual(
      expect.objectContaining({ kind: 'fb_psid', value: 'new_psid', contact_id: 'contact-FORM' }),
    )
  })

  it('🔴「Facebook 用户」是占位符，绝不参与认亲（否则 14 个陌生人会互相认成一个）', async () => {
    const calls = stubSupabase()
    // 就算库里真有一条同名的，也不许拿这个名字去认。
    nameLookupRows = [{ id: 'contact-OTHER', display_name: 'Facebook 用户' }]

    const res = await linkMessengerConversation(
      { ...baseInput, psid: 'new_psid', participantName: 'Facebook 用户', messages: inbound },
      index({}),
    )

    expect(res.matchedBy).toBe('created')
    expect(nameLookupArg).toBeNull() // 压根没去查
    // 占位符也不当人名存 —— 列表里不会出现一堆一模一样的「人」
    expect(calls.contactInserts[0].display_name).toBeNull()
  })

  it('单字名不认（重名概率太高）', async () => {
    stubSupabase()
    nameLookupRows = [{ id: 'contact-X', display_name: 'Robyn' }]
    const res = await linkMessengerConversation(
      { ...baseInput, psid: 'new_psid', participantName: 'Robyn', messages: inbound },
      index({}),
    )
    expect(res.matchedBy).toBe('created')
    expect(nameLookupArg).toBeNull()
  })

  it('撞到两个同名 → 弃权，照旧独立建人', async () => {
    const calls = stubSupabase()
    nameLookupRows = [
      { id: 'contact-1', display_name: 'Robyn Richards' },
      { id: 'contact-2', display_name: 'Robyn Richards' },
    ]
    const res = await linkMessengerConversation(
      { ...baseInput, psid: 'new_psid', messages: inbound },
      index({}),
    )
    expect(res.matchedBy).toBe('created')
    expect(calls.contactsWrite).toBe(1)
  })

  it('同名的那个人身上已经有 Facebook 身份 → 弃权（他是另一个 Messenger 用户，抢不得）', async () => {
    const calls = stubSupabase()
    nameLookupRows = [{ id: 'contact-TAKEN', display_name: 'Robyn Richards' }]
    const res = await linkMessengerConversation(
      { ...baseInput, psid: 'new_psid', messages: inbound },
      // 索引里 contact-TAKEN 已经挂着另一个 psid
      index({ psids: [['some_other_psid', 'contact-TAKEN']] }),
    )
    expect(res.matchedBy).toBe('created')
    expect(calls.contactsWrite).toBe(1)
  })

  it('身份键能认到的时候不走这一级（psid 命中优先）', async () => {
    stubSupabase()
    nameLookupRows = [{ id: 'contact-FORM', display_name: 'Robyn Richards' }]
    const res = await linkMessengerConversation(
      { ...baseInput, psid: 'psid_9', messages: inbound },
      index({ psids: [['psid_9', 'contact-A']] }),
    )
    expect(res).toMatchObject({ contactId: 'contact-A', matchedBy: 'psid' })
    expect(nameLookupArg).toBeNull()
  })
})

/**
 * 🔴 **「我们最后一次回他」这个时间只往前推，绝不回拨**
 * （Codex 复审 2026-08-15，PR #988 P1）。
 *
 * 销售在 ME 页面回私信时会就地写一笔出站触点，卡片当场变灰（不然要等最长
 * 一小时的同步）。它跟这里用**同一个幂等键**，两边落在同一行上。
 *
 * 问题出在下一次同步：「回得太快 = 机器」那条判据（30 秒内）会把**销售盯着
 * 页面秒回**这种最该鼓励的行为判成自动回复 → `lastHumanOutboundAt` 退回到更早
 * 的某条回复 → upsert 把时间往回拨 → `/crm/today` 不再认为今天跟过他 →
 * **卡片重新亮起，销售再回一遍，客人收到两条一样的消息。**
 */
describe('出站触点的时间只往前推 —— 而且是数据库自己判，不是先读再写', () => {
  const fastReply = {
    ...baseInput,
    messages: [
      { direction: 'inbound' as const, body: '还有位吗', sentAt: '2026-07-24T10:00:00+0000' },
      // 10 秒后回的 —— 真人盯着屏幕秒回，但会被「秒回 = 机器」判成自动回复
      { direction: 'outbound' as const, body: '有的', sentAt: '2026-07-24T10:00:10+0000', tags: [] },
    ],
  }

  /**
   * 第一步：**有了就绝不覆盖**。回拨就是从这里来的 ——
   * ME 刚写下的新时间，不能被同步算出来的旧时间盖掉。
   */
  it('插入那一步带 ignoreDuplicates —— 已有的一律不动', async () => {
    const calls = stubSupabase()
    await linkMessengerConversation(baseInput, index({ psids: [['psid_9', 'contact-1']] }))

    expect(calls.outboundInserts).toHaveLength(1)
    expect(calls.outboundInserts[0].opts).toEqual({
      onConflict: 'client_id,source,source_ref',
      ignoreDuplicates: true,
    })
  })

  /**
   * 第二步：条件推进。`WHERE occurred_at < 新值` 交给数据库判 ——
   * **这一步只可能让时间变晚**，不管跟谁交错。
   *
   * 上一版是「读出来取最大值再写」，有竞态（Codex 第二轮 P2）：同步读到旧值
   * 之后、写回之前销售正好发送成功，缓存的旧值照样会盖掉新值。
   * 窗口很窄，但「客人收到两条一样的消息」这种代价不该赌概率。
   */
  it('推进那一步把「只在更早时才改」交给数据库判', async () => {
    const calls = stubSupabase()
    await linkMessengerConversation(baseInput, index({ psids: [['psid_9', 'contact-1']] }))

    expect(calls.outboundAdvances).toHaveLength(1)
    expect(calls.outboundAdvances[0].onlyIfEarlierThan).toBe('2026-07-24T10:00:00+0000')
    expect(calls.outboundAdvances[0].patch.occurred_at).toBe('2026-07-24T10:00:00+0000')
  })

  /** 秒回被判成机器人时也一样 —— 算出来的时间照旧只能往前推，推不动就不动。 */
  it('秒回被判成机器人 → 这次算不出真人回复，一个字都不写', async () => {
    const calls = stubSupabase()
    await linkMessengerConversation(fastReply, index({ psids: [['psid_9', 'contact-1']] }))

    // 那条 10 秒内的回复被 isAutomatedPageMessage 跳过，没有别的真人出站 →
    // 不写出站触点。库里 ME 刚写的那条**原样留着**，卡片保持灰色。
    expect(calls.outboundInserts).toHaveLength(0)
    expect(calls.outboundAdvances).toHaveLength(0)
  })

  /** 客户来信那条不受影响，照旧正常刷新。 */
  it('入站那条照旧走普通刷新', async () => {
    const calls = stubSupabase()
    await linkMessengerConversation(baseInput, index({ psids: [['psid_9', 'contact-1']] }))

    const inbound = calls.touchpointUpserts.flat().filter((r) => r.direction === 'inbound')
    expect(inbound).toHaveLength(1)
  })
})

/**
 * 🔴 **PM 2026-08-17 报的线上问题**：卡片写着「💬 没留电话 —— 只能在 Messenger
 * 回他」，而那个人明明在第一条私信里留了电话和邮箱。
 *
 * 正文早就同步进来了，只是从来没人把它取出来 —— 认人用完就丢。
 * 销售信了卡片那句话跑去私信回，而客人在等电话。
 */
describe('「点私信」开场白里的电话邮箱 → 补进档案', () => {
  /** PM 从线上后台照抄的原文。 */
  const INTRO = `Hello! I filled out your form and would like to know more about your business.
Full name: Jordan Avery
Phone number: 021 555 0134
Which tour interests you most?: Still deciding — show me all 4
Email: jordan.avery.example@example.com`

  /**
   * 只看**补档案**那几条 —— `linkMessengerConversation` 还会顺手推
   * `last_seen_at` / `updated_at`，那是另一件事。
   */
  const BACKFILL_COLS = ['primary_phone', 'primary_email', 'display_name']
  const backfillUpdates = (calls: Calls) =>
    calls.contactUpdates.filter((u) => Object.keys(u.patch).some((c) => BACKFILL_COLS.includes(c)))

  const introInput = {
    ...baseInput,
    existingContactId: 'contact-M',
    messages: [{ direction: 'inbound' as const, body: INTRO, sentAt: '2026-07-24T08:00:00+0000' }],
  }

  it('电话和邮箱都挂成身份', async () => {
    const calls = stubSupabase()
    await linkMessengerConversation(introInput, index({}))

    const byKind = new Map(calls.identityUpserts.map((i) => [i.kind, i.value]))
    expect(byKind.get('phone')).toBe('+64215550134')
    expect(byKind.get('email')).toBe('jordan.avery.example@example.com')
  })

  it('档案上的电话和邮箱补上', async () => {
    const calls = stubSupabase()
    await linkMessengerConversation(introInput, index({}))

    const patches = backfillUpdates(calls).map((u) => u.patch)
    expect(patches).toContainEqual({ primary_phone: '+64215550134' })
    expect(patches).toContainEqual({ primary_email: 'jordan.avery.example@example.com' })
  })

  /**
   * 🔴 这条是整段最要紧的：**只补空栏，绝不覆盖**（铁律 8）。
   * 客人后来亲口更正过的号码，比表单里那个新。
   */
  it('🔴 每一条写入都带着「只在还空着时才写」的守卫', async () => {
    const calls = stubSupabase()
    await linkMessengerConversation(introInput, index({}))

    const updates = backfillUpdates(calls)
    expect(updates.length).toBeGreaterThan(0)
    for (const u of updates) {
      const col = Object.keys(u.patch)[0]
      expect(u.onlyIfNull).toContain(col)
    }
  })

  /** 一栏一条语句 —— 合成一条的话，只要有一栏已有值，另一栏也跟着写不进去。 */
  it('一条语句只写一栏', async () => {
    const calls = stubSupabase()
    await linkMessengerConversation(introInput, index({}))
    for (const u of backfillUpdates(calls)) expect(Object.keys(u.patch)).toHaveLength(1)
  })

  it('普通聊天不会被当成开场白', async () => {
    const calls = stubSupabase()
    await linkMessengerConversation(
      {
        ...introInput,
        messages: [
          {
            direction: 'inbound',
            body: 'Hi, my number is 021 555 000, is the March tour still on?',
            sentAt: '2026-07-24T08:00:00+0000',
          },
        ],
      },
      index({}),
    )
    expect(backfillUpdates(calls)).toHaveLength(0)
    expect(calls.identityUpserts.map((i) => i.kind)).not.toContain('phone')
  })


  /**
   * 🔴 **号码已经归别人了就别写进这个人的档案**（Codex 复审 2026-08-17）。
   *
   * 身份表那句 `ignoreDuplicates` 只保证身份不被抢走，挡不住继续把同一个号码
   * 写进**这个人**的 `primary_phone` —— 那样两份档案显示同一个号码，而身份表
   * 指向原来那个人，销售照着卡片打过去联系的是另一个人。
   */
  it('🔴 电话/邮箱已归另一个联系人 → 那两栏不写进这个人的档案', async () => {
    const calls = stubSupabase()
    identityOwner = 'contact-SOMEONE-ELSE'
    await linkMessengerConversation(introInput, index({}))

    const cols = backfillUpdates(calls).flatMap((u) => Object.keys(u.patch))
    expect(cols).not.toContain('primary_phone')
    expect(cols).not.toContain('primary_email')
    // 名字不受身份归属影响 —— 它不是唯一键，补上只是把 Facebook 昵称换成全名。
    expect(cols).toContain('display_name')
  })

  it('身份本来就归他自己 → 照旧补', async () => {
    const calls = stubSupabase()
    identityOwner = 'contact-M'
    await linkMessengerConversation(introInput, index({}))
    expect(backfillUpdates(calls).length).toBeGreaterThan(0)
  })

  /**
   * 🔴 **市场认不出来就不写电话**（Codex 复审 2026-08-17）。原先退回 NZ ——
   * AU 客户的 `04...` 会被永久写成 `+64...`，销售拨过去是陌生人，
   * 错值还会占住唯一身份表，让以后正确的 AU 身份挂不上。
   */
  it('🔴 读不到客户所在市场 → 本地号码不写', async () => {
    const calls = stubSupabase()
    clientCountry = null
    await linkMessengerConversation(introInput, index({}))

    const cols = backfillUpdates(calls).flatMap((u) => Object.keys(u.patch))
    expect(cols).not.toContain('primary_phone')
    // 邮箱和名字不受市场影响，照旧补。
    expect(cols).toContain('primary_email')
  })

  it('AU 客户按 +61 补，不按 +64', async () => {
    const calls = stubSupabase()
    clientCountry = 'AU'
    await linkMessengerConversation(introInput, index({}))

    const phone = calls.identityUpserts.find((i) => i.kind === 'phone')?.value
    expect(String(phone).startsWith('+61')).toBe(true)
  })

  /**
   * 🔴 **同一个线程里重填过表单 → 取最后一次**（Codex 复审 2026-08-17）。
   * 第一次填错号码、第二次改对；命中就停会把旧值永久写进档案并注册成身份，
   * 而且以后每轮同步都命中同一条旧消息，正确的新值永远没机会。
   */
  it('🔴 重填过表单 → 用后一次的号码，不是第一次的', async () => {
    const calls = stubSupabase()
    const second = INTRO.replace('021 555 0134', '021 555 9999')
    await linkMessengerConversation(
      {
        ...introInput,
        messages: [
          { direction: 'inbound', body: INTRO, sentAt: '2026-07-24T08:00:00+0000' },
          { direction: 'inbound', body: second, sentAt: '2026-07-25T08:00:00+0000' },
        ],
      },
      index({}),
    )
    const phone = calls.identityUpserts.find((i) => i.kind === 'phone')?.value
    expect(phone).toBe('+64215559999')
  })

  /**
   * 🔴 **身份没写成，档案就不能写**（Codex 复审 2026-08-17）。否则卡片显示着
   * 号码、身份表里却没有它：认人认不到，别的渠道进来会再建一个重复的人；
   * 而这个人两栏都满了，又从回填候选集里退出去，再也不会被修。
   */
  it('🔴 身份写入失败 → 档案那两栏也不写', async () => {
    const calls = stubSupabase()
    identityWriteFails = true
    await linkMessengerConversation(introInput, index({}))

    const cols = backfillUpdates(calls).flatMap((u) => Object.keys(u.patch))
    expect(cols).not.toContain('primary_phone')
    expect(cols).not.toContain('primary_email')
  })

  /**
   * 🔴 **两张表单各只补一半 → 按字段各取各的最新非空值**（Codex 复审 2026-08-17）。
   * 整对象取最后一条的话，后一张只更正电话时，前一张里那个有效的邮箱会被丢掉，
   * 而邮箱那一栏仍然空着、下一轮又选中同一个末次对象，永远补不回来。
   */
  it('🔴 后一张表单只带电话 → 前一张的邮箱不能丢', async () => {
    const calls = stubSupabase()
    const second =
      'Hello! I filled out your form and would like to know more about your business.\nPhone number: 021 555 9999'
    await linkMessengerConversation(
      {
        ...introInput,
        messages: [
          { direction: 'inbound', body: INTRO, sentAt: '2026-07-24T08:00:00+0000' },
          { direction: 'inbound', body: second, sentAt: '2026-07-25T08:00:00+0000' },
        ],
      },
      index({}),
    )
    const byKind = new Map(calls.identityUpserts.map((i) => [i.kind, i.value]))
    expect(byKind.get('phone')).toBe('+64215559999')
    expect(byKind.get('email')).toBe('jordan.avery.example@example.com')
  })

  /**
   * 🔴 **档案上已有一个更正过的号码时，旧号码连身份都不该挂**
   * （Codex 复审 2026-08-17）。身份表是认人用的键 —— 那个号码以后被重新分配、
   * 或当初就填错，`resolveContact` 会把带着它的新线索认成这个人，甚至自动合并
   * 两个人的历史，而合并不可逆。
   */
  it('🔴 档案上已有别的号码 → 表单里那个旧号码不挂成身份', async () => {
    const calls = stubSupabase()
    contactCurrent = { primary_phone: '+64211111111', primary_email: null }
    await linkMessengerConversation(introInput, index({}))

    expect(calls.identityUpserts.map((i) => i.kind)).not.toContain('phone')
    // 邮箱那一栏还空着，照旧补。
    expect(calls.identityUpserts.map((i) => i.kind)).toContain('email')
  })

  it('档案上那个号码跟表单里一模一样 → 照旧挂（幂等）', async () => {
    const calls = stubSupabase()
    contactCurrent = { primary_phone: '+64215550134', primary_email: null }
    await linkMessengerConversation(introInput, index({}))
    expect(calls.identityUpserts.map((i) => i.kind)).toContain('phone')
  })

  /**
   * 🔴 **对话中途转发同行者的资料，不许写进这个人的档案**（Codex 复审 2026-08-17）。
   * 「两条标准字段」那条兜底只对第一条入站消息成立。
   */
  it('🔴 先普通聊天、后面才出现两条字段的转发 → 不补', async () => {
    const calls = stubSupabase()
    await linkMessengerConversation(
      {
        ...introInput,
        messages: [
          { direction: 'inbound', body: 'Hi, is the March tour still on?', sentAt: '2026-07-24T08:00:00+0000' },
          {
            direction: 'inbound',
            body: 'My friend is coming too.\nName: Sam Riley\nPhone: 021 555 999',
            sentAt: '2026-07-24T09:00:00+0000',
          },
        ],
      },
      index({}),
    )
    expect(backfillUpdates(calls)).toHaveLength(0)
  })

  it('中途那条带着表单问候语 → 照旧认（那是真的开场白，只是不在第一条）', async () => {
    const calls = stubSupabase()
    await linkMessengerConversation(
      {
        ...introInput,
        messages: [
          { direction: 'inbound', body: 'Hi there', sentAt: '2026-07-24T08:00:00+0000' },
          { direction: 'inbound', body: INTRO, sentAt: '2026-07-24T09:00:00+0000' },
        ],
      },
      index({}),
    )
    expect(backfillUpdates(calls).length).toBeGreaterThan(0)
  })

  /** 我们自己发出去的模板不作数 —— 只认客人自己发的那条。 */
  it('出站方向的同样一段文字 → 不补', async () => {
    const calls = stubSupabase()
    await linkMessengerConversation(
      {
        ...introInput,
        messages: [
          { direction: 'outbound', body: INTRO, sentAt: '2026-07-24T08:00:00+0000', tags: ['source:chat'] },
        ],
      },
      index({}),
    )
    expect(backfillUpdates(calls)).toHaveLength(0)
  })
})
