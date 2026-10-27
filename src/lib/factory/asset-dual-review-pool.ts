// Creative-pool update for a material that passed dual review. Does not set a promo window.

import type { CreativePoolEntry } from '@/lib/ads-strategy/config'
import { AI_DUAL_REVIEWER } from './asset-dual-review'

export function poolAfterPass(
  pool: CreativePoolEntry[],
  workOrderId: string,
  at: string,
): { ok: true; pool: CreativePoolEntry[] } | { ok: false; reason: string } {
  const existing = pool.find((entry) => entry.ref === workOrderId)
  if (existing && existing.kind !== 'work_order') return { ok: false, reason: '素材池里这条编号已经是别的种类' }
  if (existing && existing.status === 'approved') return { ok: true, pool }
  if (existing && existing.status !== 'candidate') return { ok: false, reason: '素材池里这条现在不能批准' }
  const next: CreativePoolEntry = {
    ...(existing ?? { kind: 'work_order', ref: workOrderId, status: 'candidate' }),
    kind: 'work_order',
    ref: workOrderId,
    status: 'approved',
    approved_by: AI_DUAL_REVIEWER,
    approved_at: at,
  }
  return { ok: true, pool: [...pool.filter((entry) => entry.ref !== workOrderId), next] }
}
