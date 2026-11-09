/** Supabase reads for the smart auto-ack composer. Read-only. Throws on read errors (composeAck degrades). */
import { supabaseAdmin } from '@/lib/supabase'
import { AUTOACK_SENT_BY_EMAIL } from '../autoack-identity'
import { readSmartAckConfig, type SmartAckConfig } from './config'
import { AUTOMATED_NOTICE } from './types'
import type { AckContext } from './compose'

export async function readClientSmartAckConfig(clientId: string): Promise<SmartAckConfig> {
  const { data, error } = await supabaseAdmin.from('clients').select('leads_config').eq('id', clientId).maybeSingle()
  if (error) throw new Error(`[smart-ack] config read failed: ${error.message}`)
  return readSmartAckConfig(data?.leads_config)
}

interface MsgRow {
  direction: string
  body: string | null
  sent_at: string
}

export async function loadAckContext(conversationId: string): Promise<AckContext> {
  const { data, error } = await supabaseAdmin
    .from('conversation_messages')
    .select('direction, body, sent_at')
    .eq('conversation_id', conversationId)
    .order('sent_at', { ascending: false })
    .limit(30)
  if (error) throw new Error(`[smart-ack] messages read failed: ${error.message}`)
  const rows = ((data ?? []) as MsgRow[]).slice().reverse() // oldest first
  const inbound = rows.filter((r) => r.direction === 'inbound' && (r.body ?? '').trim() !== '')
  const recentInbound = inbound.slice(-3).map((r) => r.body ?? '')
  const currentText = recentInbound[recentInbound.length - 1] ?? ''
  const lastOut = rows.filter((r) => r.direction === 'outbound').pop()
  // An earlier inbound counts as "already answered" when any outbound came after it.
  const repliedEarlierInbound = inbound
    .slice(0, -1)
    .filter((m) => rows.some((r) => r.direction === 'outbound' && r.sent_at > m.sent_at))
    .map((m) => m.body ?? '')
  return { recentInbound, currentText, repliedEarlierInbound, lastOutbound: lastOut?.body ?? null }
}

/** Smart acks sent today (UTC) for this client — identified by the automated-notice suffix + the shared agent sender. */
export async function countSmartAcksToday(clientId: string): Promise<number> {
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const { count, error } = await supabaseAdmin
    .from('conversation_outbound_log')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', clientId)
    .eq('sent_by_email', AUTOACK_SENT_BY_EMAIL)
    .eq('status', 'sent')
    .eq('used_ai_draft', false)
    .like('body', `%${AUTOMATED_NOTICE}`)
    .gte('created_at', since.toISOString())
  if (error) throw new Error(`[smart-ack] cap read failed: ${error.message}`)
  return count ?? 0
}
