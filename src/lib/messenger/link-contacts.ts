/**
 * 把一段 Messenger 对话接到人身上：优先接已有的真人，接不上就**只按 fb_psid** 建人。
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 原来的红线，和这次为什么能安全地开一个口子
 * ─────────────────────────────────────────────────────────────────────────
 * 原规则是「只 LINK，绝不 CREATE」。理由（三审焊死）：Meta 的 Page 自动回复 /
 * Business AI 会把业务自己的 info@ctstours.co.nz、电话写进对话正文，**从正文抽
 * 联系方式建人**会造出一个假的「info@」客户，并把几十段对话错并上去（魏征）。
 *
 * 那条理由针对的是「**从正文正则抽出来的**联系方式」，不是「建人」本身。
 * 2026-07-30 量出来的代价：CTS 458 段对话里 151 段挂不到任何人，其中 130 段是
 * 有来有回的真人；最近 3 天有新消息的 24 段里 22 段是系统看不见的人 —— 这些人
 * 永远不会出现在「今天该联系谁」。
 *
 * 所以这次只开这一个口子：**建人只用 fb_psid**（Meta 在 participants 里给的那个
 * 人的唯一编号），绝不用正文里抽到的邮箱/电话建人。原来的坑结构上进不来 ——
 * 自动回复写进正文的 info@ 不是 psid，造不出假客户。
 *
 * 两条护栏跟着这个口子一起焊死：
 *   1. **客户自己开过口才建人**（线程里至少有一条 inbound）。纯出站的群发 /
 *      自动欢迎语不配升级成客户（板桥「护栏 · 一等公民」：只有真实双向触点才算）。
 *   2. **建人时只带 fb_psid 一个身份** → resolveContact 最多命中一个既有联系人，
 *      **结构上不可能触发两个真人的不可逆合并**。这正是本模块原来绕开
 *      resolveContact 的那个风险，单身份调用把它消掉了，所以这里可以放心用它。
 *      （identity.ts 的模块注释本来就写着这种人应「如实返回一个只带 fb_psid 的
 *      contact」—— 这次是把那句话兑现，不是新发明。）
 *
 * 接已有人的匹配规则不变：psid 已知，或客户自己的邮箱原样出现在正文（排除业务自家
 * 域名）；命中两个不同的人 = 歧义，宁可留白也不错接。
 *
 * ── 认人的三级顺序（2026-07-31 补了中间这一级）───────────────────────────
 *   1. **身份键**：psid 已知 / 正文里出现已有客户的邮箱          → 接上
 *   2. **唯一全名**：完整姓名 + 全库唯一同名 + 对方还没有 psid   → 挂上去，不新建
 *   3. 都认不到                                                  → 按 psid 新建
 *
 * 第 2 级是为了修「同一个人被拆成两条」：表单不给 psid、私信不给邮箱，先填表后私信
 * 的人两边没有共同的键。CTS 实测 132 个只有 Facebook 身份的人里 29 个是这么拆出来的
 * （详见 attachByUniqueFullName 的说明，含它为什么不触碰 identity.ts 的那条红线）。
 *
 * 建出来的人只有 Facebook 身份、没有电话邮箱 —— 销售只能在 Messenger 回他。等他
 * 哪天留了邮箱/电话，靠 contact_identities 的唯一约束自动并成同一个人。
 *
 * 幂等：conversations 只补 NULL；fb_psid 身份 ON CONFLICT DO NOTHING（所以重跑
 * 不会把同一个人建两次）；触点按 (thread + 方向) 唯一键 upsert（重同步刷新
 * occurred_at）；last_seen 只往前推。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { isAutomatedPageMessage } from '@/lib/messenger/automation'
import { buildIdentities, resolveContact } from '@/lib/crm/identity'

export interface IdentityIndex {
  /** 归一化邮箱 -> contactId（同一 client 下邮箱唯一，所以是 1:1）。 */
  byEmail: Map<string, string>
  /** fb_psid -> contactId（回填后已挂上的，命中即最强证据）。 */
  byPsid: Map<string, string>
}

/** 这些域名出现在正文里是「业务自己的」联系方式，不能当成客户身份。 */
const BUSINESS_EMAIL_DOMAINS = ['ctstours.co.nz']

