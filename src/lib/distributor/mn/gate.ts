export interface GateAmounts {
  poolMicros: bigint
  reservedMicros: bigint
  peerMicros: bigint
  adjustmentMicros: bigint
  marginal18Micros: bigint
}

export interface GateCut {
  peerMicros: bigint
  teamCutMicros: bigint
  shortfallMicros: bigint
  payableMicros: bigint
}

/**
 * Peer is paid from the month's undistributed remainder. If that is still over the
 * distributor-cap pool, cut peer first, then the 18% team slice. Retail, the two
 * levels, and the 3/8/14 slices are not reduced. Anything still over is a shortfall,
 * not a further cut — the plan does not say to touch those.
 */
export function applyGate(amounts: GateAmounts): GateCut {
  const remainder = amounts.poolMicros > amounts.reservedMicros ? amounts.poolMicros - amounts.reservedMicros : 0n
  const peerMicros = amounts.peerMicros < remainder ? amounts.peerMicros : remainder
  let payable = amounts.reservedMicros + peerMicros + amounts.adjustmentMicros
  let teamCutMicros = 0n
  if (payable > amounts.poolMicros) {
    const excess = payable - amounts.poolMicros
    teamCutMicros = excess < amounts.marginal18Micros ? excess : amounts.marginal18Micros
    payable -= teamCutMicros
  }
  const shortfallMicros = payable > amounts.poolMicros ? payable - amounts.poolMicros : 0n
  return { peerMicros, teamCutMicros, shortfallMicros, payableMicros: payable - shortfallMicros }
}
