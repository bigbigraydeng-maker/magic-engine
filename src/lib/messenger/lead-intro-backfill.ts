/**
 * 存量补档案：把「点私信」开场白里的电话邮箱，补给**已经挂上人**的老对话。
 *
 * ## 为什么单独一条路（Codex 复审 2026-08-17）
 *
 * `linkMessengerConversation` 里那一步只在**这条对话被处理到**的时候跑，而两个
 * 入口都够不到存量：
 *
 *   · 每小时实时同步 —— 只读水位线之后有更新的线程
 *   · `backfillUnlinkedConversations` —— 只扫 `contact_id IS NULL` 的对话
 *
 * 于是「**已经挂上人、且最后一条消息早于水位线**」的老对话永远不会再被碰到 ——
 * 而那批人正是 PM 2026-08-17 看到的现状：CRM 卡片上写着「没留电话」，
 * 档案两栏空着，开场白里的号码就在那儿躺着。
 *
 * 所以这一条按**人**扫，不按对话扫：谁的档案还缺电话或邮箱，就去翻他的私信。
 *
 * ## 纪律跟实时那条完全一致
 *
 * 补空栏、不覆盖、身份归属先回查、只认客人自己发的那条 —— 判据只有一份
 * （`backfillFromLeadIntro`），这里只负责**把人找出来喂进去**。
 *
 * 永不抛异常：这是同步的附加步骤，它失败绝不能让本轮同步结果作废。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { backfillFromLeadIntro } from '@/lib/messenger/link-contacts'

/**
 * 一页取多少人。**不是每轮的上限** —— 见下面为什么必须扫完。
 */
const PAGE = 200

/**
 * 一轮最多翻多少页的安全阀。真到这个量级说明客户规模已经变了，该换做法。
 */
const MAX_PAGES = 25

/**
 * 一次 `.in()` 里塞多少个 id。
 *
 * PostgREST 把 `in.(...)` 拼进 URL，太长会被网关按超长 URL 拒掉。200 个 uuid
 * 约 7.6KB，离常见的 8~16KB 上限还有余量，也让往返次数保持在个位数。
 */
const IN_CHUNK = 200

export interface LeadIntroBackfillResult {
  /** 这一轮真正翻过私信的人数。 */
  scanned: number
  /** 其中有开场白、走到了写入判据的人数（写没写成要看空栏和归属）。 */
  matched: number
}

interface ContactRow {
  id: string
}

interface MessageRow {
  direction: 'inbound' | 'outbound'
  body: string | null
  sent_at: string
}

/**
 * ⚠️ **必须一轮扫完，不能只取前 N 个**（Codex 复审 2026-08-17，两轮）。
 *
 * 候选集是「档案还缺电话或邮箱的人」。补上的人会自己离开这个集合，但**补不上
 * 的人（没有私信 / 没有开场白 / 号码归了别人）会永远留在里面**。只取前 N 个的
 * 话，每小时捞回来的都是同一批补不上的人，后面的人永远轮不到 —— 看起来在跑，
 * 其实一直在原地。而且候选集不止「只有 Facebook 身份」那批，是**所有**缺栏的人。
 *
 * 没有持久化游标可用（那要加列或加表，是设计改动），所以这里按 `id` 稳定排序
 * 一页页扫完。代价是每轮会重扫那些补不上的人 —— CTS 这个量级（几百人）可以接受，
 * 真到需要省这几百次查询的规模，就该换成给「试过补不上」打标。
 */
/**
 * 一页 1000 行地读完，而不是发一次请求就当读全了。
 *
 * 🔴 **Supabase 的 API 默认最多返回 1000 行，而且不报错**。批量查询（`.in(...)`）
 *    一不小心就会踩到：拿回 1000 行、以为这就是全部，剩下的静默消失。放在这里的后果是
 *    某个人的开场白那条消息被截掉 → 他的电话邮箱永远补不上 → CRM 卡片继续写着
 *    「没留电话」。这类「答案是错的但没人报错」正是本仓最不能接受的失败方式。
 *
 * 读失败返回 `null`（不是空数组）：空数组跟「这个客户真的没有对话」长得一模一样。
 */
async function readAllPages<T>(
  query: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string,
): Promise<T[] | null> {
  const PAGE_ROWS = 1000
  const out: T[] = []
  for (let page = 0; ; page++) {
    const { data, error } = await query(page * PAGE_ROWS, page * PAGE_ROWS + PAGE_ROWS - 1)
    if (error) {
      console.error(`[messenger/lead-intro-backfill] ${what}失败:`, error.message)
      return null
    }
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE_ROWS) return out
    // 安全阀：真到这个量级说明客户规模变了，该换做法而不是一直翻下去。
    if (page >= MAX_PAGES - 1) {
      console.warn(`[messenger/lead-intro-backfill] ${what}超过 ${MAX_PAGES * PAGE_ROWS} 行，本轮未读完`)
      return out
    }
  }
}

