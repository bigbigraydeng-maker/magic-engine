/** Integer MU cents. 1 cent = 0.01 MU = 0.01 USD. Rates are basis points (1% = 100). */

export class MnConfigError extends Error {}

export const MU_MICROS = 1_000_000n
const CENT_MICROS = 10_000n

/** Half-up division. The denominator must be positive. */
export function roundDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new MnConfigError('denominator must be positive')
  const negative = numerator < 0n
  const magnitude = negative ? -numerator : numerator
  const rounded = (magnitude + denominator / 2n) / denominator
  return negative ? -rounded : rounded
}

export function centsToMicros(cents: number): bigint {
  if (!Number.isInteger(cents)) throw new MnConfigError('money must be integer cents')
  return BigInt(cents) * CENT_MICROS
}

export function microsToCents(micros: bigint): number {
  return Number(roundDiv(micros, CENT_MICROS))
}

/** Split `total` across weights. The parts sum to `total`. A zero weight gets nothing. */
export function allocateBig(total: bigint, weights: readonly bigint[]): bigint[] {
  if (total < 0n) throw new MnConfigError('allocation total must be >= 0')
  const sum = weights.reduce((acc, weight) => acc + weight, 0n)
  if (sum === 0n || total === 0n) return weights.map(() => 0n)
  const base = weights.map((weight) => (total * weight) / sum)
  let used = base.reduce((acc, part) => acc + part, 0n)
  const order = weights.map((weight, index) => ({ index, remainder: (total * weight) % sum }))
  order.sort((a, b) => (a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1))
  let cursor = 0
  while (used < total) {
    base[order[cursor].index] += 1n
    used += 1n
    cursor = (cursor + 1) % order.length
  }
  return base
}
