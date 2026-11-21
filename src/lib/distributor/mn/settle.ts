/**
 * One sales month of the v1.2 MU plan. This does not replace the NZD engine in ../commission.ts.
 * Orders passed in are already valid (45 days, not refunded) and already converted to MU cents.
 */
import { ancestorsOf, indexParents } from '../tree'
import { applyGate } from './gate'
import { allocateBig, centsToMicros, microsToCents, MnConfigError, roundDiv } from './money'
import type { IdentityPolicy, MnIdentity } from './policy'
import { retailMicros, retailRateBp } from './retail'
import { marginal18Micros, teamGrossMicros } from './team'
import { MN_TEMPLATE_V12 } from './template'

export interface MnPerson {
  id: string
  parentId: string | null
  identity: MnIdentity
  previousIdentity?: MnIdentity | null
  identitySinceMonth?: string | null
  suspended?: boolean
  priorBestMuCents?: number
}

export interface MnOrder {
  id: string
  sellerId: string
  productId: string
  muCents: number
  selfPurchase?: boolean
  annual?: boolean
}

export interface MnAdjustment {
  personId: string
  muCents: number
  note: string
}

export type MnLineKind = 'retail' | 'l1' | 'l2' | 'team' | 'peer' | 'adjustment'

export interface MnLine {
  personId: string
  kind: MnLineKind
  orderId: string | null
  productId: string | null
  muCents: number
  payable: boolean
  note: string
}

export interface MnBalance {
  openingCents: number
  periodCents: number
  payoutCents: number
  carryCents: number
}

export interface MnGateSummary {
  poolCents: number
  payableCents: number
  peerCutCents: number
  teamCutCents: number
  shortfallCents: number
}

export interface MnStatement {
  month: string
  lines: MnLine[]
  balances: Map<string, MnBalance>
  personalMuCents: Map<string, number>
  meterMuCents: Map<string, number>
  teamMuCents: Map<string, number>
  retailBasisMuCents: Map<string, number>
  retailRateBp: Map<string, number>
  gate: MnGateSummary
}

interface Draft {
  personId: string
  kind: MnLineKind
  orderId: string | null
  productId: string | null
  micros: bigint
  note: string
}

type Index = ReturnType<typeof indexParents<MnPerson>>

function assertOrders(orders: readonly MnOrder[], policy: IdentityPolicy): void {
  if (policy.retailCanFall) throw new MnConfigError('retail step-down rule is not decided')
  if (policy.annualRecognition === 'unset' && orders.some((order) => order.annual)) {
    throw new MnConfigError('annual recognition is not decided')
  }
  for (const order of orders) {
    if (!Number.isInteger(order.muCents) || order.muCents <= 0) throw new MnConfigError(`order ${order.id} has no positive MU`)
  }
}

function meterIds(orders: readonly MnOrder[], policy: IdentityPolicy): Set<string> {
  const cap = policy.selfPurchaseCapUnitsPerMonth
  if (cap === null) return new Set(orders.map((order) => order.id))
  const kept = new Set(orders.filter((order) => !order.selfPurchase).map((order) => order.id))
  const used = new Map<string, number>()
  const self = orders.filter((order) => order.selfPurchase).slice().sort((a, b) => a.id.localeCompare(b.id))
  for (const order of self) {
    const count = used.get(order.sellerId) ?? 0
    if (count >= cap) continue
    kept.add(order.id)
    used.set(order.sellerId, count + 1)
  }
  return kept
}

function sumBySeller(orders: readonly MnOrder[], ids: ReadonlySet<string>): Map<string, bigint> {
  const totals = new Map<string, bigint>()
  for (const order of orders) {
    if (!ids.has(order.id)) continue
    totals.set(order.sellerId, (totals.get(order.sellerId) ?? 0n) + centsToMicros(order.muCents))
  }
  return totals
}

function basisOf(people: readonly MnPerson[], metered: ReadonlyMap<string, bigint>): Map<string, bigint> {
  const basis = new Map<string, bigint>()
  for (const person of people) {
    const current = metered.get(person.id) ?? 0n
    const prior = centsToMicros(person.priorBestMuCents ?? 0)
    basis.set(person.id, current > prior ? current : prior)
  }
  return basis
}

function peerIdentity(person: MnPerson, policy: IdentityPolicy, month: string): MnIdentity | null {
  if (policy.peerStartsNextMonth && person.identitySinceMonth === month) return person.previousIdentity ?? null
  return person.identity
}

function retailDrafts(orders: readonly MnOrder[], basis: ReadonlyMap<string, bigint>): Draft[] {
  return orders.flatMap((order) => {
    const micros = retailMicros(centsToMicros(order.muCents), basis.get(order.sellerId) ?? 0n)
    if (micros === 0n) return []
    return [{ personId: order.sellerId, kind: 'retail' as const, orderId: order.id, productId: order.productId, micros, note: 'retail' }]
  })
}

