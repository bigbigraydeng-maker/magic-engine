/**
 * What a distributor sees about themselves in the portal. Only their own sales, their own statement
 * lines and balances, and names + levels of their direct downline — never anyone else's money.
 */
import { supabaseAdmin } from '@/lib/supabase'
import { AI_STEWARD_RULES_V1 as RULES } from './config'
import { toDistributors, toSales, type DistributorDbRow, type LevelDbRow, type SaleDbRow } from './settlement'
import { fail, selectAll } from './store'
import { indexDistributors, levelAt } from './tree'
import { evaluateUpgrade, maturedNetSales } from './upgrade'
import type { DistributorLevel } from './types'

interface Row extends DistributorDbRow { display_name: string; approved_at: string | null; referral_code: string | null }

export interface PortalView {
  profile: { display_name: string; status: string; level: DistributorLevel | null; approved_at: string | null; referral_code: string | null }
  upgrade: {
    next: DistributorLevel | null
    selfPurchaseBestCents: number
    selfPurchaseTargetCents: number
    directSalesCents: number
    directSalesTargetCents: number
    recentTeamMonths: Array<{ month: string; team_sales_cents: number }>
    premierMonthlyTargetCents: number
    directTier1: number
    directTier1Target: number
  }
  team: { direct: Array<{ display_name: string; level: DistributorLevel | null; status: string }>; total: number }
  sales: Array<{ id: string; kind: string; plan_code: string | null; months: number | null; extra_avatars: number; amount_cents: number; paid_at: string; settled: boolean }>
  statements: Array<{ month: string; status: string; payout_cents: number; closing_cents: number; opening_cents: number; retail_cents: number; peer_cents: number; team_cents: number }>
}

async function own<T>(table: string, columns: string, distributorId: string, orderBy = 'id'): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).eq('distributor_id', distributorId).order(orderBy).range(from, from + 999)
    if (error) fail(`list own ${table}`, error)
    const page = (data ?? []) as T[]
    rows.push(...page)
    if (page.length < 1000) return rows
  }
}

/** Pending and rejected applicants are not team members yet: never shown to the upline, never counted. */
const TEAM_STATUSES = new Set(['approved', 'suspended'])

function countDescendants(children: ReadonlyMap<string, readonly string[]>, id: string, isMember: (id: string) => boolean): number {
  return (children.get(id) ?? []).filter(isMember).reduce((sum, kid) => sum + 1 + countDescendants(children, kid, isMember), 0)
}

export async function buildPortalView(distributorId: string, now = new Date()): Promise<PortalView> {
  const [rows, levels, sales, statements, balances, lines] = await Promise.all([
    selectAll<Row>('distributors', 'id, parent_id, status, display_name, approved_at, referral_code'),
    selectAll<LevelDbRow>('distributor_level_history', 'id, distributor_id, level, effective_from'),
    own<SaleDbRow & { plan_code: string | null; months: number | null; extra_avatars: number }>('distributor_sales', 'id, distributor_id, kind, amount_cents, currency, paid_at, is_self_purchase, refund_of_sale_id, settled_statement_id, plan_code, months, extra_avatars', distributorId),
    selectAll<{ id: string; period_month: string; status: string }>('distributor_statements', 'id, period_month, status'),
    own<{ statement_id: string; opening_cents: number; payout_cents: number; closing_cents: number; team_sales_cents: number }>('distributor_statement_balances', 'statement_id, opening_cents, payout_cents, closing_cents, team_sales_cents', distributorId, 'statement_id'),
    own<{ statement_id: string; kind: string; amount_cents: number; payable: boolean }>('distributor_commission_lines', 'statement_id, kind, amount_cents, payable', distributorId),
  ])
  const me = rows.find((r) => r.id === distributorId)
  if (!me) throw new Error('distributor not found')
  const index = indexDistributors(toDistributors(rows, levels))
  const asOf = now.toISOString()
  const levelOf = (id: string): DistributorLevel | null => {
    const d = index.byId.get(id)
    return d && d.levelHistory.length > 0 ? levelAt(d, asOf) : null
  }
  const live = statements.filter((s) => s.status !== 'voided').sort((a, b) => a.period_month.localeCompare(b.period_month))
  const balanceByStatement = new Map(balances.map((b) => [b.statement_id, b]))
  const upgrade = upgradeView({ distributorId, index, rows, sales: toSales(sales), live, balanceByStatement, asOf, levelOf })
  const statusById = new Map(rows.map((r) => [r.id, r.status]))
  const isMember = (id: string) => TEAM_STATUSES.has(statusById.get(id) ?? '')
  const directKids = (index.children.get(distributorId) ?? []).filter(isMember)
  return {
    profile: { display_name: me.display_name, status: me.status, level: levelOf(distributorId), approved_at: me.approved_at, referral_code: me.status === 'approved' ? me.referral_code : null },
    upgrade,
    team: {
      direct: directKids.map((k) => {
        const r = rows.find((x) => x.id === k)
        return { display_name: r?.display_name ?? '', level: levelOf(k), status: r?.status ?? '' }
      }),
      total: countDescendants(index.children, distributorId, isMember),
    },
    sales: [...sales]
      .sort((a, b) => b.paid_at.localeCompare(a.paid_at))
      .slice(0, 50)
      .map((s) => ({
        id: s.id, kind: s.kind, plan_code: s.plan_code, months: s.months, extra_avatars: s.extra_avatars,
        amount_cents: s.amount_cents, paid_at: s.paid_at,
        settled: s.settled_statement_id !== null && live.some((st) => st.id === s.settled_statement_id),
      })),
    statements: statementsView(live, balanceByStatement, lines),
  }
}

