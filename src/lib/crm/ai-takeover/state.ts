/**
 * "AI takeover" of a guest: is it on, and since when. Pure.
 * Design: docs/specs/2026-11-08-crm-ai-takeover-and-dnc-reengage-design-v0.md §4.
 *
 * The event log (contact_automation_events) is the truth; contacts.ai_takeover_since only mirrors it.
 * The latest event wins. Two events at the same instant: "off" wins — the safe side is a human looking after the guest.
 * Takeover never changes the guest's stage.
 */

export type TakeoverKind = 'ai_takeover_on' | 'ai_takeover_off'

export const TAKEOVER_KINDS: readonly TakeoverKind[] = ['ai_takeover_on', 'ai_takeover_off']

export interface TakeoverEvent {
  kind: TakeoverKind
  createdAt: string
  actor: string
}

export type TakeoverState =
  | { on: true; since: string; actor: string }
  | { on: false; offAt: string | null; actor: string | null }

export function isTakeoverKind(v: unknown): v is TakeoverKind {
  return v === 'ai_takeover_on' || v === 'ai_takeover_off'
}

function ms(v: string): number {
  const t = Date.parse(v)
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t
}

/** Is this event later than the current pick? Ties go to "off". */
function laterThan(e: TakeoverEvent, pick: TakeoverEvent): boolean {
  const a = ms(e.createdAt)
  const b = ms(pick.createdAt)
  if (a !== b) return a > b
  return e.kind === 'ai_takeover_off'
}

export function takeoverState(events: readonly TakeoverEvent[]): TakeoverState {
  let latest: TakeoverEvent | null = null
  for (const e of events) {
    if (!isTakeoverKind(e.kind)) continue
    if (latest === null || laterThan(e, latest)) latest = e
  }
  if (latest === null) return { on: false, offAt: null, actor: null }
  if (latest.kind === 'ai_takeover_on') return { on: true, since: latest.createdAt, actor: latest.actor }
  return { on: false, offAt: latest.createdAt, actor: latest.actor }
}

/** The value the mirror column should hold for this log. */
export function mirrorValue(events: readonly TakeoverEvent[]): string | null {
  const s = takeoverState(events)
  return s.on ? s.since : null
}
