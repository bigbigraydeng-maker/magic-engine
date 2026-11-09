import { buildSaleBook, netOfRefunds } from './refund'
import { toMs } from './time'
import { levelAt, levelRank, type DistributorIndex } from './tree'
import type { CommissionRules, DistributorLevel, Sale } from './types'

/**
 * Net amount per original sale (sale + every known refund), keeping only sales past the refund window.
 * Known limitation: an upgrade already granted is not reversed by a refund after the window.
 */
export function maturedNetSales(
  sellerId: string,
  allSales: readonly Sale[],
  asOf: string,
  rules: CommissionRules,
): Array<{ sale: Sale; netCents: number }> {
  const cutoff = toMs(asOf) - rules.refundWindowDays * 86_400_000
  const book = buildSaleBook(allSales)
  return allSales
    .filter((s) => s.sellerId === sellerId && s.kind !== 'refund' && toMs(s.paidAt) <= cutoff)
    .map((sale) => ({ sale, netCents: netOfRefunds(sale, book) }))
    .filter((row) => row.netCents > 0)
}

export interface UpgradeInput {
  distributorId: string
  index: DistributorIndex
  allSales: readonly Sale[]
  /** Team sales of the distributor for consecutive completed months, oldest first, no gaps. */
  recentMonthlyTeamSalesCents: readonly number[]
  asOf: string
  rules: CommissionRules
}

export interface UpgradeDecision {
  current: DistributorLevel
  next: DistributorLevel | null
  reason: string
}

/** One step at a time: standard → tier1 → premier. Never downgrades. Suspended never upgrade. */
export function evaluateUpgrade(input: UpgradeInput): UpgradeDecision {
  const { index, rules, asOf } = input
  const me = index.byId.get(input.distributorId)
  if (!me) throw new Error(`unknown distributor ${input.distributorId}`)
  const current = levelAt(me, asOf)
  if (me.suspended) return { current, next: null, reason: 'suspended' }
  if (current === 'standard') return evaluateTier1(input, current)
  if (current === 'tier1') {
    const months = input.recentMonthlyTeamSalesCents.slice(-rules.upgrade.premierConsecutiveMonths)
    const salesOk = months.length === rules.upgrade.premierConsecutiveMonths
      && months.every((m) => m >= rules.upgrade.premierMonthlyTeamSalesCents)
    const directTier1 = (index.children.get(me.id) ?? []).filter((kid) => {
      const child = index.byId.get(kid)
      return child !== undefined && !child.suspended && levelRank(levelAt(child, asOf)) >= levelRank('tier1')
    }).length
    const teamOk = directTier1 >= rules.upgrade.premierMinDirectTier1
    if (salesOk && teamOk) return { current, next: 'premier', reason: `team sales ${months.length} months ≥ threshold; ${directTier1} direct tier1+` }
    return { current, next: null, reason: `premier not met: salesOk=${salesOk}, directTier1=${directTier1}` }
  }
  return { current, next: null, reason: 'already premier' }
}

function evaluateTier1(input: UpgradeInput, current: DistributorLevel): UpgradeDecision {
  const { rules } = input
  const matured = maturedNetSales(input.distributorId, input.allSales, input.asOf, rules)
  const bigSelfPurchase = matured.some(
    (row) => row.sale.isSelfPurchase && row.netCents >= rules.upgrade.tier1SingleSelfPurchaseCents,
  )
  if (bigSelfPurchase) return { current, next: 'tier1', reason: 'single self-purchase reached threshold' }
  const direct = matured.filter((row) => !row.sale.isSelfPurchase).reduce((sum, row) => sum + row.netCents, 0)
  if (direct >= rules.upgrade.tier1CumulativeDirectSalesCents) {
    return { current, next: 'tier1', reason: 'cumulative direct sales reached threshold' }
  }
  return { current, next: null, reason: `tier1 not met: direct sales ${direct} cents` }
}
