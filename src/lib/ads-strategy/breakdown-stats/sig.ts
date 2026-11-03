import type { BreakdownValue } from './types'

/**
 * Deterministic signature for a breakdown value.
 * Keys sorted ascending; `{}` → `''`.
 */
export function breakdownSig(value: BreakdownValue): string {
  const keys = Object.keys(value).sort()
  return keys.map((k) => `${k}=${String(value[k]).trim()}`).join('|')
}
