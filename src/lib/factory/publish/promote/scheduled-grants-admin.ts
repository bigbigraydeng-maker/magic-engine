// Reel scheduled go-public — the person-facing list, revoke and re-authorise. Design v0.2 §8.3.
// Revoke works per order, independent of which week the card shows and of whether Stories can be read.

import { mutatePayload } from './payload-lock'
import { readGrant, revokedGrant, withGrant, type ScheduledGrant } from './scheduled-grant'
import { TRAFFIC_ACTION_TYPE, type PromoteDeps } from './types'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface GrantRow { work_order_id: string; grant: ScheduledGrant }

const OPEN = ['armed', 'claimed', 'stale', 'missed', 'failed', 'unknown'] as const

function asRecord(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** Grants a person still has to see (approved, not yet public, or needing a decision) for one client. */
export async function listOpenGrants(db: SupabaseClient, clientId: string): Promise<GrantRow[]> {
  const { data, error } = await db
    .from('flywheel_actions')
    .select('payload')
    .eq('client_id', clientId)
    .eq('action_type', TRAFFIC_ACTION_TYPE)
    .in('payload->scheduled_go_public->>status', [...OPEN])
    .limit(100)
  if (error) throw new Error(`grant_list_failed: ${error.message}`)
  const out: GrantRow[] = []
  for (const row of Array.isArray(data) ? data : []) {
    const grant = readGrant(asRecord(asRecord(row).payload))
    if (grant) out.push({ work_order_id: grant.work_order_id, grant })
  }
  return out.sort((a, b) => a.grant.publish_on.localeCompare(b.grant.publish_on))
}

/** Revokes one order's grant. A grant an executor is holding right now (claimed) cannot be revoked. */
export async function revokeGrant(
  deps: PromoteDeps, input: { orderId: string; clientId: string; by: string },
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const rows = await deps.store.loadTrafficRows(input.orderId, input.clientId)
  if (rows.length !== 1) return { ok: false, status: 404, error: '找不到这条的授权' }
  const res = await mutatePayload(deps, rows[0], (cur) => {
    const next = revokedGrant(readGrant(cur), input.by, deps.now())
    return next ? withGrant(cur, next) : '这条现在不能撤回（正在发、已发或没有授权）'
  }, 3)
  return res.ok ? { ok: true } : { ok: false, status: 409, error: res.message }
}
