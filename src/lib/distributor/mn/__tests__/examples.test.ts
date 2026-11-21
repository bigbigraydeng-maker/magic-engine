import { describe, expect, it } from 'vitest'
import {
  buildCard,
  cardError,
  EXAMPLE_FX_NZD_060,
  localCentsFromMu,
  muCentsFromUsd,
  PROPOSED_IDENTITY_POLICY,
  settleMonth,
  usdCents,
  type MnOrder,
  type MnPerson,
} from '../index'

const LAB = 28_764
const WRITING = 2_020
const MEETING = 617
const POLICY = PROPOSED_IDENTITY_POLICY

function person(id: string, parentId: string | null, identity: MnPerson['identity'] = 'Link'): MnPerson {
  return { id, parentId, identity }
}

function copies(sellerId: string, count: number, muCents: number, productId: string): MnOrder[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${sellerId}-${productId}-${index}`, sellerId, productId, muCents,
  }))
}

function kind(statement: ReturnType<typeof settleMonth>, id: string, lineKind: string): number {
  return statement.lines.filter((line) => line.personId === id && line.kind === lineKind).reduce((sum, line) => sum + line.muCents, 0)
}

describe('price to MU at the example rate', () => {
  it('converts the plan cards and refuses a cap above the total commission', () => {
    const fx = EXAMPLE_FX_NZD_060.usdPerUnitMicros
    expect(muCentsFromUsd(usdCents(79_900, fx), 6000)).toBe(LAB)
    expect(muCentsFromUsd(usdCents(9_900, fx), 3400)).toBe(WRITING)
    expect(muCentsFromUsd(usdCents(4_900, fx), 2100)).toBe(MEETING)
    expect(cardError(4000, 3400)).toBeNull()
    expect(cardError(2500, 3400)).toMatch(/distributor cap/)
    expect(buildCard({ productId: 'writing', name: '写作示例', currency: 'NZD', totalCommissionBp: 4000, distributorCapBp: 3400 }).distributorCapBp).toBe(3400)
  })
})

describe('v1.2 worked examples', () => {
  it('matches the 1 to 26 Magic Lab customer table', () => {
    const expected = [
      { count: 1, rate: 2580, retail: 12_368, team: 0 },
      { count: 3, rate: 2740, retail: 39_402, team: 0 },
      { count: 5, rate: 2900, retail: 69_501, team: 0 },
      { count: 8, rate: 3046, retail: 116_836, team: 0 },
      { count: 16, rate: 3259, retail: 250_014, team: 5_011 },
      { count: 26, rate: 3500, retail: 436_254, team: 19_393 },
    ]
    for (const row of expected) {
      const statement = settleMonth({
        month: '2026-11', people: [person('a', null)], orders: copies('a', row.count, LAB, 'magic-lab'), policy: POLICY,
      })
      expect(statement.retailRateBp.get('a')).toBe(row.rate)
      expect(kind(statement, 'a', 'retail')).toBe(row.retail)
      expect(kind(statement, 'a', 'team')).toBe(row.team)
      expect(statement.personalMuCents.get('a')).toBe(row.count * LAB)
    }
    expect(localCentsFromMu(12_368, EXAMPLE_FX_NZD_060.usdPerUnitMicros)).toBe(20_613)
  })

  it('matches the team lookup and the three equal lines', () => {
    const lookup = [
      { mu: 360_000, gross: 0 },
      { mu: 1_080_000, gross: 36_000 },
      { mu: 1_799_964, gross: 131_995 },
      { mu: 1_800_000, gross: 132_000 },
      { mu: 3_600_000, gross: 372_000 },
      { mu: 5_400_000, gross: 792_000 },
      { mu: 10_800_000, gross: 2_052_000 },
      { mu: 18_000_000, gross: 3_732_000 },
      { mu: 36_000_000, gross: 9_132_000 },
    ]
    for (const row of lookup) {
      const statement = settleMonth({
        month: '2026-11', people: [person('a', null)], orders: [{ id: 'one', sellerId: 'a', productId: 'magic-lab', muCents: row.mu }], policy: POLICY,
      })
      expect(kind(statement, 'a', 'team')).toBe(row.gross)
    }

    const lines = [1_440_000, 2_160_000]
    const leader = [288_000, 504_000]
    const partner = [84_000, 180_000]
    lines.forEach((mu, index) => {
      const people = [person('a', null), person('b', 'a'), person('c', 'a'), person('d', 'a')]
      const orders = ['b', 'c', 'd'].map((id) => ({ id, sellerId: id, productId: 'magic-lab', muCents: mu }))
      const statement = settleMonth({ month: '2026-11', people, orders, policy: POLICY })
      expect(kind(statement, 'a', 'team')).toBe(leader[index])
      expect(kind(statement, 'b', 'team')).toBe(partner[index])
    })
  })

  it('matches the mixed-product seller, and pays two levels without rolling them up', () => {
    const wang = [
      ...copies('wang', 8, LAB, 'magic-lab'),
      ...copies('wang', 20, WRITING, 'writing'),
      ...copies('wang', 40, MEETING, 'meeting'),
    ]
    const statement = settleMonth({
      month: '2026-11',
      people: [person('wang', null), person('li', 'wang'), person('zhang', 'li')],
      orders: [
        ...wang,
        ...copies('li', 2, LAB, 'magic-lab'),
        ...copies('li', 5, WRITING, 'writing'),
        ...copies('zhang', 3, MEETING, 'meeting'),
      ],
      policy: POLICY,
    })
    expect(statement.personalMuCents.get('wang')).toBe(295_192)
    expect(statement.retailRateBp.get('wang')).toBe(3107)
    // Plan retail 152,848 used unrounded USD×cap. Stored per-order MU (404.00 / 246.80) yields 152,843.
    // The prose says Wang has no team bonus. His downline pushes team MU to 3,646.71, so the formula pays 2.34.
    expect(kind(statement, 'wang', 'retail')).toBe(152_843)
    expect(kind(statement, 'wang', 'l1')).toBe(5_636)
    expect(kind(statement, 'wang', 'l2')).toBe(62)
    expect(kind(statement, 'wang', 'team')).toBe(234)
    expect(statement.lines.some((line) => line.kind === 'l1' && line.personId === 'zhang')).toBe(false)
  })

  it('matches the mixed team and keeps the one-cent gap in the published level-1 figure', () => {
    const people = [person('a', null), person('b', 'a'), person('c', 'a'), person('d', 'a')]
    const orders = [
      ...copies('a', 5, LAB, 'magic-lab'),
      ...copies('b', 20, LAB, 'magic-lab'),
      ...copies('c', 200, WRITING, 'writing'),
      ...copies('d', 400, MEETING, 'meeting'),
    ]
    const statement = settleMonth({ month: '2026-11', people, orders, policy: POLICY })
    expect(statement.teamMuCents.get('a')).toBe(1_369_900)
    expect(kind(statement, 'b', 'team')).toBe(10_764)
    expect(kind(statement, 'c', 'team')).toBe(2_200)
    expect(kind(statement, 'd', 'team')).toBe(0)
    expect(kind(statement, 'a', 'team')).toBe(61_689)
    expect(kind(statement, 'a', 'retail')).toBe(69_501)
    // The plan adds level 1 as 102,180. 5/60 of the same MU is 102,173.
    expect(kind(statement, 'a', 'l1')).toBe(102_173)
    // A, B and C are all Link, so A also receives peer bonus the prose left out of "本人合计".
    expect(kind(statement, 'a', 'peer')).toBe(1_296)
  })

  it('pays two generations of peer bonus on the same identity, from the remainder', () => {
    const people = [person('a', null, 'Node'), person('b', 'a', 'Node'), person('c', 'b', 'Node')]
    const orders = copies('c', 20, LAB, 'magic-lab')
    const statement = settleMonth({ month: '2026-11', people, orders, policy: POLICY })
    expect(kind(statement, 'c', 'team')).toBe(10_764)
    expect(kind(statement, 'b', 'peer')).toBe(1_076)
    expect(kind(statement, 'a', 'peer')).toBe(538)
    expect(statement.gate.peerCutCents).toBe(0)
    const different = settleMonth({
      month: '2026-11',
      people: [person('a', null, 'Nexus'), person('b', 'a', 'Node'), person('c', 'b', 'Node')],
      orders,
      policy: POLICY,
    })
    expect(kind(different, 'b', 'peer')).toBe(1_076)
    expect(kind(different, 'a', 'peer')).toBe(0)
  })
})

describe('60% gate and payout floor', () => {
  it('cuts peer before the 18% team slice and does not cut retail', () => {
    const people = [person('a', null)]
    const orders = [{ id: 'wide', sellerId: 'a', productId: 'magic-lab', muCents: 36_000_000 }]
    const open = settleMonth({ month: '2026-11', people, orders, policy: POLICY })
    const retail = kind(open, 'a', 'retail')
    const team = kind(open, 'a', 'team')
    const squeezed = settleMonth({
      month: '2026-11', people, orders, policy: POLICY,
      adjustments: [{ personId: 'a', muCents: open.gate.poolCents, note: 'subsidy' }],
    })
    expect(kind(squeezed, 'a', 'retail')).toBe(retail)
    expect(kind(squeezed, 'a', 'team')).toBeLessThan(team)
    expect(squeezed.gate.teamCutCents).toBeGreaterThan(0)
    expect(squeezed.gate.payableCents).toBeLessThanOrEqual(squeezed.gate.poolCents + squeezed.gate.shortfallCents)
  })

  it('holds a payout under 50 MU and carries it', () => {
    const statement = settleMonth({
      month: '2026-11',
      people: [person('a', null)],
      orders: [{ id: 'small', sellerId: 'a', productId: 'meeting', muCents: 617 }],
      policy: POLICY,
    })
    const balance = statement.balances.get('a')
    expect(balance?.periodCents).toBeLessThan(5_000)
    expect(balance?.payoutCents).toBe(0)
    expect(balance?.carryCents).toBe(balance?.periodCents)
  })
})