type Live = Array<{ id: string; period_month: string; status: string }>
type BalanceRow = { statement_id: string; opening_cents: number; payout_cents: number; closing_cents: number; team_sales_cents: number }

function upgradeView(input: {
  distributorId: string
  index: ReturnType<typeof indexDistributors>
  rows: readonly Row[]
  sales: ReturnType<typeof toSales>
  live: Live
  balanceByStatement: ReadonlyMap<string, BalanceRow>
  asOf: string
  levelOf: (id: string) => DistributorLevel | null
}): PortalView['upgrade'] {
  const { distributorId, index, rows, sales, live, balanceByStatement, asOf, levelOf } = input
  const recentTeamMonths = live
    .filter((s) => balanceByStatement.has(s.id))
    .slice(-RULES.upgrade.premierConsecutiveMonths)
    .map((s) => ({ month: s.period_month.slice(0, 7), team_sales_cents: balanceByStatement.get(s.id)?.team_sales_cents ?? 0 }))
  const matured = maturedNetSales(distributorId, sales, asOf, RULES)
  const directTier1 = (index.children.get(distributorId) ?? []).filter((k) => {
    const l = levelOf(k)
    return (l === 'tier1' || l === 'premier') && rows.find((r) => r.id === k)?.status === 'approved'
  }).length
  const decision = levelOf(distributorId)
    ? evaluateUpgrade({ distributorId, index, allSales: sales, recentMonthlyTeamSalesCents: recentTeamMonths.map((m) => m.team_sales_cents), asOf, rules: RULES })
    : null
  return {
    next: decision?.next ?? null,
    selfPurchaseBestCents: Math.max(0, ...matured.filter((m) => m.sale.isSelfPurchase).map((m) => m.netCents)),
    selfPurchaseTargetCents: RULES.upgrade.tier1SingleSelfPurchaseCents,
    directSalesCents: matured.filter((m) => !m.sale.isSelfPurchase).reduce((s, m) => s + m.netCents, 0),
    directSalesTargetCents: RULES.upgrade.tier1CumulativeDirectSalesCents,
    recentTeamMonths,
    premierMonthlyTargetCents: RULES.upgrade.premierMonthlyTeamSalesCents,
    directTier1,
    directTier1Target: RULES.upgrade.premierMinDirectTier1,
  }
}

function statementsView(
  live: Live,
  balanceByStatement: ReadonlyMap<string, BalanceRow>,
  lines: ReadonlyArray<{ statement_id: string; kind: string; amount_cents: number; payable: boolean }>,
): PortalView['statements'] {
  return [...live].reverse().filter((s) => balanceByStatement.has(s.id)).map((s) => {
    const b = balanceByStatement.get(s.id)
    const sum = (kind: string) => lines.filter((l) => l.statement_id === s.id && l.kind === kind && l.payable).reduce((t, l) => t + l.amount_cents, 0)
    return {
      month: s.period_month.slice(0, 7), status: s.status,
      payout_cents: b?.payout_cents ?? 0, closing_cents: b?.closing_cents ?? 0, opening_cents: b?.opening_cents ?? 0,
      retail_cents: sum('retail'), peer_cents: sum('peer'), team_cents: sum('team'),
    }
  })
}
