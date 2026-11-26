/**
 * Earnings simulator for the public application page. Builds a made-up month (me + N direct
 * distributors, all sales on one plan) and runs it through the real statement engine, so the page can
 * never show a number the monthly settlement would not pay. Pure; safe in the browser.
 */
import { AI_STEWARD_RULES_V1 as RULES } from './config'
import { computeStatement } from './commission'
import type { Distributor, DistributorLevel, Sale } from './types'

export interface SimulationInput {
  myLevel: DistributorLevel
  planCode: string
  /** Plans I sell myself in the month. */
  mySales: number
  /** Distributors directly under me. */
  directCount: number
  directLevel: DistributorLevel
  /** Plans each of them sells in the month. */
  salesEach: number
}

export interface SimulationResult {
  planMonthlyCents: number
  retailCents: number
  peerCents: number
  teamCents: number
  /** Team reward computed but not paid because I sold nothing myself in the last 90 days. */
  teamWithheldCents: number
  totalCents: number
  teamSalesCents: number
  teamRateBp: number
  /** What one of my direct distributors would earn in the same month (retail + team). */
  eachDirectCents: number
}

export const SIMULATION_LIMITS = { maxSales: 200, maxDirect: 50 } as const

const PERIOD_END = '2026-12-01T00:00:00+13:00'
const PAID_AT = '2026-11-05T00:00:00+13:00'
const LEVEL_FROM = '2026-01-01T00:00:00+13:00'

function clampCount(n: number, max: number): number {
  return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.floor(n))) : 0
}

export function simulateMonth(input: SimulationInput): SimulationResult {
  const plan = RULES.catalog.plans.find((p) => p.code === input.planCode) ?? RULES.catalog.plans[0]
  const mySales = clampCount(input.mySales, SIMULATION_LIMITS.maxSales)
  const directCount = clampCount(input.directCount, SIMULATION_LIMITS.maxDirect)
  const salesEach = clampCount(input.salesEach, SIMULATION_LIMITS.maxSales)

  const me: Distributor = { id: 'me', parentId: null, levelHistory: [{ level: input.myLevel, effectiveFrom: LEVEL_FROM }] }
  const kids: Distributor[] = Array.from({ length: directCount }, (_, i) => ({
    id: `d${i}`, parentId: 'me', levelHistory: [{ level: input.directLevel, effectiveFrom: LEVEL_FROM }],
  }))
  let seq = 0
  const sell = (sellerId: string, count: number): Sale[] =>
    Array.from({ length: count }, () => ({
      id: `s${(seq += 1)}`, sellerId, kind: 'plan' as const, amountCents: plan.monthlyCents,
      currency: RULES.currency, paidAt: PAID_AT, isSelfPurchase: false,
    }))
  const sales = [...sell('me', mySales), ...kids.flatMap((k) => sell(k.id, salesEach))]

  const statement = computeStatement({
    distributors: [me, ...kids], periodSales: sales, allSales: sales, periodEnd: PERIOD_END,
    rules: RULES, teamByMonth: new Map(), settledSales: new Map(),
  })
  const sum = (id: string, kind: string, payable: boolean) =>
    statement.lines.filter((l) => l.distributorId === id && l.kind === kind && l.payable === payable)
      .reduce((total, l) => total + l.amountCents, 0)
  const retailCents = sum('me', 'retail', true)
  const peerCents = sum('me', 'peer', true)
  const teamCents = sum('me', 'team', true)
  const eachDirectCents = directCount > 0
    ? ['retail', 'peer', 'team'].reduce((t, k) => t + sum('d0', k, true), 0)
    : 0
  return {
    planMonthlyCents: plan.monthlyCents,
    retailCents,
    peerCents,
    teamCents,
    teamWithheldCents: sum('me', 'team', false),
    totalCents: retailCents + peerCents + teamCents,
    teamSalesCents: statement.teamSalesCents.get('me') ?? 0,
    teamRateBp: statement.teamMonth.get('me')?.rateBp ?? 0,
    eachDirectCents,
  }
}

/** "$6,711.60" — NZD cents for display; `whole` drops the cents. */
export function formatDollars(cents: number, whole = false): string {
  const digits = whole ? 0 : 2
  return `$${(cents / 100).toLocaleString('en-NZ', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`
}

export const SIMULATION_EXAMPLES: ReadonlyArray<{ title: string; description: string; input: SimulationInput }> = [
  { title: '刚起步', description: '普通经销商，自己卖 5 单，带 3 个普通经销商每人卖 5 单', input: { myLevel: 'standard', planCode: 'videos-16', mySales: 5, directCount: 3, directLevel: 'standard', salesEach: 5 } },
  { title: '小团队', description: '一级经销商（要先满足升级条件），自己卖 10 单，带 10 个普通经销商每人卖 8 单', input: { myLevel: 'tier1', planCode: 'videos-16', mySales: 10, directCount: 10, directLevel: 'standard', salesEach: 8 } },
  { title: '大团队', description: '特级经销商（要先满足升级条件），自己卖 20 单，带 20 个一级经销商每人卖 10 单', input: { myLevel: 'premier', planCode: 'videos-16', mySales: 20, directCount: 20, directLevel: 'tier1', salesEach: 10 } },
]

/** The "only recruit, never sell" case the page warns about. */
export const NO_OWN_SALES_EXAMPLE: SimulationInput = { myLevel: 'standard', planCode: 'videos-16', mySales: 0, directCount: 10, directLevel: 'standard', salesEach: 8 }
