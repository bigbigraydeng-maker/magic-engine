import { indexParents } from '../tree'
import { localCentsFromMu } from './fx'
import type { MnIdentity } from './policy'
import { productShareLink } from './share'
import type { MnStatement } from './settle'
import { MN_TEMPLATE_V12 } from './template'

export interface NetworkPerson {
  id: string
  parentId: string | null
  displayName: string
  identity: MnIdentity | 'unset'
  status: string
}

export interface NetworkProduct { productId: string; name: string }

export interface NetworkSettlement {
  month: string
  status: 'computed' | 'approved' | 'paid' | 'voided'
  payoutMuCents: number
  carryMuCents: number
}

export interface NetworkView {
  ready: boolean
  displayName: string
  status: string
  identityLabel: string
  monthLabel: string
  pendingMuCents: number
  validMuCents: number
  retailRateLabel: string
  retailBasisMuCents: number
  retailNextLabel: string | null
  teamMuCents: number
  teamTierLabel: string
  teamNextLabel: string | null
  earnings: { retail: number; l1: number; l2: number; team: number; peer: number; total: number }
  byProduct: { productId: string; name: string; muCents: number; retail: number; l1: number; l2: number }[]
  tree: { id: string; name: string; identityLabel: string; teamMuCents: number; depth: number }[]
  settlements: { month: string; statusLabel: string; payoutMuCents: number; carryMuCents: number }[]
  payoutStatusLabel: string
  minimumMuCents: number
  fxLabel: string | null
  localPayoutLabel: string | null
  shares: { productName: string; code: string; url: string }[]
  notices: string[]
}

const STATUS_LABEL: Record<NetworkSettlement['status'], string> = {
  computed: '已算好，待批准',
  approved: '已批准，待打款',
  paid: '已打款',
  voided: '已作废',
}

export function formatMu(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  const whole = Math.trunc(absolute / 100).toLocaleString('en-NZ')
  const fraction = String(absolute % 100).padStart(2, '0')
  return `${sign}${whole}.${fraction} MU`
}

function identityLabel(identity: NetworkPerson['identity'], viewerIsThisPerson: boolean): string {
  if (identity === 'unset') return '尚未认定'
  if (identity === 'Core' && !viewerIsThisPerson) return 'Nexus'
  return identity
}

function teamTier(cents: number): { current: string; next: string | null } {
  const bands = [
    { at: 360_000, label: '3% 档' },
    { at: 1_080_000, label: '8% 档' },
    { at: 3_600_000, label: '14% 档' },
    { at: 18_000_000, label: '18% 档' },
  ]
  const reached = bands.filter((band) => cents >= band.at)
  const upcoming = bands.find((band) => cents < band.at)
  return {
    current: reached.length > 0 ? reached[reached.length - 1].label : '未到档',
    next: upcoming ? `离${upcoming.label}还差 ${formatMu(upcoming.at - cents)}` : null,
  }
}

function retailNext(basisCents: number): string | null {
  if (basisCents < MN_TEMPLATE_V12.retailMidMuCents) {
    return `离 30% 那一档还差 ${formatMu(MN_TEMPLATE_V12.retailMidMuCents - basisCents)}`
  }
  if (basisCents < MN_TEMPLATE_V12.retailCapMuCents) {
    return `离 35% 封顶还差 ${formatMu(MN_TEMPLATE_V12.retailCapMuCents - basisCents)}`
  }
  return null
}

function earningsOf(statement: MnStatement | null, viewerId: string): NetworkView['earnings'] {
  const totals = { retail: 0, l1: 0, l2: 0, team: 0, peer: 0, total: 0 }
  for (const line of statement?.lines ?? []) {
    if (line.personId !== viewerId) continue
    if (line.kind === 'adjustment') totals.total += line.muCents
    else totals[line.kind] += line.muCents
    if (line.kind !== 'adjustment') totals.total += line.muCents
  }
  return totals
}

function productRow(rows: Map<string, NetworkView['byProduct'][number]>, productId: string, names: ReadonlyMap<string, string>) {
  const row = rows.get(productId) ?? { productId, name: names.get(productId) ?? productId, muCents: 0, retail: 0, l1: 0, l2: 0 }
  rows.set(productId, row)
  return row
}

function productsOf(
  statement: MnStatement | null,
  viewerId: string,
  names: ReadonlyMap<string, string>,
  orders: readonly { sellerId: string; productId: string; muCents: number }[],
) {
  const rows = new Map<string, NetworkView['byProduct'][number]>()
  for (const order of orders) {
    if (order.sellerId === viewerId) productRow(rows, order.productId, names).muCents += order.muCents
  }
  for (const line of statement?.lines ?? []) {
    if (line.personId !== viewerId || !line.productId) continue
    if (line.kind !== 'retail' && line.kind !== 'l1' && line.kind !== 'l2') continue
    productRow(rows, line.productId, names)[line.kind] += line.muCents
  }
  return [...rows.values()]
}

