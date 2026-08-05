/**
 * 把**已经在库里、但还没挂到任何人身上**的历史私信对话补挂上。
 *
 * WHY
 * ---
 * 每小时的同步只向 Meta 要「最近有更新的」线程（水位线），所以「按 psid 建人」这个
 * 能力上线时，早就聊完、之后再没说过话的老对话不会被重新过一遍 —— 它们会永远挂不
 * 到人。2026-07-31 实测：CTS 收件箱里 8 个人，只有当天还在说话的 3 个进了 CRM，
 * 昨天聊完的 5 个（Nikki Heuberger / Ngareta / Wrangler / Susan / Barry）全在系统外。
 *
 * 这些对话的正文**早就存在我们自己库里**（conversations + conversation_messages），
 * 所以补挂完全不用再问 Meta 要一次 —— 读本地表、走同一套 `linkMessengerConversation`
 * 逻辑即可，同一套护栏（只按 psid 建人 / 客户开过口才建）自动适用。
 *
 * 自愈式设计：挂在每小时同步的尾巴上，每轮处理一批。149 条积压跑几轮就清完，
 * 之后稳态只剩「本来就挂不上的」在空转（见 BACKFILL_BATCH 的注释）。
 * 不需要新 cron、不需要新密钥、不需要任何人手动跑一次。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { linkMessengerConversation, type IdentityIndex } from '@/lib/messenger/link-contacts'

/**
 * 每轮补挂多少条。
 *
 * 取 50 而不是更大：一条要读一次消息、可能写 contact + 身份 + 触点，太大压不进
 * cron 的 maxDuration。
 *
 * ⚠️ 这个数必须**明显大于「本来就挂不上的」条数**（没有 psid 的、或者客户一句话
 * 都没说过的）。那些条目每轮都会被重新试一次、每轮都失败，占着批次里的名额。
 * 只要批量比它们多，剩下的仍然每轮都在推进；反之会卡死在同一批上。
 * 实测 CTS：151 条未挂载里约 21 条属于这类，50 有足够余量。
 */
const BACKFILL_BATCH = 50

export interface BackfillResult {
  /** 这轮实际过了多少条老对话。 */
  processed: number
  /** 其中挂上人的（含新建的）。 */
  linked: number
  /** 其中新建了人的 —— 这才是「多认出几个真人」。 */
  created: number
  /** 还剩多少条没挂上（这轮跑完之后的估算，用于知道还要几轮）。 */
  remaining: number
}

interface UnlinkedRow {
  id: string
  participant_psid: string | null
  participant_name: string | null
  message_count: number | null
  last_message_at: string | null
  last_message_from: string | null
}

interface StoredMessage {
  direction: 'inbound' | 'outbound'
  body: string | null
  sent_at: string
}

/**
 * 补挂一批还没挂上人的老对话。永不抛异常 —— 这是同步的附加步骤，
 * 它失败绝不能让本轮的实时同步结果作废。
 */
export async function backfillUnlinkedConversations(
  clientId: string,
  index: IdentityIndex,
  batch: number = BACKFILL_BATCH,
): Promise<BackfillResult> {
  const empty: BackfillResult = { processed: 0, linked: 0, created: 0, remaining: 0 }

  // 先新后旧：越近的对话越可能还有生意，先让它们出现在「今天该联系谁」里。
  const { data: rows, error } = await supabaseAdmin
    .from('conversations')
    .select('id, participant_psid, participant_name, message_count, last_message_at, last_message_from')
    .eq('client_id', clientId)
    // 只扫私信。这里靠 fb_psid 认人，邮件线程根本没有 psid ——
    // 不筛的话每一轮都会把它们捞起来、认不出人、再放回去，白占批次名额。
    .eq('channel', 'messenger')
    .is('contact_id', null)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(batch)

  if (error) {
    console.error('[messenger/backfill] 读未挂载对话失败:', error.message)
    return empty
  }

  let processed = 0
  let linked = 0
  let created = 0

  for (const row of (rows ?? []) as UnlinkedRow[]) {
    // 逐条隔离：一条坏对话不牵连这一批剩下的。
    try {
      const { data: msgs } = await supabaseAdmin
        .from('conversation_messages')
        .select('direction, body, sent_at')
        .eq('conversation_id', row.id)
        .order('sent_at', { ascending: true })

      const messages = ((msgs ?? []) as StoredMessage[]).map((m) => ({
        direction: m.direction,
        body: m.body ?? '',
        sent_at: m.sent_at,
      }))
      // 一条消息都没存的线程没什么可判断的（既建不了人，也写不出触点）。
      if (messages.length === 0) continue

      processed++

      const res = await linkMessengerConversation(
        {
          clientId,
          conversationId: row.id,
          psid: row.participant_psid,
          participantName: row.participant_name,
          messageCount: row.message_count ?? messages.length,
          lastMessageFrom:
            row.last_message_from === 'customer' || row.last_message_from === 'page'
              ? row.last_message_from
              : null,
          lastMessageAt: row.last_message_at,
          messages: messages.map((m) => ({
            direction: m.direction,
            body: m.body,
            sentAt: m.sent_at,
          })),
          existingContactId: null,
          // 库里没存 tags —— 分不出真人回复和 Business AI，所以不写出站触点。
          tagsAvailable: false,
        },
        index,
      )

      if (res.linked) linked++
      if (res.created) created++
    } catch (err) {
      console.error(`[messenger/backfill] 对话 ${row.id} 补挂失败:`, err)
    }
  }

  // 跑完之后还剩多少 —— 让 cron 日志能直接看出「还要几轮清完」。
  const { count } = await supabaseAdmin
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('channel', 'messenger')
    .is('contact_id', null)

  return { processed, linked, created, remaining: count ?? 0 }
}
