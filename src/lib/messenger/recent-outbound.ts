import { supabaseAdmin } from '@/lib/supabase'

/**
 * Tells the F1 auto-acknowledgement whether ANY successful outbound message
 * (auto-ack, staff reply, or human-approved AI draft) has already been sent to
 * this conversation since `sinceIso`. Only rows with status 'sent' count —
 * failed/pending rows must not suppress a legitimate acknowledgement.
 *
 * Fail-closed: a read error throws (so Inngest retries) rather than returning
 * false, which would risk sending a duplicate message.
 */
export async function hasRecentOutbound(
  conversationId: string,
  sinceIso: string,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from('conversation_outbound_log')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('status', 'sent')
    .gte('created_at', sinceIso)
    .limit(1)

  if (error) {
    throw new Error(`[recent-outbound] read failed: ${error.message}`)
  }

  // 没报错却没有数组 = 读到了不认识的东西，宁可抛错重试，也不当成「最近没回过」而多发。
  if (!Array.isArray(data)) {
    throw new Error('[recent-outbound] read failed: unexpected empty response')
  }
  return data.length > 0
}
