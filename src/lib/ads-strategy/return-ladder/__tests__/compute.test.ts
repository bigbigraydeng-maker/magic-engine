import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import {
  computeReturnLadder, ladderWindow, monthMaturity,
  LADDER_MIN_DEALS_FOR_VERDICT, LADDER_MAX_UNKNOWN_SOURCE_SHARE,
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
    leads: 0,
    messagingConversations: 0,
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
  status: LadderOutcomeRow['reviewStatus'] = 'approved',
): LadderOutcomeRow {
  return {
    id,
    contactId,
    kind: 'balance',
    amountMinor,
    currency,
    occurredAt,
    reviewStatus: status,
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
    expect(out.qualified.otherSource).toBe(0)
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
    expect(out.qualified.otherSource).toBe(1)
    expect(out.qualified.unknownSource).toBe(0)
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

// ---------------------------------------------------------------------------
// A. Level 6 never appears without levels 1–5
// ---------------------------------------------------------------------------

describe('earlier level missing', () => {
  it('blocks the return when qualified is missing', () => {
    const contacts: LadderContactFact[] = []
    const outcomes: LadderOutcomeRow[] = []
    for (let i = 0; i < LADDER_MIN_DEALS_FOR_VERDICT; i++) {
      const cid = `c${i + 1}`
      contacts.push(contact(cid, '2026-08-05T02:00:00Z', 'p1'))
      outcomes.push(purchase(`p${i + 1}`, cid, '2026-08-15T02:00:00Z', 100000))
    }
    const out = computeReturnLadder(base({
      salesCycleDays: 30,
      spendRows: [spend('2026-08-05', 1000, { platform: 'p1' })],
      contacts,
      outcomes,
    }))
    expect(out.qualified.status).toBe('missing')
    expect(out.reachedLevel).toBe(2)
    expect(out.returnOnSpend.status).toBe('cannot_judge')
    expect(out.returnOnSpend.blockers).toContain('earlier_level_missing')
    expect(out.returnOnSpend.firstPaymentBasis).toBeNull()
    expect(out.returnOnSpend.withBalanceBasis).toBeNull()
    expect(out.returnOnSpend.withBalanceBasisWithoutLargest).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// B. Balance is not double-added
// ---------------------------------------------------------------------------

describe('balance allocation', () => {
  it('attaches a balance to exactly one deal', () => {
    const out = computeReturnLadder(base({
      spendRows: [spend('2026-08-05', 100, { platform: 'p1' })],
      contacts: [contact('c1', null, 'p1')],
      outcomes: [
        lead('l1', 'c1', '2026-08-10T02:00:00Z'),
        purchase('p1', 'c1', '2026-08-12T02:00:00Z', 100000),
        purchase('p2', 'c1', '2026-08-20T02:00:00Z', 100000),
        balance('b1', 'c1', '2026-08-25T02:00:00Z', 500000),
      ],
    }))
    expect(out.revenue.withBalance).toEqual([{ currency: 'NZD', amountMinor: 700000 }])
  })

  // C. Old balance is ignored
  it('ignores a balance earlier than every purchase of the contact', () => {
    const out = computeReturnLadder(base({
      spendRows: [spend('2026-08-05', 100, { platform: 'p1' })],
      contacts: [contact('c1', null, 'p1')],
      outcomes: [
        lead('l1', 'c1', '2026-08-10T02:00:00Z'),
        purchase('p1', 'c1', '2026-08-15T02:00:00Z', 100000),
        balance('b1', 'c1', '2024-03-01T02:00:00Z', 500000),
      ],
    }))
    expect(out.revenue.withBalance).toEqual(out.revenue.firstPayment)
  })

  // D. Pending balance is not counted
  it('ignores a pending balance', () => {
    const out = computeReturnLadder(base({
      spendRows: [spend('2026-08-05', 100, { platform: 'p1' })],
      contacts: [contact('c1', null, 'p1')],
      outcomes: [
        lead('l1', 'c1', '2026-08-10T02:00:00Z'),
        purchase('p1', 'c1', '2026-08-15T02:00:00Z', 100000),
        balance('b1', 'c1', '2026-08-20T02:00:00Z', 500000, 'NZD', 'pending_review'),
      ],
    }))
    expect(out.revenue.withBalance).toEqual([{ currency: 'NZD', amountMinor: 100000 }])
  })
})

// ---------------------------------------------------------------------------
// E. otherSource
// ---------------------------------------------------------------------------

describe('other source', () => {
  it('counts a lead from a non-paid platform as otherSource', () => {
    const out = computeReturnLadder(base({
      spendRows: [spend('2026-08-05', 100, { platform: 'p1' })],
      contacts: [contact('c1', null, 'referral_x')],
      outcomes: [lead('l1', 'c1', '2026-08-10T02:00:00Z')],
    }))
    expect(out.qualified.fromPaid).toBe(0)
    expect(out.qualified.otherSource).toBe(1)
    expect(out.qualified.unknownSource).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// F. Non-paid deals stay out of the return numerator
// ---------------------------------------------------------------------------

describe('non-paid deals excluded from return', () => {
  it('keeps the ratios and dealCount unchanged', () => {
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
    for (let i = 0; i < 2; i++) {
      const cid = `cx${i + 1}`
      contacts.push(contact(cid, null, 'referral_x'))
      outcomes.push(lead(`lx${i + 1}`, cid, '2026-08-10T02:00:00Z'))
      outcomes.push(purchase(`px${i + 1}`, cid, '2026-08-15T02:00:00Z', 5000000))
    }
    const out = computeReturnLadder(base({
      salesCycleDays: 30,
      spendRows: [
        spend('2026-08-05', 1000, { platform: 'p1' }),
        spend('2026-09-05', 500, { platform: 'p1' }),
      ],
      contacts,
      outcomes,
    }))
    expect(out.returnOnSpend.dealCount).toBe(5)
    expect(out.returnOnSpend.firstPaymentBasis).toBe(10)
    expect(out.returnOnSpend.withBalanceBasis).toBe(12)
    expect(out.returnOnSpend.withBalanceBasisWithoutLargest).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// G. Largest deal is picked by amount INCLUDING its balance
// ---------------------------------------------------------------------------

describe('largest deal includes its balance', () => {
  it('subtracts the largest with-balance deal', () => {
    const contacts: LadderContactFact[] = []
    const outcomes: LadderOutcomeRow[] = []
    for (let i = 0; i < 5; i++) {
      const cid = `c${i + 1}`
      contacts.push(contact(cid, null, 'p1'))
      outcomes.push(lead(`l${i + 1}`, cid, '2026-08-10T02:00:00Z'))
      outcomes.push(purchase(`p${i + 1}`, cid, '2026-08-15T02:00:00Z', 100000))
    }
    outcomes.push(balance('b1', 'c1', '2026-08-20T02:00:00Z', 900000))
    contacts.push(contact('c6', null, 'p1'))
    outcomes.push(lead('l6', 'c6', '2026-08-10T02:00:00Z'))
    outcomes.push(purchase('p6', 'c6', '2026-08-15T02:00:00Z', 300000))
    const out = computeReturnLadder(base({
      salesCycleDays: 30,
      spendRows: [spend('2026-08-05', 1000, { platform: 'p1' })],
      contacts,
      outcomes,
    }))
    expect(out.returnOnSpend.withBalanceBasis).toBe(17)
    expect(out.returnOnSpend.withBalanceBasisWithoutLargest).toBe(7)
  })
})

// ---------------------------------------------------------------------------
// H. Threshold boundary
// ---------------------------------------------------------------------------

describe('too few deals boundary', () => {
  it('does not block at exactly the minimum', () => {
    const out = computeReturnLadder(fullData(LADDER_MIN_DEALS_FOR_VERDICT, { salesCycleDays: 30 }))
    expect(out.returnOnSpend.blockers).not.toContain('too_few_deals')
  })

  it('blocks one below the minimum', () => {
    const out = computeReturnLadder(fullData(LADDER_MIN_DEALS_FOR_VERDICT - 1, { salesCycleDays: 30 }))
    expect(out.returnOnSpend.blockers).toContain('too_few_deals')
  })
})

// ---------------------------------------------------------------------------
// I. Unknown share boundary
// ---------------------------------------------------------------------------

/** N paid deals + M unknown-source deals, all placed in 2026-08. */
function paidAndUnknown(paidCount: number, unknownCount: number): LadderInput {
  const contacts: LadderContactFact[] = []
  const outcomes: LadderOutcomeRow[] = []
  for (let i = 0; i < paidCount; i++) {
    const cid = `c${i + 1}`
    contacts.push(contact(cid, null, 'p1'))
    outcomes.push(lead(`l${i + 1}`, cid, '2026-08-10T02:00:00Z'))
    outcomes.push(purchase(`p${i + 1}`, cid, '2026-08-15T02:00:00Z', 100000))
  }
  for (let i = 0; i < unknownCount; i++) {
    const cid = `cu${i + 1}`
    contacts.push(contact(cid, null, null))
    outcomes.push(lead(`lu${i + 1}`, cid, '2026-08-10T02:00:00Z'))
    outcomes.push(purchase(`pu${i + 1}`, cid, '2026-08-15T02:00:00Z', 100000))
  }
  return base({
    salesCycleDays: 30,
    spendRows: [spend('2026-08-05', 1000, { platform: 'p1' })],
    contacts,
    outcomes,
  })
}

describe('unknown share boundary', () => {
  it('does not block at exactly 0.5', () => {
    const out = computeReturnLadder(paidAndUnknown(5, 5))
    expect(out.returnOnSpend.blockers).not.toContain('unknown_source_share_too_high')
    expect(out.returnOnSpend.unknownSourceDeals).toBe(5)
  })

  it('blocks above 0.5', () => {
    const out = computeReturnLadder(paidAndUnknown(5, 6))
    expect(out.returnOnSpend.blockers).toContain('unknown_source_share_too_high')
    expect(out.returnOnSpend.unknownSourceDeals).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// J. Spend currencies
// ---------------------------------------------------------------------------

describe('spend currency blockers', () => {
  it('flags a mismatch when spend spans two currencies', () => {
    const out = computeReturnLadder(returnScenario({
      accounts: [
        { adAccountId: 'acct_a', currency: 'NZD' },
        { adAccountId: 'acct_b', currency: 'AUD' },
      ],
      spendRows: [
        spend('2026-08-05', 1000, { platform: 'p1', adAccountId: 'acct_a' }),
        spend('2026-08-05', 500, { platform: 'p1', adAccountId: 'acct_b' }),
      ],
    }))
    expect(out.returnOnSpend.blockers).toContain('currency_mismatch')
  })

  it('flags a mismatch when revenue spans two currencies', () => {
    const contacts: LadderContactFact[] = []
    const outcomes: LadderOutcomeRow[] = []
    const amounts = [100000, 100000, 100000, 100000, 600000]
    for (let i = 0; i < amounts.length; i++) {
      const cid = `c${i + 1}`
      contacts.push(contact(cid, null, 'p1'))
      outcomes.push(lead(`l${i + 1}`, cid, '2026-08-10T02:00:00Z'))
      outcomes.push(purchase(`p${i + 1}`, cid, '2026-08-15T02:00:00Z', amounts[i] ?? 0, i === 0 ? 'AUD' : 'NZD'))
    }
    const out = computeReturnLadder(returnScenario({ contacts, outcomes }))
    expect(out.returnOnSpend.blockers).toContain('currency_mismatch')
  })

  it('flags an unsupported currency as unknown', () => {
    const contacts: LadderContactFact[] = []
    const outcomes: LadderOutcomeRow[] = []
    const amounts = [100000, 100000, 100000, 100000, 600000]
    for (let i = 0; i < amounts.length; i++) {
      const cid = `c${i + 1}`
      contacts.push(contact(cid, null, 'p1'))
      outcomes.push(lead(`l${i + 1}`, cid, '2026-08-10T02:00:00Z'))
      outcomes.push(purchase(`p${i + 1}`, cid, '2026-08-15T02:00:00Z', amounts[i] ?? 0, 'XXX'))
    }
    const out = computeReturnLadder(returnScenario({
      accounts: [{ adAccountId: 'acct_a', currency: 'XXX' }],
      contacts,
      outcomes,
    }))
    expect(out.returnOnSpend.blockers).toContain('currency_unknown')
  })
})

// ---------------------------------------------------------------------------
// K. Lead-in uses the EARLIEST approved lead
// ---------------------------------------------------------------------------

describe('earliest lead wins', () => {
  it('books to the earliest approved lead month', () => {
    const out = computeReturnLadder(base({
      spendRows: [spend('2026-08-05', 100, { platform: 'p1' })],
      contacts: [contact('c1', '2026-09-20T02:00:00Z', 'p1')],
      outcomes: [
        lead('l1', 'c1', '2026-08-10T02:00:00Z'),
        lead('l2', 'c1', '2026-09-15T02:00:00Z'),
        purchase('p1', 'c1', '2026-10-02T02:00:00Z', 100000),
      ],
    }))
    expect(out.months[0]?.deals).toBe(1)
    expect(out.months[1]?.deals).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// L. Lead day beats firstSeenAt
// ---------------------------------------------------------------------------

describe('lead day beats firstSeenAt', () => {
  it('books to the lead month, not the firstSeen month', () => {
    const out = computeReturnLadder(base({
      spendRows: [spend('2026-08-05', 100, { platform: 'p1' })],
      contacts: [contact('c1', '2026-09-05T02:00:00Z', 'p1')],
      outcomes: [
        lead('l1', 'c1', '2026-08-10T02:00:00Z'),
        purchase('p1', 'c1', '2026-10-02T02:00:00Z', 100000),
      ],
    }))
    expect(out.months[0]?.deals).toBe(1)
    expect(out.months[1]?.deals).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// M. Return is by lead-in month, not money month
// ---------------------------------------------------------------------------

describe('return uses lead-in month', () => {
  it('excludes deals whose leads are in an immature month', () => {
    const contacts: LadderContactFact[] = []
    const outcomes: LadderOutcomeRow[] = []
    for (let i = 0; i < 5; i++) {
      const cid = `c${i + 1}`
      contacts.push(contact(cid, null, 'p1'))
      outcomes.push(lead(`l${i + 1}`, cid, '2026-09-10T02:00:00Z'))
      outcomes.push(purchase(`p${i + 1}`, cid, '2026-10-02T02:00:00Z', 100000))
    }
    const out = computeReturnLadder(base({
      salesCycleDays: 30,
      spendRows: [spend('2026-08-05', 1000, { platform: 'p1' })],
      contacts,
      outcomes,
    }))
    expect(out.returnOnSpend.dealCount).toBe(0)
    expect(out.returnOnSpend.blockers).toContain('too_few_deals')
  })

  it('includes deals whose leads are in a mature month even if money arrives later', () => {
    const contacts: LadderContactFact[] = []
    const outcomes: LadderOutcomeRow[] = []
    for (let i = 0; i < 5; i++) {
      const cid = `c${i + 1}`
      contacts.push(contact(cid, null, 'p1'))
      outcomes.push(lead(`l${i + 1}`, cid, '2026-08-10T02:00:00Z'))
      outcomes.push(purchase(`p${i + 1}`, cid, '2026-10-02T02:00:00Z', 100000))
    }
    const out = computeReturnLadder(base({
      salesCycleDays: 30,
      spendRows: [spend('2026-08-05', 1000, { platform: 'p1' })],
      contacts,
      outcomes,
    }))
    expect(out.returnOnSpend.dealCount).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// N. Unplaced deals never enter the return
// ---------------------------------------------------------------------------

describe('unplaced deals excluded from return', () => {
  it('cannot be paid in mature months', () => {
    const contacts: LadderContactFact[] = []
    const outcomes: LadderOutcomeRow[] = []
    for (let i = 0; i < 5; i++) {
      const cid = `c${i + 1}`
      contacts.push(contact(cid, null, 'p1'))
      outcomes.push(purchase(`p${i + 1}`, cid, '2026-08-15T02:00:00Z', 100000))
    }
    const out = computeReturnLadder(base({
      salesCycleDays: 30,
      spendRows: [spend('2026-08-05', 1000, { platform: 'p1' })],
      contacts,
      outcomes,
    }))
    expect(out.returnOnSpend.dealCount).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// O. Timezone day boundary for a purchase's own occurredAt
// ---------------------------------------------------------------------------

describe('purchase occurredAt timezone boundary', () => {
  it('uses the account timezone for unplaced deals', () => {
    const outcomes = [purchase('p1', null, '2026-07-31T13:30:00Z', 100000)]
    const spendRows = [spend('2026-08-05', 100, { platform: 'p1' })]

    const auckland = computeReturnLadder(base({ spendRows, outcomes }))
    expect(auckland.deals.count).toBe(1)

    const utc = computeReturnLadder(base({ spendRows, outcomes, timezone: 'UTC' }))
    expect(utc.deals.count).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// P. Timezone day boundary for firstSeenAt
// ---------------------------------------------------------------------------

describe('firstSeenAt timezone boundary', () => {
  it('places a deal by firstSeenAt in the account timezone', () => {
    const outcomes = [purchase('p1', 'c1', '2026-08-15T02:00:00Z', 100000)]
    const contacts = [contact('c1', '2026-07-31T13:30:00Z', 'p1')]
    const spendRows = [spend('2026-08-05', 100, { platform: 'p1' })]

    const auckland = computeReturnLadder(base({ spendRows, outcomes, contacts }))
    expect(auckland.months[0]?.deals).toBe(1)

    const utc = computeReturnLadder(base({ spendRows, outcomes, contacts, timezone: 'UTC' }))
    expect(utc.deals.leadInBeforeWindow).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Q. spendIncomplete → results cannot_judge
// ---------------------------------------------------------------------------

describe('spend incomplete blocks results', () => {
  it('marks results cannot_judge even with numbers present', () => {
    const out = computeReturnLadder(base({
      spendIncomplete: true,
      spendRows: [spend('2026-08-05', 100, { leads: 2, messagingConversations: 3 })],
    }))
    expect(out.results.status).toBe('cannot_judge')
    expect(out.results.leads).toBe(2)
    expect(out.results.conversations).toBe(3)
  })
})

// ---------------------------------------------------------------------------
// R. All-null leads column
// ---------------------------------------------------------------------------

describe('all-null result columns', () => {
  it('keeps leads null while conversations is a number', () => {
    const out = computeReturnLadder(base({
      spendRows: [spend('2026-08-05', 100, { leads: null, messagingConversations: 3 })],
    }))
    expect(out.results.leads).toBeNull()
    expect(out.results.conversations).toBe(3)
    expect(out.results.status).toBe('has')
  })

  it('is missing when both columns are all null', () => {
    const out = computeReturnLadder(base({
      spendRows: [spend('2026-08-05', 100, { leads: null, messagingConversations: null })],
    }))
    expect(out.results.status).toBe('missing')
    expect(out.reachedLevel).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// S. Stale spend
// ---------------------------------------------------------------------------

describe('stale spend', () => {
  it('flags spend_stale when the latest row is old', () => {
    const out = computeReturnLadder(base({
      spendRows: [spend('2026-08-18', 100)],
    }))
    expect(out.spend.daysSinceLatest).toBe(52)
    expect(out.notes).toContain('spend_stale')
  })

  it('does not flag spend_stale when the latest row is recent', () => {
    const out = computeReturnLadder(base({
      spendRows: [spend('2026-10-05', 100)],
    }))
    expect(out.notes).not.toContain('spend_stale')
  })
})

// ---------------------------------------------------------------------------
// T. No spend in mature months
// ---------------------------------------------------------------------------

describe('no spend in mature months', () => {
  it('blocks with no_spend_in_mature_months and not no_mature_month', () => {
    const contacts: LadderContactFact[] = []
    const outcomes: LadderOutcomeRow[] = []
    for (let i = 0; i < 5; i++) {
      const cid = `c${i + 1}`
      contacts.push(contact(cid, null, 'p1'))
      outcomes.push(lead(`l${i + 1}`, cid, '2026-08-10T02:00:00Z'))
      outcomes.push(purchase(`p${i + 1}`, cid, '2026-08-15T02:00:00Z', 100000))
    }
    const out = computeReturnLadder(base({
      salesCycleDays: 30,
      spendRows: [spend('2026-10-05', 1000, { platform: 'p1' })],
      contacts,
      outcomes,
    }))
    expect(out.returnOnSpend.blockers).toContain('no_spend_in_mature_months')
    expect(out.returnOnSpend.blockers).not.toContain('no_mature_month')
  })
})

describe('provisional thresholds (待 PM 定)', () => {
  it('are exactly the documented provisional values — changing them must be a deliberate, reviewed edit', () => {
    expect(LADDER_MIN_DEALS_FOR_VERDICT).toBe(5)
    expect(LADDER_MAX_UNKNOWN_SOURCE_SHARE).toBe(0.5)
  })
})
