import { buildSaleBook, netOfRefunds, resolveRefund, type SaleBook } from './refund'
import { monthKey, toMs } from './time'
import { ancestorsOf, DistributorTreeError, indexDistributors, levelAt, type DistributorIndex } from './tree'
import type { CommissionLine, CommissionRules, Distributor, DistributorBalance, Sale } from './types'

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

/**
 * Commission amount for a sale at a rate. For a refund, the clawback is the drop in commission
 * on the original's remaining net, so many small partial refunds claw back exactly the full amount.
 */
type AmountAt = (rateBp: number) => number

interface SaleContext {
  index: DistributorIndex
  book: SaleBook
  rules: CommissionRules
}

function amountFunction(sale: Sale, ctx: SaleContext): { anchor: Sale; amountAt: AmountAt } {
  if (sale.currency !== ctx.rules.currency) {
    throw new DistributorTreeError(`sale ${sale.id} currency ${sale.currency} ≠ ${ctx.rules.currency}`)
  }
  if (sale.kind !== 'refund') {
    if (sale.amountCents <= 0) throw new DistributorTreeError(`sale ${sale.id} must be positive`)
    return { anchor: sale, amountAt: (bp) => applyRate(sale.amountCents, bp) }
  }
  const r = resolveRefund(sale, ctx.book)
  return { anchor: r.original, amountAt: (bp) => applyRate(r.afterCents, bp) - applyRate(r.beforeCents, bp) }
}

function line(d: Distributor, kind: CommissionLine['kind'], saleId: string | null, amountCents: number, note: string): CommissionLine {
  // Clawbacks always apply; earnings of a suspended distributor are recorded but not paid.
  return { distributorId: d.id, kind, saleId, amountCents, payable: amountCents < 0 || !d.suspended, note }
}

/**
 * Retail line for the seller plus the peer line for the nearest same-level upline
 * (uplines of other levels are skipped). Levels come from the original sale's time.
 */
export function saleLines(sale: Sale, ctx: SaleContext): CommissionLine[] {
  const seller = ctx.index.byId.get(sale.sellerId)
  if (!seller) throw new DistributorTreeError(`sale ${sale.id} has unknown seller ${sale.sellerId}`)
  const { anchor, amountAt } = amountFunction(sale, ctx)
  const sellerLevel = levelAt(seller, anchor.paidAt)
  const lines = [line(seller, 'retail', sale.id, amountAt(ctx.rules.retailRateBp[sellerLevel]), `retail ${sellerLevel}`)]
  const peerId = ancestorsOf(ctx.index.byId, seller.id).find(
    (id) => levelAt(ctx.index.byId.get(id) as Distributor, anchor.paidAt) === sellerLevel,
  )
  if (peerId) {
    const peer = ctx.index.byId.get(peerId) as Distributor
    lines.push(line(peer, 'peer', sale.id, amountAt(ctx.rules.peerRateBp), `peer ${sellerLevel} from ${seller.id}`))
  }
  return lines.filter((l) => l.amountCents !== 0)
}

/**
 * Team clawback for a refund: each upline on the path loses its marginal rate (own rate minus the
 * rate of the child it was reached through) as stored for the original sale's month.
 * Known limitation: uses the current upline chain, not the chain at the original sale.
 */
export function refundTeamLines(
  refund: Sale,
  ctx: SaleContext,
  teamRatesByMonth: ReadonlyMap<string, ReadonlyMap<string, number>>,
): CommissionLine[] {
  const { anchor, amountAt } = amountFunction(refund, ctx)
  const month = monthKey(anchor.paidAt, ctx.rules.timeZone)
  const rates = teamRatesByMonth.get(month)
  if (!rates) throw new DistributorTreeError(`no stored team rates for ${month}; cannot claw back ${refund.id}`)
  const lines: CommissionLine[] = []
  let below = 0
  for (const id of [refund.sellerId, ...ancestorsOf(ctx.index.byId, refund.sellerId)]) {
    const rate = rates.get(id) ?? 0
    const amount = amountAt(Math.max(0, rate - below))
    below = Math.max(below, rate)
    if (amount !== 0) lines.push(line(ctx.index.byId.get(id) as Distributor, 'team', refund.id, amount, `team clawback ${month}`))
  }
  return lines
}

export interface TeamResult {
  teamSalesCents: Map<string, number>
  /** Rate per distributor this period (0 when below the ladder); store it for later clawbacks. */
  teamRateBp: Map<string, number>
  grossCents: Map<string, number>
  lines: CommissionLine[]
}

/**
 * Differential team commission for one period, on non-refund sales only (refunds are clawed back
 * against their original month by refundTeamLines). gross(x) = floor(rate(T) × T),
 * net(x) = gross(x) − Σ gross(direct children) ≥ 0; the nets of a tree sum to the root's gross.
 */