function levelDrafts(orders: readonly MnOrder[], index: Index): Draft[] {
  const points = [MN_TEMPLATE_V12.level1Points, MN_TEMPLATE_V12.level2Points]
  const lines: Draft[] = []
  for (const order of orders) {
    const chain = ancestorsOf(index.byId, order.sellerId)
    const pool = centsToMicros(order.muCents)
    points.forEach((point, level) => {
      const personId = chain[level]
      if (!personId) return
      const micros = roundDiv(pool * BigInt(point), BigInt(MN_TEMPLATE_V12.anchorPoints))
      if (micros === 0n) return
      lines.push({
        personId, kind: level === 0 ? 'l1' : 'l2', orderId: order.id, productId: order.productId, micros,
        note: level === 0 ? 'level 1' : 'level 2',
      })
    })
  }
  return lines
}

function teamTotals(index: Index, personal: ReadonlyMap<string, bigint>): Map<string, bigint> {
  const team = new Map<string, bigint>()
  const visit = (id: string): bigint => {
    let total = personal.get(id) ?? 0n
    for (const child of index.children.get(id) ?? []) total += visit(child)
    team.set(id, total)
    return total
  }
  for (const root of index.roots) visit(root)
  return team
}

function differential(index: Index, team: ReadonlyMap<string, bigint>, grossOf: (micros: bigint) => bigint): Map<string, bigint> {
  const gross = new Map<string, bigint>()
  for (const [id, total] of team) gross.set(id, grossOf(total))
  const net = new Map<string, bigint>()
  for (const [id, amount] of gross) {
    const children = (index.children.get(id) ?? []).reduce((sum, child) => sum + (gross.get(child) ?? 0n), 0n)
    if (amount - children > 0n) net.set(id, amount - children)
  }
  return net
}

function teamDrafts(nets: ReadonlyMap<string, bigint>): Draft[] {
  return [...nets].map(([personId, micros]) => ({
    personId, kind: 'team' as const, orderId: null, productId: null, micros, note: 'team differential',
  }))
}

function peerDrafts(index: Index, nets: ReadonlyMap<string, bigint>, policy: IdentityPolicy, month: string): Draft[] {
  const rates = [MN_TEMPLATE_V12.peerGen1Bp, MN_TEMPLATE_V12.peerGen2Bp]
  const lines: Draft[] = []
  for (const [id, net] of nets) {
    const mine = peerIdentity(index.byId.get(id) as MnPerson, policy, month)
    if (!mine) continue
    const same = ancestorsOf(index.byId, id).filter((ancestor) => peerIdentity(index.byId.get(ancestor) as MnPerson, policy, month) === mine)
    same.slice(0, MN_TEMPLATE_V12.peerGenerations).forEach((personId, generation) => {
      const micros = roundDiv(net * BigInt(rates[generation] ?? 0), 10_000n)
      if (micros === 0n) return
      lines.push({ personId, kind: 'peer', orderId: null, productId: null, micros, note: `peer gen ${generation + 1} from ${id}` })
    })
  }
  return lines
}

function adjustmentDrafts(adjustments: readonly MnAdjustment[]): Draft[] {
  return adjustments.map((item) => {
    if (!Number.isInteger(item.muCents) || item.muCents === 0) throw new MnConfigError('adjustment must be non-zero integer cents')
    return { personId: item.personId, kind: 'adjustment' as const, orderId: null, productId: null, micros: centsToMicros(item.muCents), note: item.note }
  })
}

function sumKind(lines: readonly Draft[], kinds: readonly MnLineKind[]): bigint {
  return lines.filter((line) => kinds.includes(line.kind)).reduce((sum, line) => sum + line.micros, 0n)
}

function scale(lines: readonly Draft[], target: bigint): Draft[] {
  const parts = allocateBig(target > 0n ? target : 0n, lines.map((line) => (line.micros > 0n ? line.micros : 0n)))
  return lines.flatMap((line, index) => {
    const micros = parts[index] ?? 0n
    return micros === 0n ? [] : [{ ...line, micros }]
  })
}

function cutTeam(lines: readonly Draft[], marginal: ReadonlyMap<string, bigint>, cut: bigint): Draft[] {
  const teamLines = lines.filter((line) => line.kind === 'team')
  const cuts = allocateBig(cut > 0n ? cut : 0n, teamLines.map((line) => marginal.get(line.personId) ?? 0n))
  const cutByPerson = new Map(teamLines.map((line, index) => [line.personId, cuts[index] ?? 0n]))
  return lines.flatMap((line) => {
    if (line.kind !== 'team') return [line]
    const room = line.micros > 0n ? line.micros : 0n
    const wanted = cutByPerson.get(line.personId) ?? 0n
    const next = room - (wanted < room ? wanted : room)
    return next > 0n ? [{ ...line, micros: next }] : []
  })
}

