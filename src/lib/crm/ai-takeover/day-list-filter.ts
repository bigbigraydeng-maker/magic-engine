/**
 * Today's list and the AI takeover. Pure.
 *
 *   · A guest in takeover is not in "today, contact these" — the AI is following them, staff should not call twice.
 *   · If the guest came back after takeover-on (customerCameBack), they are shown again, tagged "客人回来了".
 *     The takeover mark is NOT removed: only a staff click on "收回人工" does that.
 *   · If the guest opened what we sent (a click on our mail link) and nobody has talked to him since, his own list
 *     group says so (`clicked_link` / `reading_site`); he is shown again so staff ring him (PM 11-27). The takeover
 *     mark stays; the daily stop line removes it once staff really talk to him.
 *   · Takeover switched on today (since >= the client's local day start) stays on today's list as it is: the day list
 *     never lets our own action of today move or drop a person (see day-list.ts). From tomorrow they are hidden.
 */

import type { ReengageTouch } from '@/lib/crm/dnc-reengage'
import { SEGMENT_META, type Segment, type SegmentResult } from '@/lib/crm/segments'
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
  /** contactId → his latest human click on a link in a mail we sent (`SiteReading.lastClickAt`); absent = unknown. */
  lastClickAt?: (contactId: string) => string | null | undefined
}

/** Groups that mean "he opened what we sent and nobody has talked to him since" — staff should ring. */
const OPENED_OUR_MAIL: ReadonlySet<Segment> = new Set<Segment>(['clicked_link', 'reading_site'])

/** null = hide from today's list. `seg` is the guest's own list group, when the caller has it. */
export function takeoverMarkFor(contactId: string, opts: TakeoverListOptions, seg?: SegmentResult): TakeoverMark | null {
  const since = opts.takeoverSince.get(contactId)
  if (since === undefined) return { aiTakeover: false, cameBack: null }
  const cameBack = customerCameBack(opts.touchesOf(contactId), since, opts.now)
  if (cameBack !== null) return { aiTakeover: true, cameBack }
  const sinceMs = Date.parse(since)
  if (!Number.isNaN(sinceMs) && sinceMs >= opts.dayStartMs) return { aiTakeover: true, cameBack: null }
  if (seg !== undefined && OPENED_OUR_MAIL.has(seg.segment)) return { aiTakeover: true, cameBack: null }
  // Rang after he opened it and nobody picked up: still his turn to be rung, not the AI's.
  const click = Date.parse(opts.lastClickAt?.(contactId) ?? '')
  if (seg?.segment === 'retry_channel' && click > sinceMs) return { aiTakeover: true, cameBack: null }
  return null
}

/** Drops the guests the AI is handling; annotates the rest. Order is kept. */
export function applyTakeoverToDayList<T extends { id: string; seg?: SegmentResult }>(
  rows: readonly T[],
  opts: TakeoverListOptions,
): Array<T & { takeover: TakeoverMark }> {
  const out: Array<T & { takeover: TakeoverMark }> = []
  for (const r of rows) {
    const mark = takeoverMarkFor(r.id, opts, r.seg)
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