export function teamLines(
  periodSales: readonly Sale[],
  index: DistributorIndex,
  rules: CommissionRules,
  inactiveIds: ReadonlySet<string>,
): TeamResult {
  const own = new Map<string, number>()
  for (const s of periodSales) if (s.kind !== 'refund') own.set(s.sellerId, (own.get(s.sellerId) ?? 0) + s.amountCents)
  const teamSalesCents = new Map<string, number>()
  const teamRateBp = new Map<string, number>()
  const grossCents = new Map<string, number>()
  const visit = (id: string): void => {
    let total = own.get(id) ?? 0
    for (const kid of index.children.get(id) ?? []) {
      visit(kid)
      total += teamSalesCents.get(kid) ?? 0
    }
    teamSalesCents.set(id, total)
    teamRateBp.set(id, teamRateFor(total, rules))
    grossCents.set(id, applyRate(total, teamRateBp.get(id) ?? 0))
  }
  for (const root of index.roots) visit(root)
  const lines: CommissionLine[] = []
  for (const [id, gross] of grossCents) {
    const net = gross - (index.children.get(id) ?? []).reduce((sum, kid) => sum + (grossCents.get(kid) ?? 0), 0)
    if (net <= 0) continue
    const d = index.byId.get(id) as Distributor
    const withheld = inactiveIds.has(id)
    const base = line(d, 'team', null, net, withheld ? 'team withheld: no personal sales in inactivity window' : 'team differential')
    lines.push({ ...base, payable: base.payable && !withheld })
  }
  return { teamSalesCents, teamRateBp, grossCents, lines }
}

/** Distributors with no not-fully-refunded personal sale in [asOf − window, asOf). */
export function inactiveDistributors(
  distributors: readonly Distributor[],
  book: SaleBook,
  asOf: string,
  rules: CommissionRules,
): Set<string> {
  const end = toMs(asOf)
  const start = end - rules.teamInactivityDays * 86_400_000
  const active = new Set<string>()
  for (const s of book.saleById.values()) {
    const ms = toMs(s.paidAt)
    if (s.kind !== 'refund' && ms >= start && ms < end && netOfRefunds(s, book) > 0) active.add(s.sellerId)
  }
  return new Set(distributors.map((d) => d.id).filter((id) => !active.has(id)))
}

export interface StatementInput {
  distributors: readonly Distributor[]
  /** Sales and refunds settled in this period — already past the refund window. */
  periodSales: readonly Sale[]
  /** Every known sale, used to resolve refunds and inactivity. */
  allSales: readonly Sale[]
  /** ISO end of the period (exclusive). */
  periodEnd: string
  rules: CommissionRules
  /** Team rates stored by earlier statements, keyed by month (YYYY-MM) then distributor id. */
  teamRatesByMonth: ReadonlyMap<string, ReadonlyMap<string, number>>
  /** Debts carried from the previous statement (≤ 0); missing = 0. */
  openingBalances?: ReadonlyMap<string, number>
}

export interface Statement {
  rulesVersion: string
  lines: CommissionLine[]
  balances: Map<string, DistributorBalance>
  teamSalesCents: Map<string, number>
  teamRateBp: Map<string, number>
}

export function computeStatement(input: StatementInput): Statement {
  const index = indexDistributors(input.distributors)
  const book = buildSaleBook(input.allSales, input.periodSales)
  const ctx: SaleContext = { index, book, rules: input.rules }
  const lines = input.periodSales.flatMap((s) => saleLines(s, ctx))
  const inactive = inactiveDistributors(input.distributors, book, input.periodEnd, input.rules)
  const team = teamLines(input.periodSales, index, input.rules, inactive)
  lines.push(...team.lines)
  // A refund of a sale from this same period claws back at this period's freshly computed rates.
  const rates = new Map(input.teamRatesByMonth)
  rates.set(monthKey(new Date(toMs(input.periodEnd) - 1).toISOString(), input.rules.timeZone), team.teamRateBp)
  for (const s of input.periodSales) if (s.kind === 'refund') lines.push(...refundTeamLines(s, ctx, rates))
  return {
    rulesVersion: input.rules.version,
    lines,
    balances: settleBalances(input.distributors, lines, input.openingBalances),
    teamSalesCents: team.teamSalesCents,
    teamRateBp: team.teamRateBp,
  }
}

/** Opening debt + payable lines → payout (≥ 0) and carried debt (≤ 0). */
export function settleBalances(
  distributors: readonly Distributor[],
  lines: readonly CommissionLine[],
  openingBalances: ReadonlyMap<string, number> = new Map(),
): Map<string, DistributorBalance> {
  const period = new Map<string, number>()
  for (const l of lines) if (l.payable) period.set(l.distributorId, (period.get(l.distributorId) ?? 0) + l.amountCents)
  const balances = new Map<string, DistributorBalance>()
  for (const d of distributors) {
    const openingCents = openingBalances.get(d.id) ?? 0
    if (openingCents > 0) throw new DistributorTreeError(`opening balance of ${d.id} must be ≤ 0`)
    const periodCents = period.get(d.id) ?? 0
    const total = openingCents + periodCents
    balances.set(d.id, { openingCents, periodCents, payoutCents: Math.max(0, total), closingCents: Math.min(0, total) })
  }
  return balances
}
