import { MU_MICROS, roundDiv } from './money'
import { MN_TEMPLATE_V12 } from './template'

const CENT_MICROS = MU_MICROS / 100n
const MID = BigInt(MN_TEMPLATE_V12.retailMidMuCents) * CENT_MICROS
const CAP = BigInt(MN_TEMPLATE_V12.retailCapMuCents) * CENT_MICROS
const SPAN = CAP - MID

/**
 * Retail MU for one order. `basisMicros` is the seller's best-month personal MU.
 * Rate runs 25% → 30% by 1,800 MU, then → 35% by 7,200 MU, measured on price.
 * Order MU is already USD × this product's cap, so the payout is (R / 60%) × Q.
 */
export function retailMicros(poolMicros: bigint, basisMicros: bigint): bigint {
  if (poolMicros === 0n) return 0n
  const basis = basisMicros > 0n ? basisMicros : 0n
  if (basis <= MID) return roundDiv(poolMicros * (5n * MID + basis), 12n * MID)
  if (basis < CAP) return roundDiv(poolMicros * (6n * SPAN + (basis - MID)), 12n * SPAN)
  return roundDiv(poolMicros * 7n, 12n)
}

/** Retail rate in basis points of the price, rounded half-up to 0.01 percentage point. */
export function retailRateBp(basisMicros: bigint): number {
  const basis = basisMicros > 0n ? basisMicros : 0n
  if (basis <= MID) return Number(roundDiv(2500n * MID + 500n * basis, MID))
  if (basis < CAP) return Number(roundDiv(3000n * SPAN + 500n * (basis - MID), SPAN))
  return 3500
}