/**
 * Meta 在拿不到用户资料名时返回的**占位符**，不是人名。
 *
 * 为什么必须单独列出来、不能只靠「≥2 个词」筛掉：「Facebook 用户」正好是两个词，
 * 会通过词数检查。CTS 实测有 14 个人都叫这个 —— 一旦让它参与按姓名认亲，这 14 个
 * 互不相干的真人就会互相认亲，接到同一个人身上。
 */
const META_PLACEHOLDER_NAMES = new Set([
  'facebook 用户',
  'facebook用户',
  'facebook user',
])

/** 占位符 / 空白一律当「没有名字」。返回 null 表示这个人还没留下真名。 */
export function realDisplayName(raw: string | null | undefined): string | null {
  const s = (raw ?? '').trim()
  if (!s) return null
  return META_PLACEHOLDER_NAMES.has(s.toLowerCase()) ? null : s
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi

export interface ConversationMatchInput {
  psid: string | null
  messageBodies: string[]
}

/**
 * 这段对话对应系统里哪一个已有的人。命中唯一一人才返回；命中 0 个或 >1 个都返回
 * null（>1 = 歧义，错接不可逆，宁可留白）。绝不新建。
 */
export function matchConversationToContact(
  input: ConversationMatchInput,
  index: IdentityIndex,
): { contactId: string; matchedBy: 'psid' | 'email' } | null {
  const found: string[] = []
  const remember = (id: string) => {
    if (!found.includes(id)) found.push(id)
  }
  let via: 'psid' | 'email' | null = null

  // 1) psid 已知 —— 最强、最干净的键
  if (input.psid) {
    const c = index.byPsid.get(input.psid)
    if (c) {
      remember(c)
      via = 'psid'
    }
  }

  // 2) 正文里出现「已有真客户的邮箱」（排除业务自家域名）
  for (const body of input.messageBodies) {
    // .match(/g) 返回字符串数组（或 null），避免 matchAll 的迭代器（编译目标不支持）。
    const emails = body.toLowerCase().match(EMAIL_RE)
    if (!emails) continue
    for (const email of emails) {
      if (BUSINESS_EMAIL_DOMAINS.some((d) => email.endsWith(`@${d}`) || email.endsWith(`.${d}`))) {
        continue
      }
      const c = index.byEmail.get(email)
      if (c) {
        remember(c)
        if (!via) via = 'email'
      }
    }
  }

  // 命中两个不同的人 = 歧义，宁可不接（错接不可逆）。
  if (found.length !== 1) return null
  return { contactId: found[0], matchedBy: via ?? 'email' }
}

export interface LinkConversationInput {
  clientId: string
  /** conversations.id（UUID 主键）。 */
  conversationId: string
  psid: string | null
  participantName: string | null
  messageCount: number
  lastMessageFrom: 'customer' | 'page' | null
  /** conversations.last_message_at，用于把 contact.last_seen_at 往前推。 */
  lastMessageAt: string | null
  messages: {
    direction: 'inbound' | 'outbound'
    body: string
    sentAt: string
    /** Meta 的 `tags.data[].name`（判定真人 vs 自动回复用，见 lib/messenger/automation）。 */
    tags?: string[]
  }[]
  /** conversations.contact_id 现值；非空则已接过，只刷新触点、不重新匹配。 */
  existingContactId: string | null
  /**
   * 这批消息带没带 Meta 的 `tags`。默认 true（实时同步从 Graph 直接拿，带）。
   *
   * 回补历史对话时是 **false**：`conversation_messages` 表根本没存 tags
   * （建表时就没这一列），所以分不出「真人客服回的」和「Business AI 自动回的」。
   * 这种情况下**一条出站触点都不写** —— 宁可让这个人在「今天该联系谁」里多露一次
   * 面，也不要把机器人问候当成「我们联系过」，把该打的热线索埋掉。
   * automation.ts 头部已经写明这是两个错里更便宜的那一个。
   */
  tagsAvailable?: boolean
}

export interface LinkConversationResult {
  contactId: string | null
  /** true = 这次新接上了一个人（含新建的）。 */
  linked: boolean
  /** true = 这次**新建**了一个只带 Facebook 身份的人。`linked` 也会同时为 true。 */
  created: boolean
  /**
   * 'name'    = 按「唯一全名」认到一个已存在的人，把 psid 挂了上去（没新建）
   * 'created' = 连名字都认不到，按 fb_psid 新建的
   */
  matchedBy: 'psid' | 'email' | 'already' | 'name' | 'created' | null
}

/** 取某个方向最后一条消息的时间。 */
function lastSentAt(
  messages: LinkConversationInput['messages'],
  direction: 'inbound' | 'outbound',
): string | null {
  let latest: string | null = null
  for (const m of messages) {
    if (m.direction !== direction) continue
    if (!latest || m.sentAt > latest) latest = m.sentAt
  }
  return latest
}

/**
 * 最后一条**真人**出站消息的时间 —— Meta 的自动回复(欢迎语 / Business AI)不算。
 *
 * 只有真人回复才配写「我们联系过」触点:一条机器人自动问候不是「我们联系过」,把它
 * 当人工联系会让本该 `new_untouched` 的热新线索掉出「今天该联系谁」名单(见
 * lib/messenger/automation 的判定说明)。返回 null = 这段对话里没有任何真人回复。
 */
function lastHumanOutboundAt(messages: LinkConversationInput['messages']): string | null {
  // 某条出站消息「之前是否已有客户来信」= 线程里存在时间不晚于它的 inbound。
  // 取最早的一条 inbound 时间做界:出站时间 >= 它 → 客户先留过言 → 这条出站才可能
  // 是真人在回客户;否则是我们先开口 = 自动欢迎语/广播。
  let firstInboundAt: string | null = null
  for (const m of messages) {
    if (m.direction === 'inbound' && (firstInboundAt === null || m.sentAt < firstInboundAt)) {
      firstInboundAt = m.sentAt
    }
  }

  let latest: string | null = null
  for (const m of messages) {
    if (m.direction !== 'outbound') continue
    const hasPriorInbound = firstInboundAt !== null && m.sentAt >= firstInboundAt
    if (isAutomatedPageMessage({ tags: m.tags ?? [], hasPriorInbound })) continue
    if (!latest || m.sentAt > latest) latest = m.sentAt
  }
  return latest
}

/**
 * 只在 Facebook 上聊过的人 → 建一个**只带 fb_psid** 的联系人。建不了返回 null。
 *
 * 两条前置条件都不满足就不建（理由见模块头部护栏 1/2）：
 *   · 没有 psid —— 没有唯一编号就没有可靠身份，宁可留白
 *   · 线程里没有任何一条客户来信 —— 纯出站的群发/自动欢迎语不算「一个客户」
 *
 * 身份只传 fb_psid 一个，所以 resolveContact 最多命中一个既有联系人，
 * **不可能触发两个真人的合并**。
 */
async function createContactFromPsid(input: LinkConversationInput): Promise<string | null> {
  if (!input.psid) return null
  if (!input.messages.some((m) => m.direction === 'inbound')) return null

  const { contactId } = await resolveContact({
    clientId: input.clientId,
    identities: buildIdentities({ fbPsid: input.psid }),
    // Facebook 的资料名。占位符存成 null —— 把「Facebook 用户」当人名存，
    // 列表里就会出现十几个一模一样的「人」，看起来像重复其实是不同的人。
    // overwriteDisplayName=false：万一这个 psid 已经挂在某个真人身上（并发同步 /
    // 索引过期），不拿 FB 昵称去改人家已有的名字。
    displayName: realDisplayName(input.participantName),
    overwriteDisplayName: false,
    source: 'messenger',
    seenAt: input.lastMessageAt ?? undefined,
  })
  return contactId
}

/**
 * 「唯一全名认亲」—— 把这段对话挂到一个**已存在**的人身上，而不是新建第二条。
 *
 * WHY（2026-07-31 PM 反馈「有大量重名的」）
 * ----------------------------------------
 * 一个人先填了 Facebook 表单（留下电话邮箱），后来又来私信 —— 表单不给 psid、
 * 私信不给邮箱，两边没有任何共同的键，于是同一个人被拆成两条。CTS 实测 132 个
 * 只有 Facebook 身份的人里，29 个是这样拆出来的。
 *
 * 三条同时满足才认，缺一即弃权（弃权 = 照旧独立建人，宁可分开也不认错）：
 *   1. 名字是**完整姓名**（≥2 个词）且不是 Meta 占位符
 *   2. 全客户下**只有一个**同名的人
 *   3. 那个人身上**还没有** fb_psid —— 否则他已经是另一个 Messenger 用户，抢不得
 *
 * 为什么这不是 identity.ts 里禁止的那件事：那条红线禁的是「把两个**已存在**的人
 * 按姓名合成一个」—— 两份历史永久搅在一起、不可逆。这里是「给一个已存在的人**多挂
 * 一个身份**」，没有任何东西被销毁；万一认错，摘掉这一条 fb_psid 身份即可复原。
 *
 * 条件 3 直接用内存里的身份索引判断（loadIdentityIndex 已把全部 fb_psid 载入），
 * 不额外查库。
 */
async function attachByUniqueFullName(
  input: LinkConversationInput,
  index: IdentityIndex,
): Promise<string | null> {
  const name = realDisplayName(input.participantName)
  if (!name) return null
  if (name.split(/\s+/).filter(Boolean).length < 2) return null

  // ilike 不带通配符 = 大小写不敏感的相等比较。limit 5：只要不是唯一命中就弃权，
  // 多取几条足够判断「不止一个」。
  const { data, error } = await supabaseAdmin
    .from('contacts')
    .select('id, display_name')
    .eq('client_id', input.clientId)
    .ilike('display_name', name)
    .limit(5)

  if (error || !data) return null

  const alreadyHasPsid = new Set(index.byPsid.values())
  const candidates = (data as { id: string; display_name: string | null }[])
    .filter((c) => (c.display_name ?? '').trim().toLowerCase() === name.toLowerCase())
    .filter((c) => !alreadyHasPsid.has(c.id))

  return candidates.length === 1 ? candidates[0].id : null
}

/**
 * 把一段已入库的对话接到人身上并写触点：先找已有的人，找不到就按 fb_psid 新建。
 *
 * index 会在命中/新建时就地更新（把 psid 记进去），让同一次同步里后面的对话
 * 能直接命中，不用重查库。
 */
export async function linkMessengerConversation(
  input: LinkConversationInput,
  index: IdentityIndex,
): Promise<LinkConversationResult> {
  let contactId = input.existingContactId
  let matchedBy: LinkConversationResult['matchedBy'] = contactId ? 'already' : null
  let newlyLinked = false
  let created = false

  if (!contactId) {
    const match = matchConversationToContact(
      { psid: input.psid, messageBodies: input.messages.map((m) => m.body) },
      index,
    )

    if (match) {
      contactId = match.contactId
      matchedBy = match.matchedBy
    } else {
      // 身份键（psid / 正文里的邮箱）认不到 —— 再试一次「唯一全名认亲」，
      // 认到就挂上去，认不到才新建。顺序不能反：优先接已有的人，少制造重复。
      const sameName = await attachByUniqueFullName(input, index)
      if (sameName) {
        contactId = sameName
        matchedBy = 'name'
      } else {
        contactId = await createContactFromPsid(input)
        if (!contactId) return { contactId: null, linked: false, created: false, matchedBy: null }
        matchedBy = 'created'
        created = true
      }
    }
    newlyLinked = true

    // 只在仍为 NULL 时写，幂等；别覆盖别处已接好的人。
    await supabaseAdmin
      .from('conversations')
      .update({ contact_id: contactId, updated_at: new Date().toISOString() })
      .eq('id', input.conversationId)
      .is('contact_id', null)

    // 把 fb_psid 挂到这个人上，未来 O(1) 命中。
    if (input.psid) {
      await supabaseAdmin.from('contact_identities').upsert(
        {
          contact_id: contactId,
          client_id: input.clientId,
          kind: 'fb_psid',
          value: input.psid,
          first_source: 'messenger',
        },
        { onConflict: 'client_id,kind,value', ignoreDuplicates: true },
      )
      index.byPsid.set(input.psid, contactId)
    }
  }

  // 来源归因：这两条触点的 attr_* 列**故意全部留 NULL**。
  //
  // 私信同步走 Graph `/{page}/conversations`（见 lib/meta/conversations.ts，messages
  // 只请求 `id,created_time,message,from,tags`）。广告点进来的 referral / ctwa_clid
  // 只在 **Webhook** 的 messaging_referrals 事件里出现，读接口根本不返回。所以对
  // 每一段私信，我们都不知道它是自然来的还是从广告点进来的。
  //
  // 那就别写。填 'organic_social' 是撒谎（可能真是广告带来的），填 'meta' 也是撒谎
  // （可能是自然搜到主页私信的）—— 两种都会污染「哪条广告有效」的分母，而这个分母
  // 正是整套学习的地基。留 NULL = 如实说「不知道」。
  //
  // 要真正拿到私信的广告归因，得接 Messenger Webhook（另一条工作线：需要
  // 订阅 messaging_referrals + 主页 token 权限），不是在这里能补的。
  //
  // 写/刷新两条汇总触点：客户来信 + 我们回复。分两条，segments 才能让
  // 「客户在等我们」只在客户更晚时才触发，而不是一段对话糊成一个方向。
  //
  // 出站只认**真人**回复:Meta 的自动回复(欢迎语/Business AI)不写「我们联系过」，
  // 否则一条机器人问候会把从没人碰过的热新线索顶出「今天该联系谁」名单。
  const lastIn = lastSentAt(input.messages, 'inbound')
  // tags 缺失时一条出站触点都不写（理由见 LinkConversationInput.tagsAvailable）。
  const lastOut = input.tagsAvailable === false ? null : lastHumanOutboundAt(input.messages)

  const rows: Record<string, unknown>[] = []
  if (lastIn) {
    rows.push({
      client_id: input.clientId,
      contact_id: contactId,
      channel: 'messenger',
      direction: 'inbound',
      occurred_at: lastIn,
      summary: `Messenger 私信（${input.messageCount} 条往来）`,
      metadata: {
        thread_id: input.conversationId,
        participant_name: input.participantName,
        last_message_from: input.lastMessageFrom,
        message_count: input.messageCount,
        linked_by: matchedBy,
      },
      source: 'messenger',
      source_ref: `${input.conversationId}:in`,
    })
  }
  if (lastOut) {
    rows.push({
      client_id: input.clientId,
      contact_id: contactId,
      channel: 'messenger',
      direction: 'outbound',
      occurred_at: lastOut,
      summary: '我们在 Messenger 回复过',
      metadata: { thread_id: input.conversationId, sender: 'page' },
      source: 'messenger',
      source_ref: `${input.conversationId}:out`,
    })
  }

  if (rows.length > 0) {
    // 不加 ignoreDuplicates → ON CONFLICT DO UPDATE：重同步刷新 occurred_at。
    await supabaseAdmin
      .from('contact_touchpoints')
      .upsert(rows, { onConflict: 'client_id,source,source_ref' })
  }

  // last_seen 只往前推：仅当现值早于本对话最后活动时才更新，绝不回拨。
  if (input.lastMessageAt) {
    await supabaseAdmin
      .from('contacts')
      .update({ last_seen_at: input.lastMessageAt, updated_at: new Date().toISOString() })
      .eq('id', contactId)
      .eq('client_id', input.clientId)
      .lt('last_seen_at', input.lastMessageAt)
  }

  return { contactId, linked: newlyLinked, created, matchedBy }
}

/** 一次同步开始时加载该客户的身份索引（邮箱 + psid），供逐条对话就地匹配。 */
export async function loadIdentityIndex(clientId: string): Promise<IdentityIndex> {
  const byEmail = new Map<string, string>()
  const byPsid = new Map<string, string>()

  const { data } = await supabaseAdmin
    .from('contact_identities')
    .select('kind, value, contact_id')
    .eq('client_id', clientId)
    .in('kind', ['email', 'fb_psid'])

  for (const row of (data ?? []) as { kind: string; value: string; contact_id: string }[]) {
    if (row.kind === 'email') byEmail.set(row.value.toLowerCase(), row.contact_id)
    else if (row.kind === 'fb_psid') byPsid.set(row.value, row.contact_id)
  }

  return { byEmail, byPsid }
}
