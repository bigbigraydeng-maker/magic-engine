/** Production ports for the daily list (reads dated work orders, writes exclusions and the decision receipt). */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PromoteDeps, PromoteOrder } from '@/lib/factory/publish/promote/types'
import { DAILY_LIST_DECISION_ACTION, type DecidePorts, type DecisionReceipt } from './decide'
import { readSocialAgentSettings } from '@/lib/social/recipe/tier-defaults'

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toOrder(row: Record<string, unknown>): PromoteOrder {
  const obj = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {})
  return {
    id: String(row.id), client_id: String(row.client_id), status: String(row.status),
    master_brief_id: typeof row.master_brief_id === 'string' ? row.master_brief_id : null,
    brief: obj(row.brief), output: obj(row.output), review_ref: obj(row.review_ref), published_ref: obj(row.published_ref),
    updated_at: String(row.updated_at),
  }
}

/** brief.weekly_pack without publish_on, stamped as excluded. */
export function excludedBrief(brief: unknown, mark: { at: string; by: string; reason: string }): Record<string, unknown> {
  const base = isRecord(brief) ? brief : {}
  const pack = isRecord(base.weekly_pack) ? { ...base.weekly_pack } : {}
  const removedDay = typeof pack.publish_on === 'string' ? pack.publish_on : null
  delete pack.publish_on
  return { ...base, weekly_pack: { ...pack, excluded_by_card: { ...mark, publish_on: removedDay } } }
}

/** Whether the social agent (daily cadence) is on for this client. Unreadable = off. */
export async function socialAgentOn(db: SupabaseClient, clientId: string): Promise<boolean> {
  const { data, error } = await db.from('clients').select('publishing_calendar_config').eq('id', clientId).maybeSingle()
  if (error || !isRecord(data)) return false
  return readSocialAgentSettings(data.publishing_calendar_config ?? null, null).enabled
}

export function createDailyListPorts(db: SupabaseClient, promote: PromoteDeps): DecidePorts {
  return {
    promote,
    async listDatedOrders(clientId, from, to) {
      const { data, error } = await db
        .from('content_work_orders')
        .select('id, client_id, status, master_brief_id, brief, output, review_ref, published_ref, updated_at, angle')
        .eq('client_id', clientId)
        .gte('brief->weekly_pack->>publish_on', from)
        .lte('brief->weekly_pack->>publish_on', to)
        .limit(50)
      if (error) throw new Error(`daily_list_read_failed: ${error.message}`)
      return (Array.isArray(data) ? data : []).filter(isRecord).map((r) => ({ order: toOrder(r), angle: r.angle }))
    },
    async excludeOrder(clientId, orderId, mark) {
      const { data: row, error } = await db
        .from('content_work_orders')
        .select('id, brief, updated_at')
        .eq('id', orderId)
        .eq('client_id', clientId)
        .maybeSingle()
      if (error || !isRecord(row)) return 'failed'
      const { data: updated, error: uErr } = await db
        .from('content_work_orders')
        .update({ brief: excludedBrief(row.brief, mark), updated_at: new Date().toISOString() })
        .eq('id', orderId)
        .eq('client_id', clientId)
        .eq('updated_at', String(row.updated_at))
        .select('id')
      if (uErr) return 'failed'
      return Array.isArray(updated) && updated.length === 1 ? 'excluded' : 'conflict'
    },
    async writeReceipt(receipt: DecisionReceipt) {
      const { error } = await db.from('flywheel_actions').insert({
        client_id: receipt.client_id,
        flywheel: 'social',
        action_type: DAILY_LIST_DECISION_ACTION,
        payload: receipt,
        expected_metric: null,
        expected_delta: null,
      })
      if (error) throw new Error(`daily_list_receipt_failed: ${error.message}`)
    },
  }
}
