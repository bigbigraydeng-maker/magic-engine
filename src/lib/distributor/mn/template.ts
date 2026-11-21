/**
 * v1.2 standard split. Shares are points out of a 60-point anchor (Magic Lab's cap).
 * A product only supplies its total commission and its distributor cap. Module rates
 * are derived. Peer bonus is not reserved inside the cap (decision 甲).
 */
import { MnConfigError } from './money'

export const MN_TEMPLATE_V12 = {
  version: 'mn-distributor-v1.2',
  anchorPoints: 60,
  level1Points: 5,
  level2Points: 2,
  retailFloorBp: 2500,
  retailMidBp: 3000,
  retailCapBp: 3500,
  retailMidMuCents: 180_000,
  retailCapMuCents: 720_000,
  teamBands: [
    { fromMuCents: 360_000, points: 3 },
    { fromMuCents: 1_080_000, points: 8 },
    { fromMuCents: 3_600_000, points: 14 },
    { fromMuCents: 18_000_000, points: 18 },
  ],
  peerGenerations: 2,
  peerGen1Bp: 1000,
  peerGen2Bp: 500,
} as const

export interface ProductCard {
  productId: string
  name: string
  currency: string
  totalCommissionBp: number
  distributorCapBp: number
}

/** Reserved retail cap + two levels + team cap, as points. Peer is excluded on purpose. */
export function reservedPoints(): number {
  const teamMax = MN_TEMPLATE_V12.teamBands[MN_TEMPLATE_V12.teamBands.length - 1]?.points ?? 0
  return 35 + MN_TEMPLATE_V12.level1Points + MN_TEMPLATE_V12.level2Points + teamMax
}

export function cardError(totalCommissionBp: number, distributorCapBp: number): string | null {
  if (!Number.isInteger(totalCommissionBp) || totalCommissionBp < 0 || totalCommissionBp > 10_000) {
    return 'total commission must be an integer from 0 to 10000 basis points'
  }
  if (!Number.isInteger(distributorCapBp) || distributorCapBp < 0 || distributorCapBp > totalCommissionBp) {
    return 'distributor cap must be between 0 and the total commission'
  }
  if (reservedPoints() > MN_TEMPLATE_V12.anchorPoints) return 'template reserves more than the anchor'
  return null
}

export function buildCard(input: ProductCard): ProductCard {
  const error = cardError(input.totalCommissionBp, input.distributorCapBp)
  if (error) throw new MnConfigError(error)
  return input
}

/** Price-percent basis points of one template point, scaled by this product's cap. */
export function scaledBp(points: number, card: ProductCard): number {
  return Math.round((points * card.distributorCapBp) / MN_TEMPLATE_V12.anchorPoints)
}
