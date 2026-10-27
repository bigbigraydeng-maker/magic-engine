// Creative-pool update for a material that passed dual review. Does not set a promo window.

import type { CreativePoolEntry } from '@/lib/ads-strategy/config'
import { AI_DUAL_REVIEWER } from './asset-dual-review'

function heldByOther(pool: CreativePoolEntry[], workOrderId: string, videoId: string): boolean {
  return pool.some((entry) => (
    entry.ref !== workOrderId && (entry.ref === videoId || (entry.alias_refs ?? []).includes(videoId))
  ))
}

function approvedEntry(
  existing: CreativePoolEntry | undefined,
  workOrderId: string,
  at: string,
  videoId?: string | null,
): CreativePoolEntry {
  const prior = existing?.alias_refs ?? []
  const alias = videoId && !prior.includes(videoId) ? [...prior, videoId] : prior
  const next: CreativePoolEntry = {
    ...(existing ?? { kind: 'work_order', ref: workOrderId, status: 'candidate' }),
    kind: 'work_order',
    ref: workOrderId,
    status: 'approved',
    approved_by: AI_DUAL_REVIEWER,
    approved_at: at,
  }
  if (alias.length > 0) next.alias_refs = alias
  return next
}

export function poolAfterPass(
  pool: CreativePoolEntry[],
  workOrderId: string,
  at: string,
  videoId?: string | null,
): { ok: true; pool: CreativePoolEntry[] } | { ok: false; reason: string } {
  const existing = pool.find((entry) => entry.ref === workOrderId)
  if (existing && existing.kind !== 'work_order') return { ok: false, reason: '素材池里这条编号已经是别的种类' }
  if (existing && existing.status === 'approved') return { ok: true, pool }
  if (videoId && heldByOther(pool, workOrderId, videoId)) {
    return { ok: false, reason: '这个视频编号已经在素材池的另一条里' }
  }
  if (existing && existing.status !== 'candidate') return { ok: false, reason: '素材池里这条现在不能批准' }
  const next = approvedEntry(existing, workOrderId, at, videoId)
  return { ok: true, pool: [...pool.filter((entry) => entry.ref !== workOrderId), next] }
}
