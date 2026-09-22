/**
 * 退订写入失败的落地记录（issue #1587 · F4 心跳检查的前置依赖）。
 *
 * `messenger`/`whatsapp` 两条 webhook 的 opt-out 写入路径（`recordOptOutKeywordTouch`
 * / `conversations.optout_unlinked`）之前失败时只有 `console.error`，心跳检查读不到——
 * 会被误判成「没人退订、一切正常」（防
 * `feedback-monitoring-writer-silent-failure-inverts-health-check` 那类教训重演）。
 *
 * 这个函数本身是 best-effort 的**最后一步**：它被塞进已有的 catch 块里，写失败
 * 只 `console.error` 自己，绝不 throw —— 反过来让「记一笔失败」这件事把本来已经
 * 落库成功的消息又搞出一次 500/503，逼 Meta 重投，是本末倒置。
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface RecordOptOutWriteFailureInput {
  clientId: string
  channel: string
  conversationId?: string | null
  contactId?: string | null
  errorMessage: string
}

export async function recordOptOutWriteFailure(
  params: RecordOptOutWriteFailureInput,
  supabase: SupabaseClient,
): Promise<void> {
  try {
    const { error } = await supabase.from('conversation_optout_write_failures').insert({
      client_id: params.clientId,
      channel: params.channel,
      conversation_id: params.conversationId ?? null,
      contact_id: params.contactId ?? null,
      error_message: params.errorMessage,
    })
    if (error) {
      console.error(
        `[messenger-agent/optout-failures] 记录退订写入失败本身也写失败了 clientId=${params.clientId} channel=${params.channel}:`,
        error.message,
      )
    }
  } catch (err) {
    console.error(
      `[messenger-agent/optout-failures] 记录退订写入失败本身抛出异常 clientId=${params.clientId} channel=${params.channel}:`,
      err,
    )
  }
}
