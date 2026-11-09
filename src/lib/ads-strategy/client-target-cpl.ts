/**
 * One target cost per lead for the breaker and for creative cards.
 * Read from the client settings row, the breaker block, and approved plans.
 * A missing number is missing. Two different numbers are not a guess.
 */

export interface TargetCplInput {
  readonly strategyMajor?: unknown
  readonly leadsConfig?: unknown
  readonly planRows?: readonly { plan_data?: unknown }[]
}

type CentsRead =
  | { readonly state: 'absent' }
  | { readonly state: 'set'; readonly cents: number }
  | { readonly state: 'conflict' }

const ABSENT: CentsRead = { state: 'absent' }
const CONFLICT: CentsRead = { state: 'conflict' }

export function resolveTargetCplCents(input: TargetCplInput): number | null {
  const reads = [strategyCents(input.strategyMajor), breakerCents(input.leadsConfig), planCents(input.planRows ?? [])]
  if (reads.some((read) => read.state === 'conflict')) return null
  const present = reads.flatMap((read) => (read.state === 'set' ? [read.cents] : []))
  if (present.length === 0) return null
  return new Set(present).size === 1 ? present[0] : null
}

export function resolveTargetCplMajor(input: TargetCplInput): number | null {
  const cents = resolveTargetCplCents(input)
  return cents === null ? null : cents / 100
}

function strategyCents(value: unknown): CentsRead {
  const amount = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  if (!Number.isFinite(amount) || amount <= 0) return ABSENT
  const cents = Math.round(amount * 100)
  if (!Number.isSafeInteger(cents) || cents <= 0) return ABSENT
  if (Math.abs(amount * 100 - cents) > 1e-6) return ABSENT
  return { state: 'set', cents }
}

function breakerCents(leadsConfig: unknown): CentsRead {
  const block = objectOf(objectOf(leadsConfig)?.ads_circuit_breaker)
  if (!block || !('target_cpl_cents' in block)) return ABSENT
  return centsOf(block.target_cpl_cents)
}

function planCents(rows: readonly { plan_data?: unknown }[]): CentsRead {
  const values: Array<number | null> = []
  for (const row of rows) {
    const promo = objectOf(objectOf(row.plan_data)?.promo)
    if (!promo || !('target_cpl_cents' in promo)) continue
    const cents = centsOf(promo.target_cpl_cents)
    values.push(cents.state === 'set' ? cents.cents : null)
  }
  if (values.length === 0) return ABSENT
  if (values.some((cents) => cents === null) || new Set(values).size !== 1) return CONFLICT
  return { state: 'set', cents: values[0] as number }
}

function centsOf(value: unknown): CentsRead {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return ABSENT
  return { state: 'set', cents: value }
}

function objectOf(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}