function treeOf(people: readonly NetworkPerson[], viewerId: string, team: ReadonlyMap<string, number>) {
  const index = indexParents(people)
  const byId = index.byId
  const rows: NetworkView['tree'] = []
  const walk = (id: string, depth: number): void => {
    for (const child of index.children.get(id) ?? []) {
      const person = byId.get(child)
      if (!person) continue
      rows.push({
        id: child,
        name: person.displayName,
        identityLabel: identityLabel(person.identity, false),
        teamMuCents: team.get(child) ?? 0,
        depth,
      })
      walk(child, depth + 1)
    }
  }
  walk(viewerId, 1)
  return rows
}

function payoutLabel(statement: MnStatement | null, viewerId: string, minimum: number): string {
  const balance = statement?.balances.get(viewerId)
  if (!balance) return '还没有月结'
  if (balance.carryCents < 0) return '有未扣清的差额，暂缓打款'
  if (balance.payoutCents === 0 && balance.carryCents > 0) return `未满 ${formatMu(minimum)}，结转到下月`
  if (balance.payoutCents > 0) return '已计入应发，尚未自动打款'
  return '本月没有应发'
}

export interface NetworkInput {
  viewerId: string
  people: readonly NetworkPerson[]
  referralCode: string | null
  origin: string
  month: string | null
  pendingMuCents: number
  statement: MnStatement | null
  settlements: readonly NetworkSettlement[]
  products: readonly NetworkProduct[]
  fx: { currency: string; usdPerUnitMicros: number; source: string } | null
  notices: readonly string[]
  ready: boolean
  minimumMuCents?: number
  orders?: readonly { sellerId: string; productId: string; muCents: number }[]
}

export function buildNetworkView(input: NetworkInput): NetworkView {
  const me = input.people.find((person) => person.id === input.viewerId)
  if (!me) throw new Error('distributor not found')
  const minimum = input.minimumMuCents ?? 5_000
  const names = new Map(input.products.map((product) => [product.productId, product.name]))
  const basis = input.statement?.retailBasisMuCents.get(input.viewerId) ?? 0
  const rate = input.statement?.retailRateBp.get(input.viewerId) ?? MN_TEMPLATE_V12.retailFloorBp
  const team = input.statement?.teamMuCents.get(input.viewerId) ?? 0
  const tier = teamTier(team)
  const balance = input.statement?.balances.get(input.viewerId)
  const shares = input.referralCode
    ? input.products.map((product) => ({ productName: product.name, ...productShareLink(input.origin, product.productId, input.referralCode as string) }))
    : []
  const local = input.fx && balance ? localCentsFromMu(balance.payoutCents, input.fx.usdPerUnitMicros) : null
  return {
    ready: input.ready,
    displayName: me.displayName,
    status: me.status,
    identityLabel: identityLabel(me.identity, true),
    monthLabel: input.month ?? '还没有销售月',
    pendingMuCents: input.pendingMuCents,
    validMuCents: input.statement?.personalMuCents.get(input.viewerId) ?? 0,
    retailRateLabel: `${(rate / 100).toFixed(2)}%`,
    retailBasisMuCents: basis,
    retailNextLabel: input.statement ? retailNext(basis) : null,
    teamMuCents: team,
    teamTierLabel: input.statement ? tier.current : '未到档',
    teamNextLabel: input.statement ? tier.next : null,
    earnings: earningsOf(input.statement, input.viewerId),
    byProduct: productsOf(input.statement, input.viewerId, names, input.orders ?? []),
    tree: treeOf(input.people, input.viewerId, input.statement?.teamMuCents ?? new Map()),
    settlements: input.settlements.filter((row) => row.status !== 'voided').map((row) => ({
      month: row.month, statusLabel: STATUS_LABEL[row.status], payoutMuCents: row.payoutMuCents, carryMuCents: row.carryMuCents,
    })),
    payoutStatusLabel: payoutLabel(input.statement, input.viewerId, minimum),
    minimumMuCents: minimum,
    fxLabel: input.fx ? `${input.fx.currency} · ${input.fx.source}` : null,
    localPayoutLabel: local === null || !input.fx ? null : `${(local / 100).toFixed(2)} ${input.fx.currency}`,
    shares,
    notices: [...input.notices],
  }
}
