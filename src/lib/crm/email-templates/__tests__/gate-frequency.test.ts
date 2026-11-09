import { describe, expect, it, vi } from 'vitest'
import {
  DEDUPE_WINDOW_MS,
  dedupeItems,
  evaluateFrequency,
  nextAllowedAt,
  normalizeSubjectForDedupe,
} from '@/lib/crm/email-templates/gates/frequency'
import type {
  FrequencySources,
  OutboundItem,
  SourceResult,
} from '@/lib/crm/email-templates/gates/types'

const DAY = 86_400_000
const MIN = 60_000

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

function item(partial: Partial<OutboundItem> & { at: string }): OutboundItem {
  return {
    source: 'audit',
    id: null,
    subject: null,
    address: 'guest@example.com',
    ...partial,
  }
}

type Overrides = Partial<{
  sentItems: () => Promise<SourceResult>
  audit: () => Promise<SourceResult>
  touchpoints: () => Promise<SourceResult>
  mailchimp: () => Promise<SourceResult>
  meSends: FrequencySources['meSends']
}>

function sources(overrides: Overrides = {}): FrequencySources {
  const empty = async (): Promise<SourceResult> => ({ ok: true, items: [] })
  return {
    sentItems: overrides.sentItems ?? empty,
    audit: overrides.audit ?? empty,
    touchpoints: overrides.touchpoints ?? empty,
    mailchimp: overrides.mailchimp ?? empty,
    meSends: overrides.meSends ?? empty,
  }
}

const CAP = { max: 2, windowDays: 7 }
const ADDR = ['guest@example.com']

function run(s: FrequencySources, cap = CAP) {
  return evaluateFrequency({
    cap,
    now: new Date(),
    addresses: ADDR,
    contactId: 'c1',
    sources: s,
  })
}

describe('normalizeSubjectForDedupe', () => {
  it('trims, collapses, lower-cases and strips prefixes', () => {
    expect(normalizeSubjectForDedupe('  Re:  Hello   World ')).toBe('hello world')
    expect(normalizeSubjectForDedupe('FW: Re: hi')).toBe('hi')
    expect(normalizeSubjectForDedupe(null)).toBe('')
  })
})

