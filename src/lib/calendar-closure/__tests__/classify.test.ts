import { describe, expect, it } from 'vitest'
import { classifyEvents, type ClassifyInput, type LedgerCardView } from '../classify'
import { MAX_EVENTS_PER_RUN, WINDOW_DAYS, type CalendarEvent } from '../types'

const TODAY = '2026-10-08'

function makeEvent(overrides: Partial<CalendarEvent> & { id: string }): CalendarEvent {
  return {
    title: '到期事项',
    description: '',
    startNz: TODAY,
    htmlLink: `https://example.test/${overrides.id}`,
    etag: null,
    updated: null,
    ...overrides,
  }
}

function makeCard(overrides: Partial<LedgerCardView> & { id: string }): LedgerCardView {
  return {
    status: 'decided',
    verifiedRef: null,
    ...overrides,
  }
}

function makeInput(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    events: [],
    cards: new Map<string, LedgerCardView>(),
    coveredLedgerIds: new Set<string>(),
    todayNz: TODAY,
    ...overrides,
  }
}

/** A description with a valid ledger-id and no probe. */
function humanDescription(ledgerId: string): string {
  return `ledger-id: ${ledgerId}`
}

/** A description with a valid ledger-id and a valid probe. */
function autoDescription(ledgerId: string): string {
  return `ledger-id: ${ledgerId}\nprobe: ledger_card_status id=${ledgerId} status=done`
}

describe('classifyEvents window', () => {
  it('includes d=0 (due today)', () => {
    const event = makeEvent({ id: 'e0', startNz: TODAY })
    const out = classifyEvents(makeInput({ events: [event] }))
    expect(out.candidates).toBe(1)
    expect(out.decisions).toHaveLength(1)
    expect(out.decisions[0].overdueDays).toBe(0)
  })

  it('includes d=14 (window edge)', () => {
    const event = makeEvent({ id: 'e14', startNz: '2026-09-24' })
    const out = classifyEvents(makeInput({ events: [event] }))
    expect(out.candidates).toBe(1)
    expect(out.decisions[0].overdueDays).toBe(WINDOW_DAYS)
  })

  it('excludes d=15 (just past the window)', () => {
    const event = makeEvent({ id: 'e15', startNz: '2026-09-23' })
    const out = classifyEvents(makeInput({ events: [event] }))
    expect(out.candidates).toBe(0)
    expect(out.decisions).toHaveLength(0)
  })

  it('excludes future events', () => {
    const event = makeEvent({ id: 'future', startNz: '2026-10-09' })
    const out = classifyEvents(makeInput({ events: [event] }))
    expect(out.candidates).toBe(0)
    expect(out.decisions).toHaveLength(0)
  })
})

