import { buildSaleBook, netOfRefunds, resolveRefund, type SaleBook } from './refund'
import { monthKey, toMs } from './time'
import { ancestorsOf, DistributorTreeError, indexDistributors, levelAt, type DistributorIndex } from './tree'
import type {
  CommissionLine,
  CommissionRules,
  Distributor,
  DistributorBalance,
  Sale,
  SettledSaleInfo,
  TeamMonthEntry,
} from './types'

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

export type TeamByMonth = ReadonlyMap<string, ReadonlyMap<string, TeamMonthEntry>>

interface SaleContext {
  index: DistributorIndex
  book: SaleBook
  rules: CommissionRules
  /** Settlement info of every original sale a refund may point at (earlier statements + this one). */
  settled: ReadonlyMap<string, SettledSaleInfo>
  teamByMonth: TeamByMonth
}

/** Commission at a rate. For a refund: drop in commission on the original's remaining net (exact over partials). */
type AmountAt = (rateBp: number) => number

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

function settledOf(original: Sale, ctx: SaleContext): SettledSaleInfo {
  const info = ctx.settled.get(original.id)
  if (!info) throw new DistributorTreeError(`original sale ${original.id} was never settled; settle it before its refund`)
  return info
}

function line(d: Distributor, kind: CommissionLine['kind'], saleId: string | null, amountCents: number, note: string): CommissionLine {
  // Clawbacks always apply; earnings of a suspended distributor are recorded but not paid.
  return { distributorId: d.id, kind, saleId, amountCents, payable: amountCents < 0 || !d.suspended, note }
}

/**
 * Retail line for the seller plus the peer line for the nearest same-level upline
 * (uplines of other levels are skipped). Levels come from the original sale's time.
 * A refund claws back only lines that were actually paid for the original.
 */
export function saleLines(sale: Sale, ctx: SaleContext): CommissionLine[] {
  const seller = ctx.index.byId.get(sale.sellerId)
  if (!seller) throw new DistributorTreeError(`sale ${sale.id} has unknown seller ${sale.sellerId}`)
  const { anchor, amountAt } = amountFunction(sale, ctx)
  const unpaid = sale.kind === 'refund' ? settledOf(anchor, ctx).unpaid : new Set<string>()
  const sellerLevel = levelAt(seller, anchor.paidAt)
  const lines: CommissionLine[] = []
  if (!unpaid.has(`retail:${seller.id}`)) {
    lines.push(line(seller, 'retail', sale.id, amountAt(ctx.rules.retailRateBp[sellerLevel]), `retail ${sellerLevel}`))
  }
  const peerId = ancestorsOf(ctx.index.byId, seller.id).find(
    (id) => levelAt(ctx.index.byId.get(id) as Distributor, anchor.paidAt) === sellerLevel,
  )
  if (peerId && !unpaid.has(`peer:${peerId}`)) {
    const peer = ctx.index.byId.get(peerId) as Distributor
    lines.push(line(peer, 'peer', sale.id, amountAt(ctx.rules.peerRateBp), `peer ${sellerLevel} from ${seller.id}`))
  }
  return lines.filter((l) => l.amountCents !== 0)
}

/**
 * Team clawback for a refund, against the month in which the original sale was settled: each upline
 * on the path loses its marginal rate (own rate minus the rate of the child it was reached through).
 * Uplines whose team commission was not paid that month are not charged.
 * Known limitation: uses the current upline chain, not the chain at the original sale.
 */
export function refundTeamLines(refund: Sale, ctx: SaleContext): CommissionLine[] {
  const { anchor, amountAt } = amountFunction(refund, ctx)
  const month = settledOf(anchor, ctx).month
  const team = ctx.teamByMonth.get(month)
  if (!team) throw new DistributorTreeError(`no stored team results for ${month}; cannot claw back ${refund.id}`)
  const lines: CommissionLine[] = []
  let below = 0
  for (const id of [refund.sellerId, ...ancestorsOf(ctx.index.byId, refund.sellerId)]) {
    const entry = team.get(id) ?? { rateBp: 0, paid: true }
    const amount = amountAt(Math.max(0, entry.rateBp - below))
    below = Math.max(below, entry.rateBp)
    if (amount !== 0 && entry.paid) {
      lines.push(line(ctx.index.byId.get(id) as Distributor, 'team', refund.id, amount, `team clawback ${month}`))
    }
  }
  return lines
}

