import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import {
  computeReturnLadder, ladderWindow, monthMaturity,
  LADDER_MIN_DEALS_FOR_VERDICT,
  type LadderInput, type LadderOutcomeRow, type LadderSpendRow, type LadderContactFact,
} from '../compute'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function base(overrides: Partial<LadderInput> = {}): LadderInput {
  return {
    asOfDate: '2026-10-09',
    timezone: 'Pacific/Auckland',
    timezoneCount: 1,
    spendRows: [],
    accounts: [{ adAccountId: 'acct_a', currency: 'NZD' }],
    outcomes: [],
    contacts: [],
    salesCycleDays: null,
    primaryResult: null,
    configSource: 'row',
    spendIncomplete: false,
    ...overrides,
  }
}

function spend(
  date: string,
  amount: number,
  extra: Partial<LadderSpendRow> = {},
): LadderSpendRow {
  return {
    adAccountId: 'acct_a',
    platform: 'p1',
    insightDate: date,
    spend: amount,
    leads: null,
    messagingConversations: null,
    ...extra,
  }
}

function lead(
  id: string,
  contactId: string | null,
  occurredAt: string,
  status: LadderOutcomeRow['reviewStatus'] = 'approved',
): LadderOutcomeRow {
  return {
    id,
    contactId,
    kind: 'lead',
    amountMinor: null,
    currency: null,
    occurredAt,
    reviewStatus: status,
  }
}

function purchase(
  id: string,
  contactId: string | null,
  occurredAt: string,
  amountMinor: number,
  currency: string | null = 'NZD',
): LadderOutcomeRow {
  return {
    id,
    contactId,
    kind: 'purchase',
    amountMinor,
    currency,
    occurredAt,
    reviewStatus: 'approved',
  }
}

function balance(
  id: string,
  contactId: string | null,
  occurredAt: string,
  amountMinor: number,
  currency: string | null = 'NZD',
): LadderOutcomeRow {
  return {
    id,
    contactId,
    kind: 'balance',
    amountMinor,
    currency,
    occurredAt,
    reviewStatus: 'approved',
  }
}

function contact(
  id: string,
  firstSeenAt: string | null,
  attrPlatform: string | null,
): LadderContactFact {
  return { id, firstSeenAt, attrPlatform }
}

// ---------------------------------------------------------------------------
// ladderWindow / monthMaturity
// ---------------------------------------------------------------------------

describe('ladderWindow', () => {
  it('returns the as-of month plus the two preceding months', () => {
    expect(ladderWindow('2026-10-09')).toEqual({
      from: '2026-08-01',
      to: '2026-10-09',
      months: ['2026-08', '2026-09', '2026-10'],
    })
  })

  it('wraps across a year boundary', () => {
    expect(ladderWindow('2026-01-15')).toEqual({
      from: '2025-11-01',
      to: '2026-01-15',
      months: ['2025-11', '2025-12', '2026-01'],
    })
  })
})

describe('monthMaturity', () => {
  it('is not_configured when the sales cycle is null', () => {
    expect(monthMaturity('2026-08', '2026-10-09', null)).toBe('not_configured')
  })

  it('is mature when the month end plus cycle is on or before asOf', () => {
    expect(monthMaturity('2026-08', '2026-10-09', 30)).toBe('mature')
  })

  it('is immature when the month end plus cycle is after asOf', () => {
    expect(monthMaturity('2026-09', '2026-10-09', 30)).toBe('immature')
  })

  it('treats the exact boundary day as mature', () => {
    expect(monthMaturity('2026-08', '2026-10-09', 39)).toBe('mature')
    expect(monthMaturity('2026-08', '2026-10-09', 40)).toBe('immature')
  })
})

// ---------------------------------------------------------------------------
// Empty / spend-only
// ---------------------------------------------------------------------------

describe('empty input', () => {
  it('reaches level 0 with missing spend and results', () => {
    const out = computeReturnLadder(base())
    expect(out.reachedLevel).toBe(0)
    expect(out.spend.status).toBe('missing')
    expect(out.results.status).toBe('missing')
    expect(out.results.leads).toBeNull()
    expect(out.results.conversations).toBeNull()
  })
})

describe('spend only', () => {
  it('reaches level 2 and never sums leads with conversations', () => {
    const out = computeReturnLadder(base({
      spendRows: [
        spend('2026-08-05', 100, { leads: 2, messagingConversations: 3 }),
        spend('2026-08-06', 200, { leads: 1, messagingConversations: 1 }),
      ],
    }))
    expect(out.reachedLevel).toBe(2)
    expect(out.results.leads).toBe(3)
    expect(out.results.conversations).toBe(4)
    expect(out.results.leads).not.toBe(7)
    expect(out.results.conversations).not.toBe(7)
  })
})