describe('dedupeItems', () => {
  it('dedupes equal ids', () => {
    const a = item({ at: ago(1000), id: 'x' })
    const b = item({ at: ago(5000), id: 'x', source: 'sent_items' })
    expect(dedupeItems([a, b])).toHaveLength(1)
  })

  it('dedupes the same mail seen by two sources: same address, within the window, same subject', () => {
    const a = item({ at: ago(60_000), subject: 'hi', source: 'sent_items' })
    const b = item({ at: ago(0), subject: 'hi', source: 'touchpoint' })
    expect(dedupeItems([a, b])).toHaveLength(1)
  })

  it('keeps different subjects apart', () => {
    const a = item({ at: ago(60_000), subject: 'hi' })
    const b = item({ at: ago(0), subject: 'bye' })
    expect(dedupeItems([a, b])).toHaveLength(2)
  })

  it('keeps items more than DEDUPE_WINDOW_MS apart', () => {
    const a = item({ at: ago(3 * MIN), subject: 'hi' })
    const b = item({ at: ago(0), subject: 'hi' })
    expect(DEDUPE_WINDOW_MS).toBe(120_000)
    expect(dedupeItems([a, b])).toHaveLength(2)
  })

  it('dedupes across sources when one side has no subject (audit rows and touchpoints never have one)', () => {
    const a = item({ at: ago(60_000), subject: null, source: 'audit' })
    const b = item({ at: ago(0), subject: 'hi', source: 'sent_items' })
    expect(dedupeItems([a, b])).toHaveLength(1)
    const c = item({ at: ago(60_000), subject: null, source: 'audit' })
    const d = item({ at: ago(0), subject: null, source: 'touchpoint' })
    expect(dedupeItems([c, d])).toHaveLength(1)
  })

  it('dedupes re: hello with hello across sources', () => {
    const a = item({ at: ago(60_000), subject: 're: hello', source: 'sent_items' })
    const b = item({ at: ago(0), subject: 'hello', source: 'touchpoint' })
    expect(dedupeItems([a, b])).toHaveLength(1)
  })

  describe('two real mails are never folded into one', () => {
    it('two sent-items entries with different ids, same subject, a minute apart', () => {
      const a = item({ at: ago(60_000), id: 'A', subject: 'Following up', source: 'sent_items' })
      const b = item({ at: ago(0), id: 'B', subject: 'Following up', source: 'sent_items' })
      expect(dedupeItems([a, b])).toHaveLength(2)
    })

    it('two audit rows with no ids and no subjects, thirty seconds apart', () => {
      const a = item({ at: ago(30_000), source: 'audit' })
      const b = item({ at: ago(0), source: 'audit' })
      expect(dedupeItems([a, b])).toHaveLength(2)
    })

    it('two Mailchimp campaigns sent within the window', () => {
      const a = item({ at: ago(30_000), id: 'mc:1:guest@example.com', subject: 'News', source: 'mailchimp' })
      const b = item({ at: ago(0), id: 'mc:2:guest@example.com', subject: 'News', source: 'mailchimp' })
      expect(dedupeItems([a, b])).toHaveLength(2)
    })

    it('a mailbox entry and an audit row with DIFFERENT Graph ids are different mails, even a minute apart', () => {
      const a = item({ at: ago(60_000), id: 'A', subject: 'Hello', source: 'sent_items' })
      const b = item({ at: ago(0), id: 'B', subject: null, source: 'audit' })
      expect(dedupeItems([a, b])).toHaveLength(2)
    })

    it('the same Graph id in the mailbox and in our audit row is one mail', () => {
      const a = item({ at: ago(60_000), id: 'A', subject: 'Hello', source: 'sent_items' })
      const b = item({ at: ago(0), id: 'A', subject: null, source: 'audit' })
      expect(dedupeItems([a, b])).toHaveLength(1)
    })

    it('two mails each seen by the mailbox AND by our audit rows still count as two', () => {
      const items = [
        item({ at: ago(70_000), id: 'A', subject: 'Hello', source: 'sent_items' }),
        item({ at: ago(60_000), id: 'A', subject: null, source: 'audit' }),
        item({ at: ago(10_000), id: 'B', subject: 'Hello', source: 'sent_items' }),
        item({ at: ago(0), id: 'B', subject: null, source: 'audit' }),
      ]
      expect(dedupeItems(items)).toHaveLength(2)
    })
  })

  it('touchpoint records of one mail (written at send time and again by the mailbox sync) still fold together', () => {
    const a = item({ at: ago(30_000), source: 'touchpoint' })
    const b = item({ at: ago(0), source: 'touchpoint' })
    expect(dedupeItems([a, b])).toHaveLength(1)
  })
})

describe('nextAllowedAt', () => {
  it('uses the (count - max)th oldest item', () => {
    const items = [
      item({ at: ago(3 * DAY) }),
      item({ at: ago(2 * DAY) }),
      item({ at: ago(1 * DAY) }),
    ]
    const expected = new Date(Date.parse(items[1].at) + 7 * DAY).toISOString()
    expect(nextAllowedAt(items, CAP)).toBe(expected)
  })
})

