/**
 * 客人在 Facebook 私信里说了「别再联系」—— 挑出来**交给销售看一眼**。
 *
 * ## 为什么要有这个文件
 *
 * issue [#1025](https://github.com/bigbigraydeng-maker/magic-engine/issues/1025)：
 * 私信正文早就同步进 `conversation_messages` 了，但**判「他还想不想被联系」的那一步
 * 从来没去看它**。`classifyNote` 全仓唯一的生产调用点是 `recordManualTouchpoint`，
 * 只处理销售手打的备注。于是邮件渠道说的「别再联系」看得见（`mail-ingest` 写了
 * `raw`），**私信说的看不见** —— 而私信恰恰是 CTS 客人说话最多的渠道
 * （线上 2099 条 / 658 个会话）。
 *
 * ## 为什么只提示、不自动封（PM 2026-08-17 拍板：B 方案）
 *
 * 直觉做法是把私信正文接进拒联判据，判中就写 `contacts.do_not_contact`。
 * **不能这么做**，因为那个判据本身现在还判不准（issue #1019 就是为它开的）：
 * 旅游生意里同一个词的意思是反的 —— `take me off` 是要求下车、`opt out` 是不参加
 * 自费项目、`all sorted` 是已经在我们这订了。
 *
 * 一次性把 2099 条私信喂进一个会误判的判据，代价是**一批正常客人被永久静默排除**，
 * 而解除只能一个一个手动点（见 `lib/crm/dnc` 的开头）。
 *
 * 所以这里把风险的方向**倒过来**：
 *
 *   · 判中了 → 只下发一条人工任务，请销售去看一眼原话
 *   · 判错了 → 代价是浪费销售 10 秒，不是把客人埋掉
 *   · 判漏了 → 跟今天一样（现状本来就看不见），不会更差
 *
 * 判据宁可**多报**也不写任何一笔数据 —— 这个文件**一行写操作都没有**，
 * 这是它的核心纪律，改它之前先想清楚上面这三行。
 *
 * ## 什么时候不再提醒这个人
 *
 * 没有「已处理」这种标记可用（那要加列，是 A 级改动）。所以用两个**已经存在**
 * 的可观测信号收口，都不需要改 schema：
 *
 *   1. 这个人已经算拒联了（`isDoNotContact`）→ 没什么可提示的，跳过
 *   2. 那条私信**之后**有人手工记过一笔（`source = 'me_manual'`）→ 有人看过了，跳过
 *
 * 再加一个时间窗（默认 30 天）兜底，免得一条谁都不打算处理的旧消息天天冒出来。
 * ⚠️ 代价要认：**窗口外的人不会再被提起**。真要做到「一条都不漏且不重复骚扰」，
 * 前提是加一列「已复核」，那是另一件事，已登记。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { classifyNote } from '@/lib/crm/note-parser'
import { isDoNotContact, type DncTouch } from '@/lib/crm/dnc'
import { fetchAll } from '@/lib/supabase-paginate'

/** 只看最近这些天的私信。见文件头「什么时候不再提醒」。 */
export const STOP_SIGNAL_WINDOW_DAYS = 30

/**
 * 一个客户一轮最多冒出多少条。
 *
 * 不是为了省事 —— 今日待办是销售早上真的会逐条看完的一页，一次塞 200 条
 * 等于一条都不会被看。超出的条数由调用方 `log` 出来，**不许静默截断**。
 */
export const MAX_PER_CLIENT = 20

/** 原话截多长。够销售判断，又不至于把整页刷满。 */
const QUOTE_MAX = 120

/**
 * `.in()` 一次最多塞多少个 id。
 *
 * 🔴 **不是性能优化，是能不能跑起来**（Codex 复审 PR #1037，2026-08-17）。
 * PostgREST 的 `.in()` 走 URL 查询串：CTS 线上 658 个会话，光 UUID 就约 24 KB，
 * 请求会在到数据库之前因为 URL 过长直接失败。而这条通道的异常被
 * `loadManualItems` 的 catch 吞掉 —— 结果是**整条通道只留一行日志、一条待办都不下发**，
 * 正是铁律 3「发现不许死在日志里」要防的那种失败。
 *
 * 同仓 `qualified-buyer-autotag.ts` 对同一张消息表已经按 100 分批，这里跟它一致。
 */
const IN_CHUNK = 100

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export interface InboundDm {
  clientId: string
  contactId: string
  body: string
  sentAt: string
}

export interface MessengerStopSignal {
  clientId: string
  contactId: string
  /** 客人那句原话（截断过）—— 销售一眼就知道为什么被挑出来。 */
  quote: string
  sentAt: string
}

