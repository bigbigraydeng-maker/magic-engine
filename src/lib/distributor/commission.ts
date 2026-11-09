import { ancestorsOf, DistributorTreeError, indexDistributors, levelAt, type DistributorIndex } from './tree'
import type { CommissionLine, CommissionRules, Distributor, Sale } from './types'

/** floor(|amount| × bp / 10000) with the sign of amount, so a refund mirrors its sale exactly. */
export function applyRate(amountCents: number, rateBp: number): number {
  const magnitude = Math.floor((Math.abs(amountCents) * rateBp) / 10_000)
  return amountCents < 0 ? -magnitude : magnitude
}

export function teamRateFor(teamSalesCents: number, rules: CommissionRules): number {
  let rate = 0
  for (const step of rules.teamRateSteps) {
    if (teamSalesCents >= step.minTeamSalesCents) rate = step.rateBp
  }
  return rate
}

/** The sale whose time decides levels: a refund uses the sale it refunds. */
function pricingAnchor(sale: Sale, saleById: ReadonlyMap<string, Sale>): Sale {
  if (sale.kind !== 'refund') return sale
  const original = sale.refundOfSaleId ? saleById.get(sale.refundOfSaleId) : undefined
  if (!original) throw new DistributorTreeError(`refund ${sale.id} has no known original sale`)
  return original
}

/** Retail line for the seller plus the peer line for the nearest same-level upline. */
export function saleLines(
  sale: Sale,
  index: DistributorIndex,
  saleById: ReadonlyMap<string, Sale>,
  rules: CommissionRules,
): CommissionLine[] {
  const seller = index.byId.get(sale.sellerId)
  if (!seller) throw new DistributorTreeError(`sale ${sale.id} has unknown seller ${sale.sellerId}`)
  const at = pricingAnchor(sale, saleById).paidAt
  const sellerLevel = levelAt(seller, at)
  const lines: CommissionLine[] = [{
    distributorId: seller.id,
    kind: 'retail',
    saleId: sale.id,
    amountCents: applyRate(sale.amountCents, rules.retailRateBp[sellerLevel]),
    payable: true,
    note: `retail ${sellerLevel}`,
  }]
  const peerId = ancestorsOf(index.byId, seller.id).find((id) => {
    const upline = index.byId.get(id) as Distributor
    return levelAt(upline, at) === sellerLevel
  })
  if (peerId) {
    lines.push({
      distributorId: peerId,
      kind: 'peer',
      saleId: sale.id,
      amountCents: applyRate(sale.amountCents, rules.peerRateBp),
      payable: true,
      note: `peer ${sellerLevel} from ${seller.id}`,
    })
  }
  return lines
}

export interface TeamResult {
  teamSalesCents: Map<string, number>
  grossCents: Map<string, number>
  lines: CommissionLine[]
}

/**
 * Differential team commission for one period.
 * gross(x) = floor(rate(T) × T) with T = own + all downline sales in the period;
 * net(x) = gross(x) − Σ gross(direct children), floored at 0.
 * Because gross is floored, net is never negative when every period total is ≥ 0,
 * and the nets of a tree sum to the root's gross (one top rate, never stacked).
 */
export function teamLines(
  periodSales: readonly Sale[],
  index: DistributorIndex,
  rules: CommissionRules,
  inactiveIds: ReadonlySet<string>,
): TeamResult {
  const own = new Map<string, number>()
  for (const sale of periodSales) own.set(sale.sellerId, (own.get(sale.sellerId) ?? 0) + sale.amountCents)
  const teamSalesCents = new Map<string, number>()
  const grossCents = new Map<string, number>()
  const visit = (id: string): void => {
    const kids = index.children.get(id) ?? []
    let total = own.get(id) ?? 0
    for (const kid of kids) {
      visit(kid)
      total += teamSalesCents.get(kid) ?? 0
    }
    teamSalesCents.set(id, total)
    const base = Math.max(0, total)
    grossCents.set(id, applyRate(base, teamRateFor(base, rules)))
  }
  for (const root of index.roots) visit(root)
  const lines: CommissionLine[] = []
  for (const [id, gross] of grossCents) {
    const kidsGross = (index.children.get(id) ?? []).reduce((sum, kid) => sum + (grossCents.get(kid) ?? 0), 0)
    const net = Math.max(0, gross - kidsGross)
    if (net === 0) continue
    const withheld = inactiveIds.has(id)
    lines.push({
      distributorId: id,
      kind: 'team',
      saleId: null,
      amountCents: net,
      payable: !withheld,
      note: withheld ? 'team withheld: no personal sales in inactivity window' : 'team differential',
    })
  }
  return { teamSalesCents, grossCents, lines }
}

/** Distributors with no positive personal sale in the inactivity window ending at asOf. */
export function inactiveDistributors(
  distributors: readonly Distributor[],
  allSales: readonly Sale[],
  asOf: string,
  rules: CommissionRules,
): Set<string> {
  const windowStart = Date.parse(asOf) - rules.teamInactivityDays * 86_400_000
  const active = new Set<string>()
  for (const sale of allSales) {
    const ms = Date.parse(sale.paidAt)
    if (sale.amountCents > 0 && ms >= windowStart && ms <= Date.parse(asOf)) active.add(sale.sellerId)
  }
  return new Set(distributors.map((d) => d.id).filter((id) => !active.has(id)))
}

export interface StatementInput {
  distributors: readonly Distributor[]
  /** Sales (incl. refunds) settled in this period — already past the refund window. */
  periodSales: readonly Sale[]
  /** Every known sale, used to resolve refunds and inactivity. */
  allSales: readonly Sale[]
  /** ISO end of the period (exclusive). */
  periodEnd: string
  rules: CommissionRules
}

export interface Statement {
  rulesVersion: string
  lines: CommissionLine[]
  payableByDistributor: Map<string, number>
  teamSalesCents: Map<string, number>
}

export function computeStatement(input: StatementInput): Statement {
  const index = indexDistributors(input.distributors)
  const saleById = new Map(input.allSales.map((s) => [s.id, s]))
  for (const s of input.periodSales) saleById.set(s.id, s)
  const lines = input.periodSales.flatMap((s) => saleLines(s, index, saleById, input.rules))
  const inactive = inactiveDistributors(input.distributors, input.allSales, input.periodEnd, input.rules)
  const team = teamLines(input.periodSales, index, input.rules, inactive)
  lines.push(...team.lines)
  const payableByDistributor = new Map<string, number>()
  for (const line of lines) {
    if (!line.payable) continue
    payableByDistributor.set(line.distributorId, (payableByDistributor.get(line.distributorId) ?? 0) + line.amountCents)
  }
  return { rulesVersion: input.rules.version, lines, payableByDistributor, teamSalesCents: team.teamSalesCents }
}