export async function backfillLeadIntroDetails(
  clientId: string,
  page: number = PAGE,
): Promise<LeadIntroBackfillResult> {
  const empty: LeadIntroBackfillResult = { scanned: 0, matched: 0 }

  // 档案上电话或邮箱还空着的人。两栏都齐的人不用翻 —— 翻了也只会被空值守卫挡回来。
  //
  // ⚠️ 整段包在 try 里：这是同步的**附加**步骤，它以任何方式失败（读报错、
  // 客户端不支持某个筛法、网络抖动）都不能让本轮同步的结果作废。
  const contacts: ContactRow[] = []
  try {
    for (let p = 0; p < MAX_PAGES; p++) {
      const { data, error } = await supabaseAdmin
        .from('contacts')
        .select('id')
        .eq('client_id', clientId)
        .or('primary_phone.is.null,primary_email.is.null')
        // 稳定排序 —— 没有它，分页边界上的行会在两次请求间换位，重复或漏人。
        .order('id', { ascending: true })
        .range(p * page, p * page + page - 1)
      if (error) {
        console.error('[messenger/lead-intro-backfill] 读联系人失败:', error.message)
        break
      }
      const rows = (data ?? []) as ContactRow[]
      contacts.push(...rows)
      if (rows.length < page) break
      if (p === MAX_PAGES - 1) {
        console.warn(
          `[messenger/lead-intro-backfill] client ${clientId} 候选人超过 ${MAX_PAGES * page}，本轮未扫完`,
        )
      }
    }
  } catch (err) {
    console.error(
      '[messenger/lead-intro-backfill] 读联系人抛异常:',
      err instanceof Error ? err.message : String(err),
    )
    return empty
  }

  /**
   * 🔴 **对话和消息一次性取回来，不按人逐个查**（2026-09-07 改）。
   *
   * 原来是每个候选人两次查询（先查他的对话、再查那些对话的入站消息）。CTS + Roman
   * 这个量级是 314 个候选人 → **628 次串行往返**，把这条每小时任务从约 25 秒推到
   * 约 140 秒。而网关约 125 秒就掐断连接返 524 —— 串在它后面的「写客户需求卡」
   * 因此 14 天一次都没跑（见 `sync-completed-event.ts`）。
   *
   * 现在：1 次查对话 + 按 `IN_CHUNK` 分几次查消息，往返次数从三位数降到个位数。
   * 判据一个字没改 —— 只是把「一个人查一次」换成「一批人查一次，在内存里分组」。
   *
   * 量级安全：CTS 是最大的一个，593 条已挂人的私信对话共 1106 条入站消息、约 0.26 MB
   * （2026-09-07 实测）。真涨到装不下的那天，该做的是给「试过补不上」打标，
   * 不是退回逐人查询。
   */
  const contactIds = contacts.map((c) => c.id)
  const messagesByContact = new Map<string, { direction: 'inbound' | 'outbound'; body: string; sentAt: string }[]>()

  try {
    // 这个客户名下、已挂在候选人身上的私信对话 → conversationId ↦ contactId。
    const convoOwner = new Map<string, string>()
    for (let i = 0; i < contactIds.length; i += IN_CHUNK) {
      const slice = contactIds.slice(i, i + IN_CHUNK)
      const rows = await readAllPages<{ id: string; contact_id: string | null }>(
        (from, to) =>
          supabaseAdmin
            .from('conversations')
            .select('id, contact_id')
            .eq('client_id', clientId)
            .eq('channel', 'messenger')
            .in('contact_id', slice)
            // 稳定排序 —— 分页边界上的行会在两次请求间换位，重复或漏行。
            .order('id', { ascending: true })
            .range(from, to),
        '读对话',
      )
      if (!rows) return empty
      for (const row of rows) if (row.contact_id) convoOwner.set(row.id, row.contact_id)
    }

    const convoIds = Array.from(convoOwner.keys())
    for (let i = 0; i < convoIds.length; i += IN_CHUNK) {
      const slice = convoIds.slice(i, i + IN_CHUNK)
      const rows = await readAllPages<MessageRow & { conversation_id: string }>(
        (from, to) =>
          supabaseAdmin
            .from('conversation_messages')
            .select('conversation_id, direction, body, sent_at')
            .in('conversation_id', slice)
            .eq('direction', 'inbound')
            // 排序仍按 sent_at —— 判据要「按字段各取最新非空值」，顺序不能乱。
            // 同刻并列时用 id 兜底，否则分页边界会重复或漏行。
            .order('sent_at', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to),
        '读消息',
      )
      if (!rows) return empty
      for (const m of rows) {
        const owner = convoOwner.get(m.conversation_id)
        if (!owner) continue
        const list = messagesByContact.get(owner) ?? []
        list.push({ direction: m.direction, body: m.body ?? '', sentAt: m.sent_at })
        messagesByContact.set(owner, list)
      }
    }
  } catch (err) {
    console.error(
      '[messenger/lead-intro-backfill] 批量读取抛异常:',
      err instanceof Error ? err.message : String(err),
    )
    return empty
  }

  /**
   * 🔴 同一个人可能有不止一条私信对话，分块取回来之后**必须重新按时间排一遍**。
   *    分块只保证块内有序；跨块拼起来是「块 1 的全部 + 块 2 的全部」，
   *    时间上是乱的。而判据要的是「按字段各取最新非空值」—— 顺序错了，
   *    客人后来更正过的号码会被更早那条盖回去。
   */
  for (const list of messagesByContact.values()) {
    list.sort((a, b) => a.sentAt.localeCompare(b.sentAt))
  }

  let scanned = 0
  let matched = 0

  for (const c of contacts) {
    // 逐个隔离：一个人的数据坏了不牵连这一批剩下的。
    try {
      const messages = messagesByContact.get(c.id)
      if (!messages || messages.length === 0) continue

      scanned++
      // 判据只有一份 —— 认不认得出、补不补得进，全在那边判。
      await backfillFromLeadIntro({ clientId, messages }, c.id)
      matched++
    } catch (err) {
      console.error(
        '[messenger/lead-intro-backfill] 单个联系人失败:',
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  return { scanned, matched }
}