// ---------------------------------------------------------------------------
// Spend level
// ---------------------------------------------------------------------------

describe('spend by currency', () => {
  it('keeps currencies separate and sorts unknown currency last', () => {
    const out = computeReturnLadder(base({
      accounts: [
        { adAccountId: 'acct_a', currency: 'NZD' },
        { adAccountId: 'acct_b', currency: 'AUD' },
      ],
      spendRows: [
        spend('2026-08-05', 100, { adAccountId: 'acct_a' }),
        spend('2026-08-05', 200, { adAccountId: 'acct_b' }),
        spend('2026-08-06', 50, { adAccountId: 'acct_c' }),
      ],
    }))
    expect(out.spend.byCurrency).toEqual([
      { currency: 'AUD', amount: 200 },
      { currency: 'NZD', amount: 100 },
      { currency: null, amount: 50 },
    ])
  })
})

describe('spend window', () => {
  it('ignores spend rows outside the window', () => {
    const out = computeReturnLadder(base({
      spendRows: [
        spend('2026-07-31', 999),
        spend('2026-08-05', 100),
      ],
    }))
    expect(out.spend.byCurrency).toEqual([{ currency: 'NZD', amount: 100 }])
  })
})

describe('spend incomplete', () => {
  it('marks spend cannot_judge and blocks the return', () => {
    const out = computeReturnLadder(base({
      spendIncomplete: true,
      spendRows: [spend('2026-08-05', 100)],
    }))
    expect(out.spend.status).toBe('cannot_judge')
    expect(out.reachedLevel).toBe(0)
    expect(out.notes).toContain('spend_incomplete')
    expect(out.returnOnSpend.blockers).toContain('spend_incomplete')
  })
})

// ---------------------------------------------------------------------------
// Qualified level
// ---------------------------------------------------------------------------