describe('evaluateFrequency', () => {
  it('returns ok with zero items', async () => {
    const v = await run(sources())
    expect(v).toEqual({ ok: true, count: 0, items: [] })
  })

  it('returns ok with one item', async () => {
    const v = await run(
      sources({ audit: async () => ({ ok: true, items: [item({ at: ago(DAY) })] }) }),
    )
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.count).toBe(1)
  })

  it('caps at two items and reports nextAllowedAt = oldest + 7d', async () => {
    const oldest = item({ at: ago(2 * DAY) })
    const newer = item({ at: ago(DAY) })
    const v = await run(
      sources({ audit: async () => ({ ok: true, items: [oldest, newer] }) }),
    )
    expect(v).toMatchObject({
      ok: false,
      reason: 'frequency_cap',
      count: 2,
      nextAllowedAt: new Date(Date.parse(oldest.at) + 7 * DAY).toISOString(),
    })
  })

  it('with three items uses second-oldest for nextAllowedAt', async () => {
    const a = item({ at: ago(3 * DAY) })
    const b = item({ at: ago(2 * DAY) })
    const c = item({ at: ago(DAY) })
    const v = await run(
      sources({ audit: async () => ({ ok: true, items: [a, b, c] }) }),
    )
    expect(v).toMatchObject({
      ok: false,
      reason: 'frequency_cap',
      count: 3,
      nextAllowedAt: new Date(Date.parse(b.at) + 7 * DAY).toISOString(),
    })
  })

  it('counts an item 6d 23h 59m old', async () => {
    const at = ago(7 * DAY - MIN)
    const v = await run(
      sources({ audit: async () => ({ ok: true, items: [item({ at })] }) }),
    )
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.count).toBe(1)
  })

  it('ignores an item 7d 1m old even if a source returns it', async () => {
    const at = ago(7 * DAY + MIN)
    const v = await run(
      sources({ audit: async () => ({ ok: true, items: [item({ at })] }) }),
    )
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.count).toBe(0)
  })

  it('ignores items for a different address', async () => {
    const v = await run(
      sources({
        audit: async () => ({
          ok: true,
          items: [item({ at: ago(DAY), address: 'other@example.com' })],
        }),
      }),
    )
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.count).toBe(0)
  })

  it('matches addresses case-insensitively', async () => {
    const v = await run(
      sources({
        audit: async () => ({
          ok: true,
          items: [item({ at: ago(DAY), address: 'GUEST@Example.com' })],
        }),
      }),
    )
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.count).toBe(1)
  })

  it('dedupes the same message reported by two sources', async () => {
    const at = ago(DAY)
    const v = await run(
      sources({
        audit: async () => ({ ok: true, items: [item({ at, id: 'm1' })] }),
        sentItems: async () => ({
          ok: true,
          items: [item({ at, id: 'm1', source: 'sent_items' })],
        }),
      }),
    )
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.count).toBe(1)
  })

  it('dedupes the same mail reported by two sources, 60s apart, same subject', async () => {
    const v = await run(
      sources({
        sentItems: async () => ({ ok: true, items: [item({ at: ago(60_000), subject: 'hi', source: 'sent_items' })] }),
        touchpoints: async () => ({ ok: true, items: [item({ at: ago(0), subject: 'hi', source: 'touchpoint' })] }),
      }),
    )
    expect(v).toMatchObject({ ok: true, count: 1 })
  })

  it('counts two audit rows 60s apart as two mails (one send = one row)', async () => {
    const v = await run(
      sources({
        audit: async () => ({ ok: true, items: [item({ at: ago(60_000), subject: 'hi' }), item({ at: ago(0), subject: 'hi' })] }),
      }),
      { max: 5, windowDays: 7 },
    )
    expect(v).toMatchObject({ ok: true, count: 2 })
  })

  it('counts same address 60s apart with different subjects twice', async () => {
    const v = await run(
      sources({
        audit: async () => ({
          ok: true,
          items: [
            item({ at: ago(60_000), subject: 'hi' }),
            item({ at: ago(0), subject: 'bye' }),
          ],
        }),
      }),
      { max: 5, windowDays: 7 },
    )
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.count).toBe(2)
  })

  it('counts same address 3 min apart twice', async () => {
    const v = await run(
      sources({
        audit: async () => ({
          ok: true,
          items: [
            item({ at: ago(3 * MIN), subject: 'hi' }),
            item({ at: ago(0), subject: 'hi' }),
          ],
        }),
      }),
      { max: 5, windowDays: 7 },
    )
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.count).toBe(2)
  })

  it('dedupes a subject-less audit row with the mailbox entry of the same mail 60s apart', async () => {
    const v = await run(
      sources({
        audit: async () => ({ ok: true, items: [item({ at: ago(60_000), subject: null })] }),
        sentItems: async () => ({ ok: true, items: [item({ at: ago(0), subject: 'hi', source: 'sent_items' })] }),
      }),
    )
    expect(v).toMatchObject({ ok: true, count: 1 })
  })

  it('dedupes re: hello with hello across sources', async () => {
    const v = await run(
      sources({
        sentItems: async () => ({ ok: true, items: [item({ at: ago(60_000), subject: 're: hello', source: 'sent_items' })] }),
        touchpoints: async () => ({ ok: true, items: [item({ at: ago(0), subject: 'hello', source: 'touchpoint' })] }),
      }),
    )
    expect(v).toMatchObject({ ok: true, count: 1 })
  })

  it.each([
    ['sentItems', 'sentItems'],
    ['audit', 'audit'],
    ['touchpoints', 'touchpoints'],
    ['mailchimp', 'mailchimp'],
  ] as const)('fails when %s fails', async (_label, key) => {
    const failing = async (): Promise<SourceResult> => ({
      ok: false,
      error: `${key} down`,
    })
    const v = await run(sources({ [key]: failing }))
    expect(v).toEqual({ ok: false, reason: 'frequency_unverifiable', error: `${key} down` })
  })

  it('fails when a source throws', async () => {
    const v = await run(
      sources({
        audit: async () => {
          throw new Error('boom')
        },
      }),
    )
    expect(v).toEqual({ ok: false, reason: 'frequency_unverifiable', error: 'boom' })
  })

  it('times out when a source never resolves', async () => {
    const v = await evaluateFrequency({
      cap: CAP,
      now: new Date(),
      addresses: ADDR,
      contactId: 'c1',
      sources: sources({
        audit: () => new Promise<SourceResult>(() => {}),
      }),
      budgetMs: 50,
    })
    expect(v).toEqual({ ok: false, reason: 'frequency_unverifiable', error: 'timeout' })
  })

  it('treats mailchimp applicable:false as contributing nothing', async () => {
    const v = await run(
      sources({
        mailchimp: async () => ({ ok: true, items: [], applicable: false }),
      }),
    )
    expect(v).toEqual({ ok: true, count: 0, items: [] })
  })

  it('ignores a far-future item', async () => {
    const at = new Date(Date.now() + DAY).toISOString()
    const v = await run(
      sources({ audit: async () => ({ ok: true, items: [item({ at })] }) }),
    )
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.count).toBe(0)
  })

  it('counts an item with an unparsable at', async () => {
    const v = await run(
      sources({
        audit: async () => ({ ok: true, items: [item({ at: 'not-a-date' })] }),
      }),
    )
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.count).toBe(1)
  })

  it('calls sources with addresses, contactId and a since about windowDays ago', async () => {
    const calls: { since: string }[] = []
    const capture = async (
      _a: readonly string[],
      since: string,
    ): Promise<SourceResult> => {
      calls.push({ since })
      return { ok: true, items: [] }
    }
    const captureContact = async (
      _c: string,
      since: string,
    ): Promise<SourceResult> => {
      calls.push({ since })
      return { ok: true, items: [] }
    }
    const before = Date.now()
    await evaluateFrequency({
      cap: CAP,
      now: new Date(),
      addresses: ADDR,
      contactId: 'c1',
      sources: {
        sentItems: capture,
        audit: captureContact,
        touchpoints: captureContact,
        mailchimp: capture,
        meSends: capture,
      },
    })
    const after = Date.now()
    expect(calls).toHaveLength(5)
    for (const c of calls) {
      const t = Date.parse(c.since)
      const expectedMin = before - 7 * DAY - 5000
      const expectedMax = after - 7 * DAY + 5000
      expect(t).toBeGreaterThanOrEqual(expectedMin)
      expect(t).toBeLessThanOrEqual(expectedMax)
    }
  })
})