describe('classifyEvents tiers', () => {
  it('(a) closed title wins over everything', () => {
    const event = makeEvent({
      id: 'e-closed',
      title: '✅ 已完成',
      description: 'ledger-id: 2026-10-01-some-card',
    })
    const out = classifyEvents(makeInput({ events: [event] }))
    expect(out.decisions[0].tier).toBe('closed')
    expect(out.decisions[0].reason).toBe('标题已标记闭环')
    expect(out.decisions[0].ledgerId).toBeNull()
    expect(out.decisions[0].probe).toBeNull()
  })

  it('(b) missing ledger-id -> no_ledger', () => {
    const event = makeEvent({ id: 'e-noledger', description: 'no id here' })
    const out = classifyEvents(makeInput({ events: [event] }))
    expect(out.decisions[0].tier).toBe('no_ledger')
    expect(out.decisions[0].ledgerId).toBeNull()
    expect(out.decisions[0].reason).toBe('描述里没有 ledger-id')
  })

  it('(b) ambiguous ledger-id -> no_ledger', () => {
    const event = makeEvent({
      id: 'e-ambig',
      description: 'ledger-id: 2026-10-01-a\nledger-id: 2026-10-01-b',
    })
    const out = classifyEvents(makeInput({ events: [event] }))
    expect(out.decisions[0].tier).toBe('no_ledger')
    expect(out.decisions[0].ledgerId).toBeNull()
    expect(out.decisions[0].reason).toBe('描述里出现多个 ledger-id')
  })

  it('(c) card missing from ledger -> no_ledger', () => {
    const event = makeEvent({
      id: 'e-missing',
      description: humanDescription('2026-10-01-ghost'),
    })
    const out = classifyEvents(makeInput({ events: [event] }))
    expect(out.decisions[0].tier).toBe('no_ledger')
    expect(out.decisions[0].ledgerId).toBe('2026-10-01-ghost')
    expect(out.decisions[0].reason).toBe('台账里没有这张卡')
  })

  it('(d) verified card -> closed', () => {
    const id = '2026-10-01-verified'
    const event = makeEvent({ id: 'e-verified', description: humanDescription(id) })
    const cards = new Map([[id, makeCard({ id, status: 'verified' })]])
    const out = classifyEvents(makeInput({ events: [event], cards }))
    expect(out.decisions[0].tier).toBe('closed')
    expect(out.decisions[0].reason).toBe('台账卡已 verified')
  })

  it('(d) done card with verifiedRef -> closed', () => {
    const id = '2026-10-01-done'
    const event = makeEvent({ id: 'e-done', description: humanDescription(id) })
    const cards = new Map([[id, makeCard({ id, status: 'done', verifiedRef: 'ref-1' })]])
    const out = classifyEvents(makeInput({ events: [event], cards }))
    expect(out.decisions[0].tier).toBe('closed')
    expect(out.decisions[0].reason).toBe('台账卡已有验证证据')
  })

  it('(e) covered card -> covered', () => {
    const id = '2026-10-01-covered'
    const event = makeEvent({ id: 'e-covered', description: humanDescription(id) })
    const cards = new Map([[id, makeCard({ id, status: 'decided' })]])
    const out = classifyEvents(
      makeInput({ events: [event], cards, coveredLedgerIds: new Set([id]) }),
    )
    expect(out.decisions[0].tier).toBe('covered')
    expect(out.decisions[0].reason).toBe('台账栏今天已为这张卡出待办')
  })

  it('(f) probe present -> auto, probe kept', () => {
    const id = '2026-10-01-auto'
    const event = makeEvent({ id: 'e-auto', description: autoDescription(id) })
    const cards = new Map([[id, makeCard({ id, status: 'decided' })]])
    const out = classifyEvents(makeInput({ events: [event], cards }))
    expect(out.decisions[0].tier).toBe('auto')
    expect(out.decisions[0].probe).not.toBeNull()
    expect(out.decisions[0].probe?.name).toBe('ledger_card_status')
  })

  it('(f) no probe -> human', () => {
    const id = '2026-10-01-human'
    const event = makeEvent({ id: 'e-human', description: humanDescription(id) })
    const cards = new Map([[id, makeCard({ id, status: 'decided' })]])
    const out = classifyEvents(makeInput({ events: [event], cards }))
    expect(out.decisions[0].tier).toBe('human')
    expect(out.decisions[0].probe).toBeNull()
  })

  it('decided card with no verify_by is NOT covered when coveredLedgerIds is empty', () => {
    const id = '2026-10-01-decided'
    const event = makeEvent({ id: 'e-decided', description: humanDescription(id) })
    const cards = new Map([[id, makeCard({ id, status: 'decided' })]])
    const out = classifyEvents(makeInput({ events: [event], cards }))
    expect(out.decisions[0].tier).toBe('human')
  })
})

describe('classifyEvents independence', () => {
  it('judges two events referencing the same card independently', () => {
    const id = '2026-10-01-shared'
    const cards = new Map([[id, makeCard({ id, status: 'decided' })]])
    const events = [
      makeEvent({ id: 'e-a', description: humanDescription(id) }),
      makeEvent({ id: 'e-b', description: autoDescription(id) }),
    ]
    const out = classifyEvents(makeInput({ events, cards }))
    const byId = new Map(out.decisions.map((d) => [d.eventId, d]))
    expect(byId.get('e-a')?.tier).toBe('human')
    expect(byId.get('e-b')?.tier).toBe('auto')
  })
})

