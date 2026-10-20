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

  return Array.isArray(data) && data.length > 0
}