export interface TeamResult {
  teamSalesCents: Map<string, number>
  teamRateBp: Map<string, number>
  grossCents: Map<string, number>
  lines: CommissionLine[]
}

/**
 * Differential team commission for one period, on non-refund sales only (refunds are clawed back
 * against their settlement month by refundTeamLines). gross(x) = floor(rate(T) × T),
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
    const withheld = inactiveIds.has(id)
    const base = line(index.byId.get(id) as Distributor, 'team', null, net, withheld ? 'team withheld: no personal sales in inactivity window' : 'team differential')
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
  /**
   * Sales and refunds settled in this period. Sales must be past the refund window; a refund whose
   * original has never been settled must come in the same period as that original.
   */
  periodSales: readonly Sale[]
  /** Every known sale, used to resolve refunds and inactivity. */
  allSales: readonly Sale[]
  /** ISO end of the period (exclusive); the period's month is the month just before it. */
  periodEnd: string
  rules: CommissionRules
  /** Team results stored by earlier statements: month (YYYY-MM) → distributor id → entry. */
  teamByMonth: TeamByMonth
  /** Settlement info of sales settled by earlier statements. */
  settledSales: ReadonlyMap<string, SettledSaleInfo>
  /** Debts carried from the previous statement (≤ 0); missing = 0. */
  openingBalances?: ReadonlyMap<string, number>
}

export interface Statement {
  rulesVersion: string
  periodMonth: string
  lines: CommissionLine[]
  balances: Map<string, DistributorBalance>
  teamSalesCents: Map<string, number>
  /** Store per distributor for this month; later refunds need it. */
  teamMonth: Map<string, TeamMonthEntry>
  /** Store per non-refund sale settled in this statement. */
  settledSales: Map<string, SettledSaleInfo>
}

export function computeStatement(input: StatementInput): Statement {
  const index = indexDistributors(input.distributors)
  const book = buildSaleBook(input.allSales, input.periodSales)
  const periodMonth = monthKey(new Date(toMs(input.periodEnd) - 1).toISOString(), input.rules.timeZone)
  const sales = input.periodSales.filter((s) => s.kind !== 'refund')
  const refunds = input.periodSales.filter((s) => s.kind === 'refund')
  const base: SaleContext = { index, book, rules: input.rules, settled: input.settledSales, teamByMonth: input.teamByMonth }
  const lines = sales.flatMap((s) => saleLines(s, base))
  const inactive = inactiveDistributors(input.distributors, book, input.periodEnd, input.rules)
  const team = teamLines(sales, index, input.rules, inactive)
  lines.push(...team.lines)
  const teamMonth = new Map<string, TeamMonthEntry>()
  for (const [id, rateBp] of team.teamRateBp) {
    teamMonth.set(id, { rateBp, paid: !inactive.has(id) && !(index.byId.get(id) as Distributor).suspended })
  }
  const settledSales = new Map<string, SettledSaleInfo>()
  for (const s of sales) {
    const unpaid = new Set(lines.filter((l) => l.saleId === s.id && !l.payable).map((l) => `${l.kind}:${l.distributorId}`))
    settledSales.set(s.id, { month: periodMonth, unpaid })
  }
  const ctx: SaleContext = {
    ...base,
    settled: new Map([...input.settledSales, ...settledSales]),
    teamByMonth: new Map([...input.teamByMonth, [periodMonth, teamMonth]]),
  }
  for (const r of refunds) lines.push(...saleLines(r, ctx), ...refundTeamLines(r, ctx))
  return {
    rulesVersion: input.rules.version,
    periodMonth,
    lines,
    balances: settleBalances(input.distributors, lines, input.openingBalances),
    teamSalesCents: team.teamSalesCents,
    teamMonth,
    settledSales,
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
