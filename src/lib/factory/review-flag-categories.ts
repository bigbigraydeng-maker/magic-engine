// Pure module: safe to import from client components (no node imports).
// Only brief-deviation flags may be accepted by a PM. Red-line, competitor-brand,
// placeholder-caption and automatic-check failures must never be acceptable.

export const ACCEPTABLE_FLAG_CATEGORIES = ['narrator_voice_mismatch'] as const

export type AcceptableFlagCategory = (typeof ACCEPTABLE_FLAG_CATEGORIES)[number]

export function isAcceptableFlagCategory(v: unknown): v is AcceptableFlagCategory {
  return typeof v === 'string' && (ACCEPTABLE_FLAG_CATEGORIES as readonly string[]).includes(v)
}