describe('dedupe by message id', () => {
  it('the same Graph message id is one email even when the sources disagree on time by minutes', () => {
    const items = dedupeItems([
      item({ source: 'audit', id: 'msg-1', at: ago(10 * MIN), subject: null }),
      item({ source: 'sent_items', id: 'msg-1', at: ago(0), subject: 'Your itinerary' }),
    ])
    expect(items).toHaveLength(1)
  })

  it('different ids far apart in time stay separate', () => {
    const items = dedupeItems([
      item({ id: 'msg-1', at: ago(10 * MIN), subject: 'a' }),
      item({ id: 'msg-2', at: ago(0), subject: 'b' }),
    ])
    expect(items).toHaveLength(2)
  })
})

describe('contact-scoped items (audit rows and touchpoints carry no address)', () => {
  it('an item with an empty address counts for the primary address', async () => {
    const v = await run(
      sources({ audit: async () => ({ ok: true, items: [item({ at: ago(MIN), address: '' })] }) }),
      { max: 5, windowDays: 7 },
    )
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.count).toBe(1)
  })

  it('and dedupes against the same message reported by sent items for the primary address', async () => {
    const at = ago(MIN)
    const v = await run(
      sources({
        audit: async () => ({ ok: true, items: [item({ at, address: '', subject: null })] }),
        sentItems: async () => ({ ok: true, items: [item({ source: 'sent_items', at, subject: 'Your itinerary' })] }),
      }),
      { max: 5, windowDays: 7 },
    )
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.count).toBe(1)
  })

  it('still counts toward the cap', async () => {
    const v = await run(
      sources({
        touchpoints: async () => ({
          ok: true,
          items: [item({ at: ago(5 * MIN), address: '', subject: 'a' }), item({ at: ago(MIN), address: '', subject: 'b' })],
        }),
      }),
    )
    expect(v.ok).toBe(false)
  })
})

