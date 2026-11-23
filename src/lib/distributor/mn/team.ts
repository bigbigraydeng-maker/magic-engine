import { MU_MICROS, roundDiv } from './money'
import { MN_TEMPLATE_V12 } from './template'

interface Band { fromMicros: bigint; points: bigint }

const CENT_MICROS = MU_MICROS / 100n
const BANDS: readonly Band[] = MN_TEMPLATE_V12.teamBands.map((band) => ({
  fromMicros: BigInt(band.fromMuCents) * CENT_MICROS,
  points: BigInt(band.points),
}))

const TOP = 18_000_000n * CENT_MICROS

/** Progressive team gross. Each slice is that slice's MU × its share of the 60-point anchor. */
export function teamGrossMicros(teamMicros: bigint): bigint {
  if (teamMicros <= 0n) return 0n
  let numerator = 0n
  for (let i = 0; i < BANDS.length; i += 1) {
    const start = BANDS[i].fromMicros
    if (teamMicros <= start) break
    const next = i + 1 < BANDS.length ? BANDS[i + 1].fromMicros : teamMicros
    const end = teamMicros < next ? teamMicros : next
    numerator += (end - start) * BANDS[i].points
  }
  return roundDiv(numerator, 60n)
}

/** The part of team gross that comes only from MU above 180,000. The 60% gate may cut this, and nothing below it. */
export function marginal18Micros(teamMicros: bigint): bigint {
  if (teamMicros <= TOP) return 0n
  return roundDiv((teamMicros - TOP) * 18n, 60n)
}
