import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))

import { computeReturnLadder, type LadderInput } from '../compute'
import { ladderHeadline, ladderLines, RETURN_BLOCKER_TEXT } from '../render'

const OPTS = { resultNoun: '咨询' }

function base(overrides: Partial<LadderInput>): LadderInput {
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

function spendRow(overrides: Partial<LadderInput['spendRows'][number]>): LadderInput['spendRows'][number] {
  return {
    adAccountId: 'acct_a',
    platform: 'p1',
    insightDate: '2026-08-15',
    spend: 100,
    leads: null,
    messagingConversations: null,
    ...overrides,
  }
}

function leadRow(overrides: Partial<LadderInput['outcomes'][number]>): LadderInput['outcomes'][number] {
  return {
    id: 'o1',
    contactId: 'c1',
    kind: 'lead',
    amountMinor: null,
    currency: null,
    occurredAt: '2026-08-10T00:00:00Z',
    reviewStatus: 'approved',
    ...overrides,
  }
}

function purchaseRow(overrides: Partial<LadderInput['outcomes'][number]>): LadderInput['outcomes'][number] {
  return {
    id: 'p1',
    contactId: 'c1',
    kind: 'purchase',
    amountMinor: 100000,
    currency: 'NZD',
    occurredAt: '2026-08-20T00:00:00Z',
    reviewStatus: 'approved',
    ...overrides,
  }
}

function balanceRow(overrides: Partial<LadderInput['outcomes'][number]>): LadderInput['outcomes'][number] {
  return {
    id: 'b1',
    contactId: 'c1',
    kind: 'balance',
    amountMinor: 50000,
    currency: 'NZD',
    occurredAt: '2026-08-25T00:00:00Z',
    reviewStatus: 'approved',
    ...overrides,
  }
}

function contact(overrides: Partial<LadderInput['contacts'][number]>): LadderInput['contacts'][number] {
  return {
    id: 'c1',
    firstSeenAt: '2026-08-01T00:00:00Z',
    attrPlatform: 'p1',
    ...overrides,
  }
}

describe('ladderHeadline', () => {
  it('says nothing is readable when there is no spend', () => {
    const ladder = computeReturnLadder(base({}))
    expect(ladderHeadline(ladder)).toBe('连第 1 级（花费）都没有数')
  })

  it('mentions the three-month window and that it is not this week', () => {
    const ladder = computeReturnLadder(base({
      spendRows: [spendRow({ insightDate: '2026-08-15', spend: 100, leads: 3, messagingConversations: 4 })],
    }))
    const headline = ladderHeadline(ladder)
    expect(headline).toContain('近三个自然月累计')
    expect(headline).toContain('不是本周')
  })
})

describe('ladderLines · empty input', () => {
  it('returns at least six lines and the first line says what is missing', () => {
    const ladder = computeReturnLadder(base({}))
    const lines = ladderLines(ladder, OPTS)
    expect(lines.length).toBeGreaterThanOrEqual(6)
    expect(lines[0]).toContain('没有数')
    expect(lines[0]).toContain('该补')
  })
})

describe('ladderLines · level 2 only', () => {
  const ladder = computeReturnLadder(base({
    spendRows: [
      spendRow({ insightDate: '2026-08-15', spend: 100, leads: 3, messagingConversations: 4 }),
    ],
  }))
  const lines = ladderLines(ladder, OPTS)

  it('headline says it reached level 2', () => {
    expect(ladderHeadline(ladder)).toContain('算到第 2 级')
  })

  it('line 1 shows both result counts and that they are not added', () => {
    expect(lines[1]).toContain('3 个')
    expect(lines[1]).toContain('4 个')
    expect(lines[1]).toContain('两个数多半是同一批人的两个阶段，不相加')
  })

  it('never mentions ROI', () => {
    for (const line of lines) expect(line).not.toContain('ROI')
  })

  it('notes that it only reached level 2', () => {
    expect(lines.some(l => l.includes('只到第 2 级'))).toBe(true)
  })

  it('line 2 says qualified is missing, not zero', () => {
    expect(lines[2]).toContain('不等于 0 个')
    expect(lines[2]).toContain('该补')
  })

  it('line 3 says deals are missing', () => {
    expect(lines[3]).toContain('该补')
  })

  it('line 5 is the return line and says it cannot be computed yet', () => {
    expect(lines[5].startsWith('⑥ 回报')).toBe(true)
    expect(lines[5]).toContain('还算不到')
  })
})

describe('ladderLines · primary result marker', () => {
  it('marks the primary result when config is readable', () => {
    const ladder = computeReturnLadder(base({
      primaryResult: 'messaging_started',
      spendRows: [
        spendRow({ insightDate: '2026-08-15', spend: 100, leads: 3, messagingConversations: 4 }),
      ],
    }))
    const lines = ladderLines(ladder, OPTS)
    expect(lines[1]).toContain('私信开聊【主结果】')
  })

  it('drops the marker and warns when config is unreadable', () => {
    const ladder = computeReturnLadder(base({
      primaryResult: 'messaging_started',
      configSource: 'fallback',
      spendRows: [
        spendRow({ insightDate: '2026-08-15', spend: 100, leads: 3, messagingConversations: 4 }),
      ],
    }))
    const lines = ladderLines(ladder, OPTS)
    expect(lines[1]).not.toContain('【主结果】')
    expect(lines.some(l => l.startsWith('提醒：'))).toBe(true)
  })
})

describe('ladderLines · level 3', () => {
  const ladder = computeReturnLadder(base({
    spendRows: [
      spendRow({ insightDate: '2026-08-15', spend: 100, leads: 3, messagingConversations: 4 }),
    ],
    contacts: [
      contact({ id: 'c1', attrPlatform: 'p1' }),
      contact({ id: 'c2', attrPlatform: null }),
    ],
    outcomes: [
      leadRow({ id: 'o1', contactId: 'c1', occurredAt: '2026-08-10T00:00:00Z' }),
      leadRow({ id: 'o2', contactId: 'c2', occurredAt: '2026-08-11T00:00:00Z' }),
    ],
  }))
  const lines = ladderLines(ladder, OPTS)

  it('line 2 counts qualified leads and splits paid vs unknown source', () => {
    expect(lines[2]).toContain('已有证据确认的 2 个')
    expect(lines[2]).toContain('来源标记是投放渠道 1 个')
    expect(lines[2]).toContain('来源不明 1 个')
  })

  it('line 2 says it is not a qualification rate', () => {
    expect(lines[2]).toContain('这不是合格率')
  })

  it('never mentions ROI', () => {
    for (const line of lines) expect(line).not.toContain('ROI')
  })

  it('notes that it only reached level 3', () => {
    expect(lines.some(l => l.includes('只到第 3 级'))).toBe(true)
  })
})

describe('ladderLines · level 5 with cycle not configured', () => {
  const ladder = computeReturnLadder(base({
    spendRows: [
      spendRow({ insightDate: '2026-08-15', spend: 1000, leads: 5, messagingConversations: 0 }),
    ],
    contacts: [
      contact({ id: 'c1' }),
      contact({ id: 'c2' }),
      contact({ id: 'c3' }),
      contact({ id: 'c4' }),
      contact({ id: 'c5' }),
    ],
    outcomes: [
      leadRow({ id: 'l1', contactId: 'c1', occurredAt: '2026-08-01T00:00:00Z' }),
      leadRow({ id: 'l2', contactId: 'c2', occurredAt: '2026-08-02T00:00:00Z' }),
      leadRow({ id: 'l3', contactId: 'c3', occurredAt: '2026-08-03T00:00:00Z' }),
      leadRow({ id: 'l4', contactId: 'c4', occurredAt: '2026-08-04T00:00:00Z' }),
      leadRow({ id: 'l5', contactId: 'c5', occurredAt: '2026-08-05T00:00:00Z' }),
      purchaseRow({ id: 'p1', contactId: 'c1', occurredAt: '2026-08-20T00:00:00Z' }),
      purchaseRow({ id: 'p2', contactId: 'c2', occurredAt: '2026-08-21T00:00:00Z' }),
      purchaseRow({ id: 'p3', contactId: 'c3', occurredAt: '2026-08-22T00:00:00Z' }),
      purchaseRow({ id: 'p4', contactId: 'c4', occurredAt: '2026-08-23T00:00:00Z' }),
      purchaseRow({ id: 'p5', contactId: 'c5', occurredAt: '2026-08-24T00:00:00Z' }),
    ],
  }))
  const lines = ladderLines(ladder, OPTS)

  it('level 6 says it cannot be judged because the cycle is not configured', () => {
    expect(lines[5]).toContain('判不了')
    expect(lines[5]).toContain('成交周期没配置')
  })

  it('never mentions ROI', () => {
    for (const line of lines) expect(line).not.toContain('ROI')
  })

  it('line 4 shows both revenue bases and the refund caveat', () => {
    expect(lines[4]).toContain('定金口径')
    expect(lines[4]).toContain('全款口径')
    expect(lines[4]).toContain('退款没有记录')
  })
})

describe('ladderLines · level 6 reached', () => {
  const ladder = computeReturnLadder(base({
    salesCycleDays: 30,
    spendRows: [
      spendRow({ insightDate: '2026-08-15', spend: 1000, leads: 5, messagingConversations: 0 }),
    ],
    contacts: [
      contact({ id: 'c1' }),
      contact({ id: 'c2' }),
      contact({ id: 'c3' }),
      contact({ id: 'c4' }),
      contact({ id: 'c5' }),
    ],
    outcomes: [
      leadRow({ id: 'l1', contactId: 'c1', occurredAt: '2026-08-01T00:00:00Z' }),
      leadRow({ id: 'l2', contactId: 'c2', occurredAt: '2026-08-02T00:00:00Z' }),
      leadRow({ id: 'l3', contactId: 'c3', occurredAt: '2026-08-03T00:00:00Z' }),
      leadRow({ id: 'l4', contactId: 'c4', occurredAt: '2026-08-04T00:00:00Z' }),
      leadRow({ id: 'l5', contactId: 'c5', occurredAt: '2026-08-05T00:00:00Z' }),
      purchaseRow({ id: 'p1', contactId: 'c1', occurredAt: '2026-08-20T00:00:00Z' }),
      purchaseRow({ id: 'p2', contactId: 'c2', occurredAt: '2026-08-21T00:00:00Z' }),
      purchaseRow({ id: 'p3', contactId: 'c3', occurredAt: '2026-08-22T00:00:00Z' }),
      purchaseRow({ id: 'p4', contactId: 'c4', occurredAt: '2026-08-23T00:00:00Z' }),
      purchaseRow({ id: 'p5', contactId: 'c5', occurredAt: '2026-08-24T00:00:00Z' }),
    ],
  }))
  const lines = ladderLines(ladder, OPTS)

  it('level 6 is the ROI line with both bases and the largest-deal variant', () => {
    expect(lines[5].startsWith('⑥ ROI')).toBe(true)
    expect(lines[5]).toContain('定金口径')
    expect(lines[5]).toContain('全款口径')
    expect(lines[5]).toContain('剔掉最大一单后')
  })

  it('level 6 says the scope is narrower than level 5 and names the paid deals', () => {
    expect(lines[5]).toContain('范围比第 5 级窄')
    expect(lines[5]).toContain('来源标记是投放渠道的 5 单')
  })

  it('level 6 repeats the refund caveat', () => {
    expect(lines[5]).toContain('退款没有记录')
  })

  it('flags the immature months', () => {
    expect(lines[5]).toContain('未成熟，不可判')
  })

  it('mentions ROI on exactly one line', () => {
    const withRoi = lines.filter(l => l.includes('ROI'))
    expect(withRoi.length).toBe(1)
  })
})

describe('ladderLines · too few deals', () => {
  const ladder = computeReturnLadder(base({
    salesCycleDays: 30,
    spendRows: [
      spendRow({ insightDate: '2026-08-15', spend: 1000, leads: 2, messagingConversations: 0 }),
    ],
    contacts: [
      contact({ id: 'c1' }),
      contact({ id: 'c2' }),
    ],
    outcomes: [
      leadRow({ id: 'l1', contactId: 'c1', occurredAt: '2026-08-01T00:00:00Z' }),
      leadRow({ id: 'l2', contactId: 'c2', occurredAt: '2026-08-02T00:00:00Z' }),
      purchaseRow({ id: 'p1', contactId: 'c1', occurredAt: '2026-08-20T00:00:00Z' }),
      purchaseRow({ id: 'p2', contactId: 'c2', occurredAt: '2026-08-21T00:00:00Z' }),
    ],
  }))
  const lines = ladderLines(ladder, OPTS)

  it('level 6 says there are too few deals and the threshold is provisional', () => {
    expect(lines[5]).toContain('太少不下结论')
    expect(lines[5]).toContain('待 PM 定')
  })

  it('never mentions ROI', () => {
    for (const line of lines) expect(line).not.toContain('ROI')
  })
})

describe('ladderLines · two spend currencies', () => {
  it('line 0 says the currencies are not added together', () => {
    const ladder = computeReturnLadder(base({
      accounts: [
        { adAccountId: 'acct_a', currency: 'NZD' },
        { adAccountId: 'acct_b', currency: 'AUD' },
      ],
      spendRows: [
        spendRow({ adAccountId: 'acct_a', insightDate: '2026-08-15', spend: 100 }),
        spendRow({ adAccountId: 'acct_b', insightDate: '2026-08-15', spend: 200 }),
      ],
    }))
    const lines = ladderLines(ladder, OPTS)
    expect(lines[0]).toContain('币种不同，不相加')
  })
})

describe('ladderLines · all-null result columns', () => {
  it('line 1 prints 读不到 for a null count', () => {
    const ladder = computeReturnLadder(base({
      spendRows: [
        spendRow({ insightDate: '2026-08-15', spend: 100, leads: null, messagingConversations: 4 }),
      ],
    }))
    const lines = ladderLines(ladder, OPTS)
    expect(lines[1]).toContain('读不到')
    expect(lines[1]).toContain('4 个')
  })
})

describe('ladderLines · stale spend', () => {
  it('line 0 warns about the days since the latest spend and a reminder line mentions stopping', () => {
    const ladder = computeReturnLadder(base({
      asOfDate: '2026-10-09',
      spendRows: [
        spendRow({ insightDate: '2026-08-18', spend: 100, leads: 3, messagingConversations: 4 }),
      ],
    }))
    const lines = ladderLines(ladder, OPTS)
    expect(lines[0]).toContain('近 52 天没有新花费数据')
    expect(lines.some(l => l.startsWith('提醒：') && l.includes('停投'))).toBe(true)
  })
})

describe('ladderLines · unknown-source deals in the mature month', () => {
  it('level 6 mentions the unknown-source deals that were left out', () => {
    const ladder = computeReturnLadder(base({
      salesCycleDays: 30,
      spendRows: [
        spendRow({ insightDate: '2026-08-15', spend: 1000, leads: 5, messagingConversations: 0 }),
      ],
      contacts: [
        contact({ id: 'c1' }),
        contact({ id: 'c2' }),
        contact({ id: 'c3' }),
        contact({ id: 'c4' }),
        contact({ id: 'c5' }),
        contact({ id: 'c6', attrPlatform: null }),
        contact({ id: 'c7', attrPlatform: null }),
      ],
      outcomes: [
        leadRow({ id: 'l1', contactId: 'c1', occurredAt: '2026-08-01T00:00:00Z' }),
        leadRow({ id: 'l2', contactId: 'c2', occurredAt: '2026-08-02T00:00:00Z' }),
        leadRow({ id: 'l3', contactId: 'c3', occurredAt: '2026-08-03T00:00:00Z' }),
        leadRow({ id: 'l4', contactId: 'c4', occurredAt: '2026-08-04T00:00:00Z' }),
        leadRow({ id: 'l5', contactId: 'c5', occurredAt: '2026-08-05T00:00:00Z' }),
        leadRow({ id: 'l6', contactId: 'c6', occurredAt: '2026-08-06T00:00:00Z' }),
        leadRow({ id: 'l7', contactId: 'c7', occurredAt: '2026-08-07T00:00:00Z' }),
        purchaseRow({ id: 'p1', contactId: 'c1', occurredAt: '2026-08-20T00:00:00Z' }),
        purchaseRow({ id: 'p2', contactId: 'c2', occurredAt: '2026-08-21T00:00:00Z' }),
        purchaseRow({ id: 'p3', contactId: 'c3', occurredAt: '2026-08-22T00:00:00Z' }),
        purchaseRow({ id: 'p4', contactId: 'c4', occurredAt: '2026-08-23T00:00:00Z' }),
        purchaseRow({ id: 'p5', contactId: 'c5', occurredAt: '2026-08-24T00:00:00Z' }),
        purchaseRow({ id: 'p6', contactId: 'c6', occurredAt: '2026-08-25T00:00:00Z' }),
        purchaseRow({ id: 'p7', contactId: 'c7', occurredAt: '2026-08-26T00:00:00Z' }),
      ],
    }))
    const lines = ladderLines(ladder, OPTS)
    expect(lines[5].startsWith('⑥ ROI')).toBe(true)
    expect(lines[5]).toContain('另有 2 单来源不明没算进去')
  })
})

describe('ladderLines · balance rows', () => {
  it('a balance dated after its purchase is added to the full-payment basis', () => {
    const ladder = computeReturnLadder(base({
      salesCycleDays: 30,
      spendRows: [
        spendRow({ insightDate: '2026-08-15', spend: 1000, leads: 5, messagingConversations: 0 }),
      ],
      contacts: [
        contact({ id: 'c1' }),
        contact({ id: 'c2' }),
        contact({ id: 'c3' }),
        contact({ id: 'c4' }),
        contact({ id: 'c5' }),
      ],
      outcomes: [
        leadRow({ id: 'l1', contactId: 'c1', occurredAt: '2026-08-01T00:00:00Z' }),
        leadRow({ id: 'l2', contactId: 'c2', occurredAt: '2026-08-02T00:00:00Z' }),
        leadRow({ id: 'l3', contactId: 'c3', occurredAt: '2026-08-03T00:00:00Z' }),
        leadRow({ id: 'l4', contactId: 'c4', occurredAt: '2026-08-04T00:00:00Z' }),
        leadRow({ id: 'l5', contactId: 'c5', occurredAt: '2026-08-05T00:00:00Z' }),
        purchaseRow({ id: 'p1', contactId: 'c1', occurredAt: '2026-08-20T00:00:00Z' }),
        purchaseRow({ id: 'p2', contactId: 'c2', occurredAt: '2026-08-21T00:00:00Z' }),
        purchaseRow({ id: 'p3', contactId: 'c3', occurredAt: '2026-08-22T00:00:00Z' }),
        purchaseRow({ id: 'p4', contactId: 'c4', occurredAt: '2026-08-23T00:00:00Z' }),
        purchaseRow({ id: 'p5', contactId: 'c5', occurredAt: '2026-08-24T00:00:00Z' }),
        balanceRow({ id: 'b1', contactId: 'c1', occurredAt: '2026-08-25T00:00:00Z' }),
      ],
    }))
    const lines = ladderLines(ladder, OPTS)
    expect(lines[4]).toContain('全款口径')
    expect(lines[5].startsWith('⑥ ROI')).toBe(true)
  })
})

describe('ladderLines · the level-2 trap', () => {
  const ladder = computeReturnLadder(base({
    salesCycleDays: 30,
    spendRows: [
      spendRow({ insightDate: '2026-08-15', spend: 1000, leads: 5, messagingConversations: 0 }),
    ],
    contacts: [
      contact({ id: 'c1', firstSeenAt: '2026-08-01T00:00:00Z', attrPlatform: 'p1' }),
      contact({ id: 'c2', firstSeenAt: '2026-08-02T00:00:00Z', attrPlatform: 'p1' }),
      contact({ id: 'c3', firstSeenAt: '2026-08-03T00:00:00Z', attrPlatform: 'p1' }),
      contact({ id: 'c4', firstSeenAt: '2026-08-04T00:00:00Z', attrPlatform: 'p1' }),
      contact({ id: 'c5', firstSeenAt: '2026-08-05T00:00:00Z', attrPlatform: 'p1' }),
    ],
    outcomes: [
      purchaseRow({ id: 'p1', contactId: 'c1', occurredAt: '2026-08-20T00:00:00Z' }),
      purchaseRow({ id: 'p2', contactId: 'c2', occurredAt: '2026-08-21T00:00:00Z' }),
      purchaseRow({ id: 'p3', contactId: 'c3', occurredAt: '2026-08-22T00:00:00Z' }),
      purchaseRow({ id: 'p4', contactId: 'c4', occurredAt: '2026-08-23T00:00:00Z' }),
      purchaseRow({ id: 'p5', contactId: 'c5', occurredAt: '2026-08-24T00:00:00Z' }),
    ],
  }))
  const lines = ladderLines(ladder, OPTS)

  it('headline says it only reached level 2', () => {
    expect(ladderHeadline(ladder)).toContain('算到第 2 级')
  })

  it('never mentions ROI', () => {
    for (const line of lines) expect(line).not.toContain('ROI')
  })

  it('the level-6 line says it cannot be computed yet', () => {
    expect(lines[5]).toContain('还算不到')
  })
})

describe('ladderLines · no ROI below level 6', () => {
  const cases: { name: string; input: LadderInput }[] = [
    { name: 'empty', input: base({}) },
    {
      name: 'level 1 with all-null result columns',
      input: base({
        spendRows: [spendRow({ insightDate: '2026-08-15', spend: 100, leads: null, messagingConversations: null })],
      }),
    },
    {
      name: 'level 2',
      input: base({
        spendRows: [spendRow({ insightDate: '2026-08-15', spend: 100, leads: 3, messagingConversations: 4 })],
      }),
    },
    {
      name: 'level 3',
      input: base({
        spendRows: [spendRow({ insightDate: '2026-08-15', spend: 100, leads: 3, messagingConversations: 4 })],
        contacts: [contact({ id: 'c1', attrPlatform: 'p1' })],
        outcomes: [leadRow({ id: 'o1', contactId: 'c1', occurredAt: '2026-08-10T00:00:00Z' })],
      }),
    },
    {
      name: 'level 5 without cycle',
      input: base({
        spendRows: [spendRow({ insightDate: '2026-08-15', spend: 1000, leads: 5, messagingConversations: 0 })],
        contacts: [
          contact({ id: 'c1' }),
          contact({ id: 'c2' }),
          contact({ id: 'c3' }),
          contact({ id: 'c4' }),
          contact({ id: 'c5' }),
        ],
        outcomes: [
          leadRow({ id: 'l1', contactId: 'c1', occurredAt: '2026-08-01T00:00:00Z' }),
          leadRow({ id: 'l2', contactId: 'c2', occurredAt: '2026-08-02T00:00:00Z' }),
          leadRow({ id: 'l3', contactId: 'c3', occurredAt: '2026-08-03T00:00:00Z' }),
          leadRow({ id: 'l4', contactId: 'c4', occurredAt: '2026-08-04T00:00:00Z' }),
          leadRow({ id: 'l5', contactId: 'c5', occurredAt: '2026-08-05T00:00:00Z' }),
          purchaseRow({ id: 'p1', contactId: 'c1', occurredAt: '2026-08-20T00:00:00Z' }),
          purchaseRow({ id: 'p2', contactId: 'c2', occurredAt: '2026-08-21T00:00:00Z' }),
          purchaseRow({ id: 'p3', contactId: 'c3', occurredAt: '2026-08-22T00:00:00Z' }),
          purchaseRow({ id: 'p4', contactId: 'c4', occurredAt: '2026-08-23T00:00:00Z' }),
          purchaseRow({ id: 'p5', contactId: 'c5', occurredAt: '2026-08-24T00:00:00Z' }),
        ],
      }),
    },
    {
      name: 'too few deals',
      input: base({
        salesCycleDays: 30,
        spendRows: [spendRow({ insightDate: '2026-08-15', spend: 1000, leads: 2, messagingConversations: 0 })],
        contacts: [contact({ id: 'c1' }), contact({ id: 'c2' })],
        outcomes: [
          leadRow({ id: 'l1', contactId: 'c1', occurredAt: '2026-08-01T00:00:00Z' }),
          leadRow({ id: 'l2', contactId: 'c2', occurredAt: '2026-08-02T00:00:00Z' }),
          purchaseRow({ id: 'p1', contactId: 'c1', occurredAt: '2026-08-20T00:00:00Z' }),
          purchaseRow({ id: 'p2', contactId: 'c2', occurredAt: '2026-08-21T00:00:00Z' }),
        ],
      }),
    },
    {
      name: 'unknown share too high',
      input: base({
        salesCycleDays: 30,
        spendRows: [spendRow({ insightDate: '2026-08-15', spend: 1000, leads: 5, messagingConversations: 0 })],
        contacts: [
          contact({ id: 'c1' }),
          contact({ id: 'c2' }),
          contact({ id: 'c3', attrPlatform: null }),
          contact({ id: 'c4', attrPlatform: null }),
          contact({ id: 'c5', attrPlatform: null }),
        ],
        outcomes: [
          leadRow({ id: 'l1', contactId: 'c1', occurredAt: '2026-08-01T00:00:00Z' }),
          leadRow({ id: 'l2', contactId: 'c2', occurredAt: '2026-08-02T00:00:00Z' }),
          leadRow({ id: 'l3', contactId: 'c3', occurredAt: '2026-08-03T00:00:00Z' }),
          leadRow({ id: 'l4', contactId: 'c4', occurredAt: '2026-08-04T00:00:00Z' }),
          leadRow({ id: 'l5', contactId: 'c5', occurredAt: '2026-08-05T00:00:00Z' }),
          purchaseRow({ id: 'p1', contactId: 'c1', occurredAt: '2026-08-20T00:00:00Z' }),
          purchaseRow({ id: 'p2', contactId: 'c2', occurredAt: '2026-08-21T00:00:00Z' }),
          purchaseRow({ id: 'p3', contactId: 'c3', occurredAt: '2026-08-22T00:00:00Z' }),
          purchaseRow({ id: 'p4', contactId: 'c4', occurredAt: '2026-08-23T00:00:00Z' }),
          purchaseRow({ id: 'p5', contactId: 'c5', occurredAt: '2026-08-24T00:00:00Z' }),
        ],
      }),
    },
    {
      name: 'currency mismatch',
      input: base({
        salesCycleDays: 30,
        accounts: [
          { adAccountId: 'acct_a', currency: 'NZD' },
          { adAccountId: 'acct_b', currency: 'AUD' },
        ],
        spendRows: [
          spendRow({ adAccountId: 'acct_a', insightDate: '2026-08-15', spend: 500, leads: 5, messagingConversations: 0 }),
          spendRow({ adAccountId: 'acct_b', insightDate: '2026-08-15', spend: 500, leads: 0, messagingConversations: 0 }),
        ],
        contacts: [
          contact({ id: 'c1' }),
          contact({ id: 'c2' }),
          contact({ id: 'c3' }),
          contact({ id: 'c4' }),
          contact({ id: 'c5' }),
        ],
        outcomes: [
          leadRow({ id: 'l1', contactId: 'c1', occurredAt: '2026-08-01T00:00:00Z' }),
          leadRow({ id: 'l2', contactId: 'c2', occurredAt: '2026-08-02T00:00:00Z' }),
          leadRow({ id: 'l3', contactId: 'c3', occurredAt: '2026-08-03T00:00:00Z' }),
          leadRow({ id: 'l4', contactId: 'c4', occurredAt: '2026-08-04T00:00:00Z' }),
          leadRow({ id: 'l5', contactId: 'c5', occurredAt: '2026-08-05T00:00:00Z' }),
          purchaseRow({ id: 'p1', contactId: 'c1', occurredAt: '2026-08-20T00:00:00Z' }),
          purchaseRow({ id: 'p2', contactId: 'c2', occurredAt: '2026-08-21T00:00:00Z' }),
          purchaseRow({ id: 'p3', contactId: 'c3', occurredAt: '2026-08-22T00:00:00Z' }),
          purchaseRow({ id: 'p4', contactId: 'c4', occurredAt: '2026-08-23T00:00:00Z' }),
          purchaseRow({ id: 'p5', contactId: 'c5', occurredAt: '2026-08-24T00:00:00Z' }),
        ],
      }),
    },
  ]

  for (const c of cases) {
    it(`never mentions ROI for: ${c.name}`, () => {
      const ladder = computeReturnLadder(c.input)
      expect(ladder.reachedLevel).toBeLessThan(6)
      expect(ladderHeadline(ladder)).not.toContain('ROI')
      for (const line of ladderLines(ladder, OPTS)) expect(line).not.toContain('ROI')
    })
  }
})

describe('RETURN_BLOCKER_TEXT', () => {
  it('never mentions ROI', () => {
    for (const text of Object.values(RETURN_BLOCKER_TEXT)) {
      expect(text).not.toContain('ROI')
    }
  })
})