export interface StopSignalInput {
  messages: InboundDm[]
  /** contactId → 这个人的拒联判决材料。查不到的人按「没被标过」处理。 */
  dnc: Map<string, { flag: boolean; touches: DncTouch[] }>
  /** contactId → 最后一次**人工**触点的时间。晚于私信 = 有人看过了。 */
  lastHumanTouchAt: Map<string, string>
  maxPerClient?: number
}

export interface StopSignalResult {
  signals: MessengerStopSignal[]
  /** 因为每客户上限被压下去的条数 —— 调用方必须 log 出来。 */
  dropped: number
}

function ts(v: string | null | undefined): number {
  if (!v) return 0
  const t = new Date(v).getTime()
  return Number.isNaN(t) ? 0 : t
}

function quoteOf(body: string): string {
  const one = body.replace(/\s+/g, ' ').trim()
  return one.length <= QUOTE_MAX ? one : `${one.slice(0, QUOTE_MAX)}…`
}

/**
 * 中文拒联候选的高召回层。
 *
 * 这里只决定“是否需要人看一眼”，绝不写永久 DNC。这样可以接住 #1026 的常见
 * 中文表达，同时把“别再联系那家酒店”这类目标不明确的话留在 review 状态，
 * 不冒充已经确认的客户判决。
 */
const CHINESE_STOP_REVIEW_PATTERNS: RegExp[] = [
  /(?:请|客户说|客户明确说)?不要再(?:联系|发(?:邮件|信息|消息)|来电|骚扰)/,
  /以后都不要联系/,
  /请勿再(?:联系|来电|发(?:邮件|信息|消息))/,
  /(?:请)?把我从你们?(?:的)?(?:名单|列表)里(?:删|移)/,
  /(?:请)?把我的(?:资料|信息|联系方式)(?:删|移)/,
  /拒绝任何联系/,
  /不想再收到你们?(?:的)?(?:信息|消息|邮件)/,
  /(?:客户)?明确要求退订/,
]

export function looksLikeStopSignal(body: string): boolean {
  const text = body.trim()
  if (!text) return false
  return classifyNote(text).do_not_contact || CHINESE_STOP_REVIEW_PATTERNS.some((p) => p.test(text))
}

/**
 * 纯判据：哪些私信像是「别再联系」，且这个人还值得提醒一次。
 *
 * 拆成纯函数是为了能把每一条规矩单独钉住 —— IO 那半边（`findMessengerStopSignals`）
 * 只负责把行取出来喂进来。
 */
export function pickStopSignals(input: StopSignalInput): StopSignalResult {
  const { messages, dnc, lastHumanTouchAt } = input
  const maxPerClient = input.maxPerClient ?? MAX_PER_CLIENT

  /** contactId → 命中的那条里**最新**的一条。同一个人只提醒一次。 */
  const latest = new Map<string, MessengerStopSignal>()

  for (const m of messages) {
    if (!m.body || !m.body.trim()) continue

    // 已确认 DNC 仍复用 `classifyNote`；中文新增只进入 review，不冒充永久判决。
    if (!looksLikeStopSignal(m.body)) continue

    // 已经算拒联了 → 没什么可提示的。查不到这个人的材料就按「没被标过」办。
    const d = dnc.get(m.contactId)
    if (d && isDoNotContact(d.flag, d.touches)) continue

    // 这条私信之后有人手工记过一笔 = 有人看过了，别再天天提。
    if (ts(lastHumanTouchAt.get(m.contactId)) >= ts(m.sentAt)) continue

    const prev = latest.get(m.contactId)
    if (prev && ts(prev.sentAt) >= ts(m.sentAt)) continue
    latest.set(m.contactId, {
      clientId: m.clientId,
      contactId: m.contactId,
      quote: quoteOf(m.body),
      sentAt: m.sentAt,
    })
  }

  // 新的排前面：真要被上限压掉，压掉的该是最旧的那些。
  const all = Array.from(latest.values()).sort((a, b) => ts(b.sentAt) - ts(a.sentAt))

  const perClient = new Map<string, number>()
  const signals: MessengerStopSignal[] = []
  let dropped = 0
  for (const s of all) {
    const n = perClient.get(s.clientId) ?? 0
    if (n >= maxPerClient) {
      dropped++
      continue
    }
    perClient.set(s.clientId, n + 1)
    signals.push(s)
  }
  return { signals, dropped }
}

interface ConversationRow {
  id: string
  client_id: string
  contact_id: string | null
}

interface MessageRow {
  conversation_id: string
  body: string | null
  sent_at: string
}

interface TouchRow {
  contact_id: string
  occurred_at: string
  source: string | null
  metadata: Record<string, unknown> | null
}

