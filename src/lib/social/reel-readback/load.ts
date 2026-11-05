/** Read-only loader: a client's factory-reel publish actions + their 72h receipts + work-order meta. A database error throws (never rendered as an empty "0"). */
import type { SupabaseClient } from '@supabase/supabase-js'
import { SOCIAL_PUBLISH_ACTION_TYPE } from '@/lib/social/post-measurement-store'
import type { PublishActionRow, ReceiptRow } from '@/lib/social/post-performance'
import { toAuditReel } from '@/lib/social/account-audit/load'
import { reelTitle } from '@/lib/social/week-pack/manifest'
import { buildReelReadback, type ReelMeta, type ReelReadbackItem } from './report'

const MAX_ACTIONS = 200

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function rows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? data.filter(isRecord) : []
}

export async function loadReelReadback(db: SupabaseClient, input: { clientId: string; since: Date; now: Date }): Promise<{ items: ReelReadbackItem[]; unmatched: number }> {
  const sinceIso = input.since.toISOString()
  const actionsRes = await db
    .from('flywheel_actions')
    .select('id, executed_at, payload')
    .eq('client_id', input.clientId)
    .eq('action_type', SOCIAL_PUBLISH_ACTION_TYPE)
    .eq('payload->>source', 'factory_reel')
    .gte('executed_at', sinceIso)
    .order('executed_at', { ascending: false })
    .limit(MAX_ACTIONS)
  if (actionsRes.error) throw new Error(`reel_readback_actions_failed: ${actionsRes.error.message}`)
  const actions = rows(actionsRes.data).map((r): PublishActionRow => ({ id: String(r.id), executed_at: typeof r.executed_at === 'string' ? r.executed_at : null, payload: r.payload }))
  if (actions.length === 0) return { items: [], unmatched: 0 }

  const receiptsRes = await db
    .from('social_post_measurement_receipts')
    .select('action_id, window_hours, status, measured_at, values, missing, reason')
    .eq('client_id', input.clientId)
    .in('action_id', actions.map((a) => a.id))
  if (receiptsRes.error) throw new Error(`reel_readback_receipts_failed: ${receiptsRes.error.message}`)
  const receipts = rows(receiptsRes.data) as unknown as ReceiptRow[]

  const woIds = [...new Set(actions.map((a) => (isRecord(a.payload) && typeof a.payload.work_order_id === 'string' ? a.payload.work_order_id : '')).filter(Boolean))]
  const ordersRes = woIds.length === 0 ? { data: [], error: null } : await db.from('content_work_orders').select('id, created_at, angle, brief').eq('client_id', input.clientId).in('id', woIds)
  if (ordersRes.error) throw new Error(`reel_readback_orders_failed: ${ordersRes.error.message}`)
  const metas = new Map<string, ReelMeta>()
  for (const r of rows(ordersRes.data)) {
    const reel = toAuditReel(r)
    metas.set(String(r.id), { id: String(r.id), title: reelTitle(r.angle), template: reel?.template ?? null, pillar: reel?.pillar ?? null })
  }
  return buildReelReadback({ actions, receipts, metas, now: input.now })
}