describe('qualified level', () => {
  it('counts approved leads in window and tracks paid / unknown / pending', () => {
    const out = computeReturnLadder(base({
      spendRows: [spend('2026-08-05', 100, { platform: 'p1' })],
      contacts: [
        contact('c1', null, 'p1'),
        contact('c2', null, null),
      ],
      outcomes: [
        lead('l1', 'c1', '2026-08-10T02:00:00Z'),
        lead('l2', 'c2', '2026-08-11T02:00:00Z'),
        lead('l3', 'c1', '2026-08-12T02:00:00Z', 'pending_review'),
      ],
    }))
    expect(out.qualified.count).toBe(2)
    expect(out.qualified.fromPaid).toBe(1)
    expect(out.qualified.unknownSource).toBe(1)
    expect(out.qualified.pendingReview).toBe(1)
    expect(out.reachedLevel).toBe(3)
  })

  it('treats paid source as relative to this client spend', () => {
    const out = computeReturnLadder(base({
      spendRows: [spend('2026-08-05', 100, { platform: 'p1' })],
      contacts: [contact('c1', null, 'p2')],
      outcomes: [lead('l1', 'c1', '2026-08-10T02:00:00Z')],
    }))
    expect(out.qualified.count).toBe(1)
    expect(out.qualified.fromPaid).toBe(0)
  })

  it('never counts a rejected lead', () => {
    const out = computeReturnLadder(base({
      spendRows: [spend('2026-08-05', 100, { platform: 'p1' })],
      contacts: [contact('c1', null, 'p1')],
      outcomes: [lead('l1', 'c1', '2026-08-10T02:00:00Z', 'rejected')],
    }))
    expect(out.qualified.count).toBe(0)
    expect(out.qualified.pendingReview).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Timezone day boundary
// ---------------------------------------------------------------------------

describe('timezone day boundary', () => {
  it('uses the account timezone, not UTC', () => {
    const outcomes = [lead('l1', 'c1', '2026-07-31T13:30:00Z')]
    const contacts = [contact('c1', null, 'p1')]
    const spendRows = [spend('2026-08-05', 100, { platform: 'p1' })]

    const auckland = computeReturnLadder(base({ spendRows, outcomes, contacts }))
    expect(auckland.qualified.count).toBe(1)

    const utc = computeReturnLadder(base({
      spendRows, outcomes, contacts, timezone: 'UTC',
    }))
    expect(utc.qualified.count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Deals level
// ---------------------------------------------------------------------------

describe('deal month placement', () => {
  it('books a deal to the month the lead came in, not the month money arrived', () => {
    const out = computeReturnLadder(base({
      spendRows: [spend('2026-08-05', 100, { platform: 'p1' })],
      contacts: [contact('c1', null, 'p1')],
      outcomes: [
        lead('l1', 'c1', '2026-08-10T02:00:00Z'),
        purchase('p1', 'c1', '2026-10-02T02:00:00Z', 100000),
      ],
    }))
    expect(out.months[0]?.month).toBe('2026-08')
    expect(out.months[0]?.deals).toBe(1)
    expect(out.months[2]?.month).toBe('2026-10')
    expect(out.months[2]?.deals).toBe(0)
  })
})

describe('unplaced deal', () => {
  it('counts a purchase with no contact but places it in no month', () => {
    const out = computeReturnLadder(base({
      spendRows: [spend('2026-08-05', 100, { platform: 'p1' })],
      outcomes: [purchase('p1', null, '2026-08-15T02:00:00Z', 100000)],
    }))
    expect(out.deals.count).toBe(1)
    expect(out.deals.unplacedMonth).toBe(1)
    for (const m of out.months) expect(m.deals).toBe(0)
    expect(out.revenue.status).toBe('has')
  })
})

describe('lead-in before window', () => {
  it('excludes a deal whose only lead-in evidence predates the window', () => {
    const out = computeReturnLadder(base({
      spendRows: [spend('2026-08-05', 100, { platform: 'p1' })],
      contacts: [contact('c1', '2026-05-01T02:00:00Z', 'p1')],
      outcomes: [purchase('p1', 'c1', '2026-08-15T02:00:00Z', 100000)],
    }))
    expect(out.deals.count).toBe(0)
    expect(out.deals.leadInBeforeWindow).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Revenue level
// ---------------------------------------------------------------------------

describe('revenue level', () => {
  it('separates first payment from with-balance and ignores other contacts', () => {
    const out = computeReturnLadder(base({
      spendRows: [spend('2026-08-05', 100, { platform: 'p1' })],
      contacts: [
        contact('c1', null, 'p1'),
        contact('c2', null, 'p1'),
      ],
      outcomes: [
        lead('l1', 'c1', '2026-08-10T02:00:00Z'),
        purchase('p1', 'c1', '2026-08-15T02:00:00Z', 50000),
        balance('b1', 'c1', '2026-08-20T02:00:00Z', 150000),
        balance('b2', 'c2', '2026-08-20T02:00:00Z', 999999),
      ],
    }))
    expect(out.revenue.firstPayment).toEqual([{ currency: 'NZD', amountMinor: 50000 }])
    expect(out.revenue.withBalance).toEqual([{ currency: 'NZD', amountMinor: 200000 }])
  })
})

// ---------------------------------------------------------------------------
// Return level
// ---------------------------------------------------------------------------

/** Full data set: spend + N placed deals with paid contacts. */
function fullData(dealCount: number, overrides: Partial<LadderInput> = {}): LadderInput {
  const contacts: LadderContactFact[] = []
  const outcomes: LadderOutcomeRow[] = []
  for (let i = 0; i < dealCount; i++) {
    const cid = `c${i + 1}`
    contacts.push(contact(cid, null, 'p1'))
    outcomes.push(lead(`l${i + 1}`, cid, '2026-08-10T02:00:00Z'))
    outcomes.push(purchase(`p${i + 1}`, cid, '2026-08-15T02:00:00Z', 100000))
  }
  return base({
    spendRows: [spend('2026-08-05', 1000, { platform: 'p1' })],
    contacts,
    outcomes,
    ...overrides,
  })
}

describe('return blocked by missing cycle', () => {
  it('cannot judge and reaches level 5', () => {
    const out = computeReturnLadder(fullData(LADDER_MIN_DEALS_FOR_VERDICT))
    expect(out.returnOnSpend.status).toBe('cannot_judge')
    expect(out.returnOnSpend.blockers).toContain('cycle_not_configured')
    expect(out.returnOnSpend.firstPaymentBasis).toBeNull()
    expect(out.returnOnSpend.withBalanceBasis).toBeNull()
    expect(out.returnOnSpend.withBalanceBasisWithoutLargest).toBeNull()
    expect(out.reachedLevel).toBe(5)
  })
})

/** The scenario from test 17: 5 deals, one balance, spend split across months. */
function returnScenario(overrides: Partial<LadderInput> = {}): LadderInput {
  const contacts: LadderContactFact[] = []
  const outcomes: LadderOutcomeRow[] = []
  const amounts = [100000, 100000, 100000, 100000, 600000]
  for (let i = 0; i < amounts.length; i++) {
    const cid = `c${i + 1}`
    contacts.push(contact(cid, null, 'p1'))
    outcomes.push(lead(`l${i + 1}`, cid, '2026-08-10T02:00:00Z'))
    outcomes.push(purchase(`p${i + 1}`, cid, '2026-08-15T02:00:00Z', amounts[i] ?? 0))
  }
  outcomes.push(balance('b1', 'c1', '2026-08-20T02:00:00Z', 200000))
  return base({
    salesCycleDays: 30,
    spendRows: [
      spend('2026-08-05', 1000, { platform: 'p1' }),
      spend('2026-09-05', 500, { platform: 'p1' }),
    ],
    contacts,
    outcomes,
    ...overrides,
  })
}

describe('return computed', () => {
  it('computes the three ratios over mature months only', () => {
    const out = computeReturnLadder(returnScenario())
    expect(out.returnOnSpend.status).toBe('has')
    expect(out.reachedLevel).toBe(6)
    expect(out.returnOnSpend.matureMonths).toEqual(['2026-08'])
    expect(out.returnOnSpend.immatureMonths).toEqual(['2026-09', '2026-10'])
    expect(out.returnOnSpend.dealCount).toBe(5)
    expect(out.returnOnSpend.firstPaymentBasis).toBe(10)
    expect(out.returnOnSpend.withBalanceBasis).toBe(12)
    expect(out.returnOnSpend.withBalanceBasisWithoutLargest).toBe(6)
  })
})

describe('too few deals', () => {
  it('blocks the return', () => {
    const out = computeReturnLadder(returnScenario({
      contacts: [
        contact('c1', null, 'p1'),
        contact('c2', null, 'p1'),
      ],
      outcomes: [
        lead('l1', 'c1', '2026-08-10T02:00:00Z'),
        purchase('p1', 'c1', '2026-08-15T02:00:00Z', 100000),
        lead('l2', 'c2', '2026-08-10T02:00:00Z'),
        purchase('p2', 'c2', '2026-08-15T02:00:00Z', 100000),
      ],
    }))
    expect(out.returnOnSpend.blockers).toContain('too_few_deals')
    expect(out.returnOnSpend.status).toBe('cannot_judge')
  })
})

describe('unknown source share too high', () => {
  it('blocks the return', () => {
    const contacts: LadderContactFact[] = []
    const outcomes: LadderOutcomeRow[] = []
    const amounts = [100000, 100000, 100000, 100000, 600000]
    for (let i = 0; i < amounts.length; i++) {
      const cid = `c${i + 1}`
      contacts.push(contact(cid, null, null))
      outcomes.push(lead(`l${i + 1}`, cid, '2026-08-10T02:00:00Z'))
      outcomes.push(purchase(`p${i + 1}`, cid, '2026-08-15T02:00:00Z', amounts[i] ?? 0))
    }
    const out = computeReturnLadder(returnScenario({ contacts, outcomes }))
    expect(out.returnOnSpend.blockers).toContain('unknown_source_share_too_high')
  })
})

describe('currency blockers', () => {
  it('flags a currency mismatch', () => {
    const contacts: LadderContactFact[] = []
    const outcomes: LadderOutcomeRow[] = []
    const amounts = [100000, 100000, 100000, 100000, 600000]
    for (let i = 0; i < amounts.length; i++) {
      const cid = `c${i + 1}`
      contacts.push(contact(cid, null, 'p1'))
      outcomes.push(lead(`l${i + 1}`, cid, '2026-08-10T02:00:00Z'))
      outcomes.push(purchase(`p${i + 1}`, cid, '2026-08-15T02:00:00Z', amounts[i] ?? 0, 'AUD'))
    }
    const out = computeReturnLadder(returnScenario({ contacts, outcomes }))
    expect(out.returnOnSpend.blockers).toContain('currency_mismatch')
  })

  it('flags an unknown account currency', () => {
    const out = computeReturnLadder(returnScenario({ accounts: [] }))
    expect(out.returnOnSpend.blockers).toContain('currency_unknown')
  })
})

describe('no mature month', () => {
  it('blocks with no_mature_month and not too_few_deals', () => {
    const out = computeReturnLadder(returnScenario({ salesCycleDays: 200 }))
    expect(out.returnOnSpend.blockers).toContain('no_mature_month')
    expect(out.returnOnSpend.blockers).not.toContain('too_few_deals')
  })
})

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

describe('notes', () => {
  it('flags an unreadable config and drops the primary result', () => {
    const out = computeReturnLadder(base({
      configSource: 'fallback',
      primaryResult: 'lead',
      spendRows: [spend('2026-08-05', 100)],
    }))
    expect(out.notes).toContain('config_unreadable')
    expect(out.results.primary).toBeNull()
  })

  it('flags an unknown timezone', () => {
    const out = computeReturnLadder(base({ timezone: null }))
    expect(out.notes).toContain('timezone_unknown')
  })

  it('flags multiple timezones', () => {
    const out = computeReturnLadder(base({ timezoneCount: 2 }))
    expect(out.notes).toContain('multiple_timezones')
  })
})
