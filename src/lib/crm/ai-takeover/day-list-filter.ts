/**
 * Today's list and the AI takeover. Pure.
 *
 *   · A guest in takeover is not in "today, contact these" — the AI is following them, staff should not call twice.
 *   · If the guest came back after takeover-on (customerCameBack), they are shown again, tagged "客人回来了".
 *     The takeover mark is NOT removed: only a staff click on "收回人工" does that.
 *   · Takeover switched on today (since >= the client's local day start) stays on today's list as it is: the day list
 *     never lets our own action of today move or drop a person (see day-list.ts). From tomorrow they are hidden.
 */

import type { ReengageTouch } from '@/lib/crm/dnc-reengage'
import { SEGMENT_META, type SegmentResult } from '@/lib/crm/segments'
import { listOf } from '@/lib/crm/next-action'
import { customerCameBack, type CameBack } from './came-back'

export interface TakeoverMark {
  aiTakeover: boolean
  cameBack: CameBack | null
}

export interface TakeoverListOptions {
  /** contactId → ai_takeover_since (only guests currently in takeover). */
  takeoverSince: ReadonlyMap<string, string>
  touchesOf(contactId: string): readonly ReengageTouch[]
  dayStartMs: number
  now: Date
}

/** null = hide from today's list. */
export function takeoverMarkFor(contactId: string, opts: TakeoverListOptions): TakeoverMark | null {
  const since = opts.takeoverSince.get(contactId)
  if (since === undefined) return { aiTakeover: false, cameBack: null }
  const cameBack = customerCameBack(opts.touchesOf(contactId), since, opts.now)
  if (cameBack !== null) return { aiTakeover: true, cameBack }
  const sinceMs = Date.parse(since)
  if (!Number.isNaN(sinceMs) && sinceMs >= opts.dayStartMs) return { aiTakeover: true, cameBack: null }
  return null
}

/** Drops the guests the AI is handling; annotates the rest. Order is kept. */
export function applyTakeoverToDayList<T extends { id: string }>(
  rows: readonly T[],
  opts: TakeoverListOptions,
): Array<T & { takeover: TakeoverMark }> {
  const out: Array<T & { takeover: TakeoverMark }> = []
  for (const r of rows) {
    const mark = takeoverMarkFor(r.id, opts)
    if (mark !== null) out.push({ ...r, takeover: mark })
  }
  return out
}

/** The line the "先放着" list shows for a guest the AI is following. */
export const TAKEOVER_REASON = 'AI 跟进中：发了目录，等客人反应'

/**
 * For the two-list page ("今天要联系" / "先放着"): a guest in takeover who has not come back moves to "先放着",
 * with the reason said plainly. Only moves down, never up; never deletes (PM 2026-10-21: nobody vanishes).
 */
export function demoteForTakeover(seg: SegmentResult): SegmentResult {
  if (listOf(seg.segment) !== 'hot') return seg
  const meta = SEGMENT_META.nurture_future
  return { ...seg, segment: 'nurture_future', temperature: meta.temperature, priority: meta.priority, reason: TAKEOVER_REASON }
}