describe('classifyEvents 旧事项只计数', () => {
  it('超过 14 天（到 60 天）没闭环的算 staleOpen，不进 decisions；已闭环的不算；超过 60 天的不看', () => {
    const events = [
      makeEvent({ id: 'old-open', startNz: '2026-09-01', description: '' }), // 37 天前，没编号
      makeEvent({ id: 'old-closed', startNz: '2026-09-01', title: '✅ done' }),
      makeEvent({ id: 'ancient', startNz: '2026-07-01', description: '' }), // 99 天前
      makeEvent({ id: 'recent', startNz: '2026-10-05', description: '' }),
    ]
    const out = classifyEvents(makeInput({ events }))
    expect(out.staleOpen).toBe(1)
    expect(out.decisions.map((d) => d.eventId)).toEqual(['recent'])
  })
})

describe('classifyEvents limit and ordering', () => {
  it('keeps MAX_EVENTS_PER_RUN actionable, defers the rest, keeps closed', () => {
    const events: CalendarEvent[] = []
    const cards = new Map<string, LedgerCardView>()
    for (let i = 0; i < 35; i++) {
      const id = `2026-10-01-card-${String(i).padStart(2, '0')}`
      cards.set(id, makeCard({ id, status: 'decided' }))
      events.push(
        makeEvent({
          id: `e-${String(i).padStart(2, '0')}`,
          description: humanDescription(id),
        }),
      )
    }
    events.push(makeEvent({ id: 'e-closed-1', title: '✅ done' }))
    events.push(makeEvent({ id: 'e-closed-2', title: '❌ failed' }))

    const out = classifyEvents(makeInput({ events, cards }))
    expect(out.candidates).toBe(37)
    expect(out.deferred).toBe(35 - MAX_EVENTS_PER_RUN)

    const actionable = out.decisions.filter((d) => d.tier === 'auto' || d.tier === 'human')
    expect(actionable).toHaveLength(MAX_EVENTS_PER_RUN)

    const closed = out.decisions.filter((d) => d.tier === 'closed')
    expect(closed).toHaveLength(2)
  })

  it('no_ledger events never count against the limit and never starve ledger-linked ones', () => {
    const events: CalendarEvent[] = []
    for (let i = 0; i < 40; i++) {
      events.push(makeEvent({ id: `old-${String(i).padStart(2, '0')}`, startNz: '2026-09-25', description: '' }))
    }
    const id = '2026-10-07-linked'
    const cards = new Map([[id, makeCard({ id, status: 'decided' })]])
    events.push(makeEvent({ id: 'linked', startNz: '2026-10-07', description: humanDescription(id) }))

    const out = classifyEvents(makeInput({ events, cards }))
    expect(out.deferred).toBe(0)
    expect(out.decisions[0].eventId).toBe('linked')
    expect(out.decisions.filter((d) => d.tier === 'no_ledger')).toHaveLength(40)
  })

  it('sorts actionable by dueNz then eventId, closed/covered after', () => {
    const id = '2026-10-01-sort'
    const cards = new Map([[id, makeCard({ id, status: 'decided' })]])
    const events = [
      makeEvent({ id: 'e-b', startNz: '2026-10-05', description: humanDescription(id) }),
      makeEvent({ id: 'e-a', startNz: '2026-10-05', description: humanDescription(id) }),
      makeEvent({ id: 'e-c', startNz: '2026-10-01', description: humanDescription(id) }),
      makeEvent({ id: 'e-closed', startNz: '2026-10-02', title: '✅ done' }),
    ]
    const out = classifyEvents(makeInput({ events, cards }))
    expect(out.decisions.map((d) => d.eventId)).toEqual([
      'e-c',
      'e-a',
      'e-b',
      'e-closed',
    ])
  })
})
