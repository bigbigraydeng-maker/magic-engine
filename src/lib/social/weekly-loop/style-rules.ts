/**
 * Style rules for picking the next reel (design 2026-11-05-social-agent-account-self-check-loop-v0.1.md §4 tier A, knife 2.5b).
 * Pure. Same numbers as the account audit (D1 template run, D2 same music within 7 days, D3 variants within 7 days),
 * so the schedule stops producing what the audit reports. A reel without style data is never held back (unknown ≠ violation).
 */
import { normaliseMusic } from '@/lib/social/account-audit/audit'

export interface EntryStyle {
  template: string | null
  /** Normalised track name (see normaliseMusic). */
  music: string | null
  /** Id (8 chars) of the original this reel is a variant of, or its own id when it is an original. */
  variantGroup: string | null
  /** template|brandColor|scenes */
  signature: string | null
}

export type StyleViolation = 'music_repeat' | 'variant_crowd' | 'template_run'

export interface StyledPlacement {
  publishOn: string
  style?: EntryStyle | null
}

export const STYLE_LIMITS = { sameMusicDays: 7, variantDays: 7, maxTemplateRun: 2, maxRunGapDays: 2 } as const

const DAY_MS = 86_400_000

function dayNumber(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS)
}

export function styleOf(input: { template: string | null; music: string | null; scenes: number | null; brandColor: string | null; variantOf: string | null; id: string }): EntryStyle {
  return {
    template: input.template,
    music: normaliseMusic(input.music),
    variantGroup: input.variantOf ?? input.id.slice(0, 8),
    signature: input.template !== null && input.scenes !== null ? `${input.template}|${input.brandColor ?? '?'}|${input.scenes}` : null,
  }
}

function apart(a: string, b: string): number {
  return Math.abs(dayNumber(a) - dayNumber(b))
}

/** Placements split around the slot day, nearest first on each side. A placement with an unknown template is kept (it breaks a run). */
function sides(slotDate: string, placed: readonly StyledPlacement[]): { before: Array<{ publishOn: string; style: EntryStyle | null }>; after: Array<{ publishOn: string; style: EntryStyle | null }> } {
  const all = placed.map((p) => ({ publishOn: p.publishOn, style: p.style ?? null }))
  const before = all.filter((p) => p.publishOn < slotDate).sort((a, b) => b.publishOn.localeCompare(a.publishOn))
  const after = all.filter((p) => p.publishOn > slotDate).sort((a, b) => a.publishOn.localeCompare(b.publishOn))
  return { before, after }
}

/** How many consecutive same-template reels sit next to the slot on one side; a gap of more than 2 days ends the run. */
function runLength(template: string, from: string, side: ReadonlyArray<{ publishOn: string; style: EntryStyle | null }>): number {
  let n = 0
  let prev = from
  for (const s of side) {
    if (s.style?.template !== template || apart(prev, s.publishOn) > STYLE_LIMITS.maxRunGapDays) break
    n += 1
    prev = s.publishOn
  }
  return n
}

/** Why this reel may not go on `slotDate` given what is already placed; null = fine. */
export function styleViolation(style: EntryStyle | null | undefined, slotDate: string, placed: readonly StyledPlacement[]): StyleViolation | null {
  if (!style) return null
  if (style.music !== null && placed.some((p) => p.style?.music === style.music && apart(p.publishOn, slotDate) < STYLE_LIMITS.sameMusicDays)) return 'music_repeat'
  if (style.variantGroup !== null && placed.some((p) => p.style?.variantGroup === style.variantGroup && apart(p.publishOn, slotDate) <= STYLE_LIMITS.variantDays)) return 'variant_crowd'
  if (style.template !== null) {
    const { before, after } = sides(slotDate, placed)
    if (runLength(style.template, slotDate, before) + runLength(style.template, slotDate, after) + 1 > STYLE_LIMITS.maxTemplateRun) return 'template_run'
  }
  return null
}

/** Among reels that may go on the day, prefer the one that looks least like its neighbours (lower is better). */
export function stylePenalty(style: EntryStyle | null | undefined, slotDate: string, placed: readonly StyledPlacement[]): number {
  if (!style || style.template === null) return 0
  const { before, after } = sides(slotDate, placed)
  let penalty = 0
  if (before[0]?.style?.template === style.template && apart(before[0].publishOn, slotDate) <= STYLE_LIMITS.maxRunGapDays) penalty += 2
  if (after[0]?.style?.template === style.template && apart(after[0].publishOn, slotDate) <= STYLE_LIMITS.maxRunGapDays) penalty += 2
  if (style.signature !== null && before[0]?.style?.signature === style.signature) penalty += 1
  return penalty
}
