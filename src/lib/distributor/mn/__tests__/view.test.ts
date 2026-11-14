import { describe, expect, it } from 'vitest'
import { buildNetworkView, settleMonth, PROPOSED_IDENTITY_POLICY, type MnOrder, type MnPerson } from '../index'

describe('network view', () => {
  it('hides someone else\'s Core identity and builds a product share link', () => {
    const view = buildNetworkView({
      viewerId: 'a',
      people: [
        { id: 'a', parentId: null, displayName: '小王', identity: 'Link', status: 'approved' },
        { id: 'b', parentId: 'a', displayName: '内部', identity: 'Core', status: 'approved' },
      ],
      referralCode: 'ABCD2345',
      origin: 'https://app.magicengine.com.au',
      month: '2026-11',
      pendingMuCents: 100,
      statement: null,
      settlements: [],
      products: [{ productId: 'magic-lab', name: 'Magic Lab AI 数字人管家' }],
      fx: null,
      notices: ['汇率还没锁定'],
      ready: false,
    })
    expect(view.identityLabel).toBe('Link')
    expect(view.tree[0]).toMatchObject({ name: '内部', identityLabel: 'Nexus', teamMuCents: 0 })
    expect(view.shares[0].url).toBe('https://app.magicengine.com.au/mn/p/magic-lab?ref=ABCD2345')
    expect(view.fxLabel).toBeNull()
    expect(view.localPayoutLabel).toBeNull()
  })

  it('shows this month\'s MU, retail step, team tier and earnings from a statement', () => {
    const people: MnPerson[] = [
      { id: 'a', parentId: null, identity: 'Link' },
      { id: 'b', parentId: 'a', identity: 'Link' },
    ]
    const orders: MnOrder[] = [{ id: 's', sellerId: 'a', productId: 'magic-lab', muCents: 28_764 }]
    const statement = settleMonth({ month: '2026-11', people, orders, policy: PROPOSED_IDENTITY_POLICY })
    const view = buildNetworkView({
      viewerId: 'a',
      people: people.map((person, index) => ({
        id: person.id, parentId: person.parentId, displayName: index === 0 ? '小王' : '李四', identity: person.identity, status: 'approved',
      })),
      referralCode: 'ABCD2345',
      origin: 'https://app.magicengine.com.au',
      month: '2026-11',
      pendingMuCents: 500,
      statement,
      settlements: [{ month: '2026-10', status: 'paid', payoutMuCents: 8_000, carryMuCents: 0 }],
      products: [{ productId: 'magic-lab', name: 'Magic Lab' }],
      fx: { currency: 'NZD', usdPerUnitMicros: 600_000, source: 'example-not-a-market-rate' },
      notices: [],
      ready: true,
      orders,
    })
    expect(view.pendingMuCents).toBe(500)
    expect(view.validMuCents).toBe(28_764)
    expect(view.retailRateLabel).toBe('25.80%')
    expect(view.teamTierLabel).toBe('未到档')
    expect(view.earnings.retail).toBe(12_368)
    expect(view.byProduct[0]).toMatchObject({ muCents: 28_764, retail: 12_368 })
    expect(view.tree[0]).toMatchObject({ name: '李四', teamMuCents: 0 })
    expect(view.settlements[0].statusLabel).toBe('已打款')
    expect(view.payoutStatusLabel).toBe('已计入应发，尚未自动打款')
    expect(view.localPayoutLabel).toBe('206.13 NZD')
  })
})
