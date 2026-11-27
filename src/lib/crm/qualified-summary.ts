/**
 * "已报价的客人今天有几位在等" — the numbers behind the entry at the top of the priority list. Pure.
 *
 * Qualified = the guest's stage is one of the client's own qualified stages (ad strategy config; "quoted and after"
 * for the first client, PM 2026-11-03). They are the guests closest to a booking, and they sit scattered through a
 * list of over a thousand people: this counts them so staff see the pile every morning and can open it in one click
 * (the page filters the same list by those stages). It moves nobody and changes no order.
 *
 * Counted by where the guest already is on the list:
 *   waiting — said something / a call-back is due, nobody has answered (replied, callback_due)
 *   moved   — clicked a link in our mail or is reading the site, nobody followed up (clicked_link, reading_site)
 *   quiet   — we talked and it went silent, or we never got through (stale_conversation, handoff_sop, retry_channel,
 *             new_untouched)
 * A guest in "AI 跟进中", handled today, set aside for later or not to be contacted is in none of the three.
 */

import type { Segment } from './segments'

export interface QualifiedSummary {
  /** The client's qualified stage keys that exist in its stage list (what the page filters by). */
  stageKeys: string[]
  waiting: number
  moved: number
  quiet: number
}

export interface QualifiedRow {
  stage: string | null
  segment: Segment
  handled: boolean
  aiTakeover: boolean
}

const WAITING: ReadonlySet<Segment> = new Set<Segment>(['replied', 'callback_due'])
const MOVED: ReadonlySet<Segment> = new Set<Segment>(['clicked_link', 'reading_site'])
const QUIET: ReadonlySet<Segment> = new Set<Segment>(['stale_conversation', 'handoff_sop', 'retry_channel', 'new_untouched'])

/** Null when the client has no qualified stage that is in its stage list: no entry is shown. */
export function qualifiedSummary(
  rows: readonly QualifiedRow[],
  qualifiedStageKeys: ReadonlySet<string>,
  knownStageKeys: readonly string[],
): QualifiedSummary | null {
  const stageKeys = knownStageKeys.filter((k) => qualifiedStageKeys.has(k))
  if (stageKeys.length === 0) return null
  const keys = new Set(stageKeys)
  const out: QualifiedSummary = { stageKeys, waiting: 0, moved: 0, quiet: 0 }
  for (const r of rows) {
    if (r.stage === null || !keys.has(r.stage) || r.handled || r.aiTakeover) continue
    if (WAITING.has(r.segment)) out.waiting += 1
    else if (MOVED.has(r.segment)) out.moved += 1
    else if (QUIET.has(r.segment)) out.quiet += 1
  }
  return out
}