function gateDrafts(lines: Draft[], pool: bigint, marginal: ReadonlyMap<string, bigint>) {
  const reserved = sumKind(lines, ['retail', 'l1', 'l2', 'team'])
  const peer = sumKind(lines, ['peer'])
  const adjustment = sumKind(lines, ['adjustment'])
  const marginalTotal = [...marginal.values()].reduce((sum, value) => sum + (value > 0n ? value : 0n), 0n)
  const cut = applyGate({ poolMicros: pool, reservedMicros: reserved, peerMicros: peer, adjustmentMicros: adjustment, marginal18Micros: marginalTotal })
  let next = lines.filter((line) => line.kind !== 'peer').concat(scale(lines.filter((line) => line.kind === 'peer'), cut.peerMicros))
  const beforeTeam = sumKind(next, ['team'])
  next = cutTeam(next, marginal, cut.teamCutMicros)
  const actualTeamCut = beforeTeam - sumKind(next, ['team'])
  const shortfall = cut.shortfallMicros + (cut.teamCutMicros > actualTeamCut ? cut.teamCutMicros - actualTeamCut : 0n)
  const payable = sumKind(next, ['retail', 'l1', 'l2', 'team', 'peer', 'adjustment'])
  return {
    drafts: next,
    summary: {
      poolCents: microsToCents(pool),
      payableCents: microsToCents(payable),
      peerCutCents: microsToCents(peer - cut.peerMicros),
      teamCutCents: microsToCents(actualTeamCut),
      shortfallCents: microsToCents(shortfall),
    },
  }
}

function toCents(lines: readonly Draft[], people: readonly MnPerson[]): MnLine[] {
  const suspended = new Set(people.filter((person) => person.suspended).map((person) => person.id))
  const grouped = new Map<string, Draft[]>()
  for (const line of lines) {
    const key = `${line.personId}:${line.kind}`
    grouped.set(key, [...(grouped.get(key) ?? []), line])
  }
  const out: MnLine[] = []
  for (const drafts of grouped.values()) {
    const personId = drafts[0].personId
    const exact = microsToCents(drafts.reduce((sum, line) => sum + line.micros, 0n))
    const payable = exact < 0 || !suspended.has(personId)
    if (exact < 0) {
      const first = drafts[0]
      out.push({
        personId, kind: first.kind, orderId: first.orderId, productId: first.productId,
        muCents: exact, payable, note: first.note,
      })
      continue
    }
    const parts = allocateBig(BigInt(exact), drafts.map((line) => (line.micros > 0n ? line.micros : 0n)))
    drafts.forEach((line, index) => {
      const muCents = Number(parts[index] ?? 0n)
      if (muCents === 0) return
      out.push({ personId, kind: line.kind, orderId: line.orderId, productId: line.productId, muCents, payable, note: line.note })
    })
  }
  return out
}

export function closePayout(openingCents: number, periodCents: number, minimumCents: number): Pick<MnBalance, 'payoutCents' | 'carryCents'> {
  const total = openingCents + periodCents
  if (total < minimumCents) return { payoutCents: 0, carryCents: total }
  return { payoutCents: total, carryCents: 0 }
}

function balances(people: readonly MnPerson[], lines: readonly MnLine[], opening: ReadonlyMap<string, number>, minimum: number) {
  const period = new Map<string, number>()
  for (const line of lines) {
    if (!line.payable) continue
    period.set(line.personId, (period.get(line.personId) ?? 0) + line.muCents)
  }
  const out = new Map<string, MnBalance>()
  for (const person of people) {
    const openingCents = opening.get(person.id) ?? 0
    const periodCents = period.get(person.id) ?? 0
    out.set(person.id, { openingCents, periodCents, ...closePayout(openingCents, periodCents, minimum) })
  }
  return out
}

function centMap(values: ReadonlyMap<string, bigint>): Map<string, number> {
  return new Map([...values].map(([id, micros]) => [id, microsToCents(micros)]))
}

export function settleMonth(input: {
  month: string
  people: readonly MnPerson[]
  orders: readonly MnOrder[]
  policy: IdentityPolicy
  openingCarryCents?: ReadonlyMap<string, number>
  adjustments?: readonly MnAdjustment[]
}): MnStatement {
  assertOrders(input.orders, input.policy)
  const index = indexParents(input.people)
  const meter = meterIds(input.orders, input.policy)
  const metered = sumBySeller(input.orders, meter)
  const personal = sumBySeller(input.orders, new Set(input.orders.map((order) => order.id)))
  const basis = basisOf(input.people, metered)
  const team = teamTotals(index, metered)
  const teamNet = differential(index, team, teamGrossMicros)
  const marginal = differential(index, team, marginal18Micros)
  const pool = input.orders.reduce((sum, order) => sum + centsToMicros(order.muCents), 0n)
  const gated = gateDrafts([
    ...retailDrafts(input.orders, basis),
    ...levelDrafts(input.orders, index),
    ...teamDrafts(teamNet),
    ...peerDrafts(index, teamNet, input.policy, input.month),
    ...adjustmentDrafts(input.adjustments ?? []),
  ], pool, marginal)
  const lines = toCents(gated.drafts, input.people)
  return {
    month: input.month,
    lines,
    balances: balances(input.people, lines, input.openingCarryCents ?? new Map(), input.policy.minPayoutMuCents),
    personalMuCents: centMap(personal),
    meterMuCents: centMap(metered),
    teamMuCents: centMap(team),
    retailBasisMuCents: centMap(basis),
    retailRateBp: new Map([...basis].map(([id, micros]) => [id, retailRateBp(micros)])),
    gate: gated.summary,
  }
}