describe('evaluateFrequency: exempt mails (loadExemptIds)', () => {
  const G = 'graph-exempt-1'
  const H1 = 'graph-normal-1'
  const H2 = 'graph-normal-2'

  function runWith(
    s: FrequencySources,
    loadExemptIds: (sinceIso: string) => Promise<readonly string[]>,
    cap = CAP,
    now = new Date(),
  ) {
    return evaluateFrequency({
      cap,
      now,
      addresses: ADDR,
      contactId: 'c1',
      sources: s,
      loadExemptIds,
    })
  }

  it('without a loader the exempt mail counts like any other', async () => {
    const v = await evaluateFrequency({
      cap: CAP,
      now: new Date(),
      addresses: ADDR,
      contactId: 'c1',
      sources: sources({
        sentItems: async () => ({
          ok: true,
          items: [
            item({ source: 'sent_items', id: H1, at: ago(1 * DAY) }),
            item({ source: 'sent_items', id: G, at: ago(2 * DAY) }),
          ],
        }),
      }),
    })
    expect(v).toMatchObject({ ok: false, reason: 'frequency_cap', count: 2 })
  })

  it('an exempt mail neither counts nor uses up a place', async () => {
    const v = await runWith(
      sources({
        sentItems: async () => ({
          ok: true,
          items: [
            item({ source: 'sent_items', id: H1, at: ago(1 * DAY) }),
            item({ source: 'sent_items', id: G, at: ago(2 * DAY) }),
          ],
        }),
      }),
      async () => [G],
    )
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.count).toBe(1)
      expect(v.items.map((i) => i.id)).toEqual([H1])
    }
  })

  it('the same exempt mail is left out wherever it shows up', async () => {
    const v = await runWith(
      sources({
        sentItems: async () => ({
          ok: true,
          items: [
            item({ source: 'sent_items', id: G, at: ago(2 * DAY) }),
            item({ source: 'sent_items', id: H1, at: ago(1 * DAY) }),
          ],
        }),
        audit: async () => ({
          ok: true,
          items: [item({ source: 'audit', id: G, at: ago(2 * DAY), address: '' })],
        }),
        touchpoints: async () => ({
          ok: true,
          items: [item({ source: 'touchpoint', id: G, at: ago(2 * DAY), address: '' })],
        }),
      }),
      async () => [G],
    )
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.count).toBe(1)
  })

  it('two normal mails still reach the cap even with an exempt mail around', async () => {
    const v = await runWith(
      sources({
        sentItems: async () => ({
          ok: true,
          items: [
            item({ source: 'sent_items', id: H1, at: ago(1 * DAY) }),
            item({ source: 'sent_items', id: H2, at: ago(2 * DAY) }),
            item({ source: 'sent_items', id: G, at: ago(3 * DAY) }),
          ],
        }),
      }),
      async () => [G],
    )
    expect(v).toMatchObject({ ok: false, reason: 'frequency_cap', count: 2 })
  })

  it('a record without an id still counts', async () => {
    const v = await runWith(
      sources({
        touchpoints: async () => ({
          ok: true,
          items: [item({ source: 'touchpoint', id: null, at: ago(1 * DAY), address: '' })],
        }),
        sentItems: async () => ({
          ok: true,
          items: [item({ source: 'sent_items', id: H1, at: ago(2 * DAY) })],
        }),
      }),
      async () => [G],
    )
    expect(v).toMatchObject({ ok: false, reason: 'frequency_cap', count: 2 })
  })

  it('an id nobody has sent has no effect', async () => {
    const v = await runWith(
      sources({
        sentItems: async () => ({
          ok: true,
          items: [item({ source: 'sent_items', id: H1, at: ago(1 * DAY) })],
        }),
      }),
      async () => ['graph-unknown'],
    )
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.count).toBe(1)
  })

  it('a loader that throws makes the count unverifiable and names the cause', async () => {
    const v = await runWith(
      sources(),
      async () => {
        throw new Error('db down')
      },
    )
    expect(v).toMatchObject({
      ok: false,
      reason: 'frequency_unverifiable',
      error: expect.stringContaining('exempt ids'),
    })
    expect(v).toMatchObject({ error: expect.stringContaining('db down') })
  })

  it('a loader that rejects with a plain string is still unverifiable', async () => {
    const v = await runWith(sources(), () => Promise.reject('plain'))
    expect(v).toMatchObject({
      ok: false,
      reason: 'frequency_unverifiable',
      error: expect.stringContaining('exempt ids'),
    })
  })

  it('the loader is asked from the start of the window', async () => {
    const now = new Date('2026-10-28T02:00:00.000Z')
    const loadExemptIds = vi.fn(async () => [] as readonly string[])
    await runWith(sources(), loadExemptIds, { max: 2, windowDays: 7 }, now)
    expect(loadExemptIds).toHaveBeenCalledTimes(1)
    expect(loadExemptIds).toHaveBeenCalledWith(
      new Date(now.getTime() - 7 * DAY).toISOString(),
    )
  })

  it('the next free time is worked out from the mails that count', async () => {
    const h1 = item({ source: 'sent_items', id: H1, at: ago(1 * DAY) })
    const v = await runWith(
      sources({
        sentItems: async () => ({
          ok: true,
          items: [h1, item({ source: 'sent_items', id: G, at: ago(5 * DAY) })],
        }),
      }),
      async () => [G],
      { max: 1, windowDays: 7 },
    )
    expect(v).toMatchObject({
      ok: false,
      reason: 'frequency_cap',
      count: 1,
      nextAllowedAt: new Date(Date.parse(h1.at) + 7 * DAY).toISOString(),
    })
  })

  it('a counted mail seen only as a touchpoint 30 s after an exempt mail still counts', async () => {
    const now = new Date()
    const t0 = now.getTime() - 1 * DAY
    const v = await runWith(
      sources({
        sentItems: async () => ({
          ok: true,
          items: [
            item({
              source: 'sent_items',
              id: 'graph-exempt-1',
              at: new Date(t0).toISOString(),
              subject: 'Re: your tour question',
              address: ADDR[0],
            }),
          ],
        }),
        touchpoints: async () => ({
          ok: true,
          items: [
            item({
              source: 'touchpoint',
              id: 'other-ref',
              at: new Date(t0 + 30_000).toISOString(),
              subject: null,
              address: '',
            }),
          ],
        }),
      }),
      async () => ['graph-exempt-1'],
      { max: 1, windowDays: 7 },
      now,
    )
    // reading A keeps the touchpoint; reading B alone would fold it into the exempt mail
    expect(v).toMatchObject({ ok: false, reason: 'frequency_cap', count: 1 })
  })

  it('a stray audit row of the exempt mail cannot swallow two real mailings', async () => {
    const now = new Date()
    const t0 = now.getTime() - 1 * DAY
    const s = sources({
      sentItems: async () => ({
        ok: true,
        items: [
          item({
            source: 'sent_items',
            id: 'graph-exempt-1',
            at: new Date(t0).toISOString(),
            subject: 'Re: your tour question',
            address: ADDR[0],
          }),
        ],
      }),
      audit: async () => ({
        ok: true,
        items: [
          item({
            source: 'audit',
            id: null,
            at: new Date(t0 + 5_000).toISOString(),
            subject: null,
            address: '',
          }),
        ],
      }),
      mailchimp: async () => ({
        ok: true,
        items: [
          item({
            source: 'mailchimp',
            id: 'mc:c1:guest@example.com',
            at: new Date(t0 + 30_000).toISOString(),
            subject: 'News one',
            address: ADDR[0],
          }),
          item({
            source: 'mailchimp',
            id: 'mc:c2:guest@example.com',
            at: new Date(t0 + 60_000).toISOString(),
            subject: 'News two',
            address: ADDR[0],
          }),
        ],
      }),
    })

    const withoutLoader = await evaluateFrequency({
      cap: { max: 2, windowDays: 7 },
      now,
      addresses: ADDR,
      contactId: 'c1',
      sources: s,
    })
    expect(withoutLoader).toMatchObject({
      ok: false,
      reason: 'frequency_cap',
      count: 3,
    })

    const withLoader = await runWith(
      s,
      async () => ['graph-exempt-1'],
      { max: 2, windowDays: 7 },
      now,
    )
    // reading A alone would give 1 and let a third mail through
    expect(withLoader).toMatchObject({
      ok: false,
      reason: 'frequency_cap',
      count: 2,
    })
  })

  it('a loader that returns something that is not a list of ids makes the count unverifiable', async () => {
    const notAList = await runWith(
      sources(),
      (async () => ({ not: 'a list' })) as never,
    )
    expect(notAList).toMatchObject({
      ok: false,
      reason: 'frequency_unverifiable',
      error: expect.stringContaining('exempt ids'),
    })

    const notStrings = await runWith(
      sources(),
      (async () => [1, 2]) as never,
    )
    expect(notStrings).toMatchObject({
      ok: false,
      reason: 'frequency_unverifiable',
      error: expect.stringContaining('exempt ids'),
    })
  })
})


