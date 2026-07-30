/**
 * Messenger → 已有联系人 的「只 LINK 不 CREATE」接线。
 *
 * 钉住三件最容易悄悄错的事：
 *   1. 业务自家邮箱(info@ctstours.co.nz)出现在正文里，绝不能当成客户身份 —— 否则
 *      Meta 自动回复会把几十段对话错并到一个假「info@」客户上。
 *   2. 一段对话命中两个不同的人 = 歧义，宁可不接（错接不可逆）。
 *   3. 无论如何都不新建/合并联系人：对不上就留白，绝不 insert contacts。
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
  contactsWrite: number // insert/upsert into contacts —— 必须恒为 0
}

function stubSupabase(): Calls {
  const calls: Calls = {
    conversationsUpdate: 0,
    identityUpserts: [],
    touchpointUpserts: [],
    contactsUpdate: 0,
    contactsWrite: 0,
  }
  ;(supabaseAdmin.from as ReturnType<typeof vi.fn>).mockImplementation((table: string) => {
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      lt: () => chain,
      in: () => chain,
      single: async () => ({ data: null, error: null }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: null }).then(resolve),
      update: () => {
        if (table === 'conversations') calls.conversationsUpdate++
        else if (table === 'contacts') calls.contactsUpdate++
        return chain
      },
      insert: () => {
        if (table === 'contacts') calls.contactsWrite++
        return chain
      },
      upsert: (payload: Record<string, unknown> | Record<string, unknown>[]) => {
        if (table === 'contact_identities') calls.identityUpserts.push(payload as Record<string, unknown>)
        else if (table === 'contact_touchpoints') calls.touchpointUpserts.push(payload as Record<string, unknown>[])
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
  it('对不上任何人 → 一次写库都不发生（尤其不建 contact）', async () => {
    const calls = stubSupabase()
    const res = await linkMessengerConversation(
      { ...baseInput, psid: 'nobody', messages: [{ direction: 'inbound', body: 'hi', sentAt: '2026-07-24T10:00:00+0000' }] },
      index({}),
    )
    expect(res.linked).toBe(false)
    expect(res.contactId).toBeNull()
    expect(calls.conversationsUpdate).toBe(0)
    expect(calls.touchpointUpserts.length).toBe(0)
    expect(calls.contactsWrite).toBe(0)
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
    const tps = calls.touchpointUpserts[0]
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
    expect(calls.touchpointUpserts[0]).toHaveLength(2) // 但触点照常刷新
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
  const rows = calls.touchpointUpserts[0] ?? []
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
