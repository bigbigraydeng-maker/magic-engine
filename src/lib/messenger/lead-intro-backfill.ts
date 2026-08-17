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

/** 一轮扫多少人。跟 `backfillUnlinkedConversations` 一个量级，跑不完下一轮接着来。 */
const BATCH = 40

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

export async function backfillLeadIntroDetails(
  clientId: string,
  batch: number = BATCH,
): Promise<LeadIntroBackfillResult> {
  const empty: LeadIntroBackfillResult = { scanned: 0, matched: 0 }

  // 档案上电话或邮箱还空着的人。两栏都齐的人不用翻 —— 翻了也只会被空值守卫挡回来。
  //
  // ⚠️ 整段包在 try 里：这是同步的**附加**步骤，它以任何方式失败（读报错、
  // 客户端不支持某个筛法、网络抖动）都不能让本轮同步的结果作废。
  let contacts: ContactRow[]
  try {
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .select('id')
      .eq('client_id', clientId)
      .or('primary_phone.is.null,primary_email.is.null')
      .limit(batch)
    if (error) {
      console.error('[messenger/lead-intro-backfill] 读联系人失败:', error.message)
      return empty
    }
    contacts = (data ?? []) as ContactRow[]
  } catch (err) {
    console.error(
      '[messenger/lead-intro-backfill] 读联系人抛异常:',
      err instanceof Error ? err.message : String(err),
    )
    return empty
  }

  let scanned = 0
  let matched = 0

  for (const c of contacts) {
    // 逐个隔离：一个人的数据坏了不牵连这一批剩下的。
    try {
      const { data: convos } = await supabaseAdmin
        .from('conversations')
        .select('id')
        .eq('client_id', clientId)
        .eq('channel', 'messenger')
        .eq('contact_id', c.id)

      const ids = ((convos ?? []) as { id: string }[]).map((x) => x.id)
      if (ids.length === 0) continue

      const { data: msgs } = await supabaseAdmin
        .from('conversation_messages')
        .select('direction, body, sent_at')
        .in('conversation_id', ids)
        .eq('direction', 'inbound')
        .order('sent_at', { ascending: true })

      const messages = ((msgs ?? []) as MessageRow[]).map((m) => ({
        direction: m.direction,
        body: m.body ?? '',
        sentAt: m.sent_at,
      }))
      if (messages.length === 0) continue

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