/**
 * 把候选人捞出来喂给 `pickStopSignals`。**只读，一行写操作都没有。**
 *
 * @param now 传进来而不是 `new Date()`：测试要能钉住时间窗。
 */
export async function findMessengerStopSignals(
  supabase: SupabaseClient,
  clientIds: string[],
  now: Date,
  windowDays: number = STOP_SIGNAL_WINDOW_DAYS,
): Promise<StopSignalResult> {
  const empty: StopSignalResult = { signals: [], dropped: 0 }
  if (clientIds.length === 0) return empty

  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString()

  // 1) 已经挂上人的 Messenger 对话。没挂上人的谈不上「提醒销售去看谁」。
  const convos = await fetchAll<ConversationRow>((from, to) =>
    supabase
      .from('conversations')
      .select('id, client_id, contact_id')
      .in('client_id', clientIds)
      .eq('channel', 'messenger')
      .not('contact_id', 'is', null)
      // 稳定排序 —— 没有它分页边界上的行会换位，重复或漏行。
      .order('id', { ascending: true })
      .range(from, to),
  )
  if (convos.length === 0) return empty

  const convMeta = new Map(convos.map((c) => [c.id, c]))
  const convIds = convos.map((c) => c.id)

  // 2) 窗口内客人**自己发的**那些消息。我们自己发出去的不能拿来判客人拒联
  //    （同 PR #998 里邮件页脚那个事故）。
  const msgs: MessageRow[] = []
  for (const part of chunk(convIds, IN_CHUNK)) {
    const rows = await fetchAll<MessageRow>((from, to) =>
      supabase
        .from('conversation_messages')
        .select('conversation_id, body, sent_at')
        .in('conversation_id', part)
        .eq('direction', 'inbound')
        .gte('sent_at', cutoff)
        .order('id', { ascending: true })
        .range(from, to),
    )
    msgs.push(...rows)
  }
  if (msgs.length === 0) return empty

  const messages: InboundDm[] = []
  for (const m of msgs) {
    const c = convMeta.get(m.conversation_id)
    if (!c?.contact_id) continue
    messages.push({
      clientId: c.client_id,
      contactId: c.contact_id,
      body: m.body ?? '',
      sentAt: m.sent_at,
    })
  }
  if (messages.length === 0) return empty

  // 3) 这批人的触点：既拿来判「已经算拒联了吗」，也拿来判「有人看过了吗」。
  const contactIds = Array.from(new Set(messages.map((m) => m.contactId)))
  const touches: TouchRow[] = []
  for (const part of chunk(contactIds, IN_CHUNK)) {
    const rows = await fetchAll<TouchRow>((from, to) =>
      supabase
        .from('contact_touchpoints')
        .select('contact_id, occurred_at, source, metadata')
        .in('contact_id', part)
        .order('id', { ascending: true })
        .range(from, to),
    )
    touches.push(...rows)
  }

  const dnc = new Map<string, { flag: boolean; touches: DncTouch[] }>()
  const lastHumanTouchAt = new Map<string, string>()
  for (const t of touches) {
    const meta = (t.metadata ?? {}) as Record<string, unknown>
    const entry = dnc.get(t.contact_id) ?? { flag: false, touches: [] }
    entry.touches.push({
      outcome: (meta.outcome as string) ?? null,
      flagged: meta.do_not_contact === true,
      occurredAt: t.occurred_at,
    })
    dnc.set(t.contact_id, entry)

    if (t.source === 'me_manual') {
      const prev = lastHumanTouchAt.get(t.contact_id)
      if (!prev || ts(t.occurred_at) > ts(prev)) lastHumanTouchAt.set(t.contact_id, t.occurred_at)
    }
  }

  // 4) 镜像列。`isDoNotContact` 要两边都给 —— 触点是真相源，列是尽力维护的镜像，
  //    但「触点写成功、镜像失败」和「镜像写成功、触点没写」两种半写入状态都出现过。
  const flags: { id: string; do_not_contact: boolean | null }[] = []
  for (const part of chunk(contactIds, IN_CHUNK)) {
    const rows = await fetchAll<{ id: string; do_not_contact: boolean | null }>((from, to) =>
      supabase
        .from('contacts')
        .select('id, do_not_contact')
        .in('id', part)
        .order('id', { ascending: true })
        .range(from, to),
    )
    flags.push(...rows)
  }
  for (const f of flags) {
    const entry = dnc.get(f.id) ?? { flag: false, touches: [] }
    entry.flag = f.do_not_contact === true
    dnc.set(f.id, entry)
  }

  return pickStopSignals({ messages, dnc, lastHumanTouchAt })
}