// ---- ME's own automated mails (send gate P2-2a) ------------------------------------------------------------

describe("ME's automated mails are never folded into another record", () => {
  // One ME mail claimed at t0, and a second, unrelated record within the 120-second window. Every case is two mails.
  const t0 = Date.now() - 10 * MIN
  const meMail = item({ source: 'me_send', id: 'ts-1', at: new Date(t0).toISOString(), subject: 'ME 自动发的信', address: '', automated: true })

  it.each([
    ['a sales mail whose audit row has no subject (90 s later)', item({ source: 'audit', id: null, at: new Date(t0 + 90_000).toISOString(), subject: null, address: '' })],
    ['a human touchpoint without a subject (60 s earlier)', item({ source: 'touchpoint', id: 'M9', at: new Date(t0 - 60_000).toISOString(), subject: null, address: '' })],
    ['a mailbox mail whose subject is only "RE:" (30 s later)', item({ source: 'sent_items', id: 'G1', at: new Date(t0 + 30_000).toISOString(), subject: 'RE:', address: 'guest@example.com' })],
    ['a mailbox mail with an empty subject (10 s later)', item({ source: 'sent_items', id: 'G2', at: new Date(t0 + 10_000).toISOString(), subject: '', address: 'guest@example.com' })],
  ])('%s', async (_label, other) => {
    for (const order of [[meMail, other], [other, meMail]]) {
      expect(dedupeItems(order)).toHaveLength(2)
    }
    const v = await run(
      sources({
        meSends: async () => ({ ok: true, items: [meMail] }),
        audit: async () => ({ ok: true, items: other.source === 'audit' ? [other] : [] }),
        touchpoints: async () => ({ ok: true, items: other.source === 'touchpoint' ? [other] : [] }),
        sentItems: async () => ({ ok: true, items: other.source === 'sent_items' ? [other] : [] }),
      }),
    )
    expect(v.ok === false && v.reason === 'frequency_cap' ? v.count : v.ok ? v.count : -1).toBe(2)
  })

  it('two records of the same ME mail (same id) are still one mail', () => {
    const twin = { ...meMail, at: new Date(t0 + 5 * MIN).toISOString() }
    expect(dedupeItems([meMail, twin])).toHaveLength(1)
  })

  it('a failing ME-mail source makes the count unverifiable, never zero', async () => {
    const v = await run(sources({ meSends: async () => ({ ok: false, error: 'ledger down' }) }))
    expect(v).toMatchObject({ ok: false, reason: 'frequency_unverifiable' })
  })

  it('the ME-mail source is asked with the guest addresses', async () => {
    const meSends = vi.fn<FrequencySources['meSends']>(async () => ({ ok: true, items: [] }))
    await run(sources({ meSends }))
    expect(meSends.mock.calls[0]?.[0]).toEqual(ADDR)
  })
})
