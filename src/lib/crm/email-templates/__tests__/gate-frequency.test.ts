import { describe, expect, it } from 'vitest'
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
}>

function sources(overrides: Overrides = {}): FrequencySources {
  const empty = async (): Promise<SourceResult> => ({ ok: true, items: [] })
  return {
    sentItems: overrides.sentItems ?? empty,
    audit: overrides.audit ?? empty,
    touchpoints: overrides.touchpoints ?? empty,
    mailchimp: overrides.mailchimp ?? empty,
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

  it('dedupes same address within window with same subject', () => {
    const a = item({ at: ago(60_000), subject: 'hi' })
    const b = item({ at: ago(0), subject: 'hi' })
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

  it('dedupes when one subject is null', () => {
    const a = item({ at: ago(60_000), subject: null })
    const b = item({ at: ago(0), subject: 'hi' })
    expect(dedupeItems([a, b])).toHaveLength(1)
  })

  it('dedupes re: hello with hello', () => {
    const a = item({ at: ago(60_000), subject: 're: hello' })
    const b = item({ at: ago(0), subject: 'hello' })
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
    expect(v.ok).toBe(false)
    if (!v.ok && v.reason === 'frequency_cap') {
      expect(v.count).toBe(2)
      expect(v.nextAllowedAt).toBe(
        new Date(Date.parse(oldest.at) + 7 * DAY).toISOString(),
      )
    }
  })

  it('with three items uses second-oldest for nextAllowedAt', async () => {
    const a = item({ at: ago(3 * DAY) })
    const b = item({ at: ago(2 * DAY) })
    const c = item({ at: ago(DAY) })
    const v = await run(
      sources({ audit: async () => ({ ok: true, items: [a, b, c] }) }),
    )
    expect(v.ok).toBe(false)
    if (!v.ok && v.reason === 'frequency_cap') {
      expect(v.count).toBe(3)
      expect(v.nextAllowedAt).toBe(
        new Date(Date.parse(b.at) + 7 * DAY).toISOString(),
      )
    }
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

  it('dedupes same address 60s apart with same subject', async () => {
    const v = await run(
      sources({
        audit: async () => ({
          ok: true,
          items: [
            item({ at: ago(60_000), subject: 'hi' }),
            item({ at: ago(0), subject: 'hi' }),
          ],
        }),
      }),
    )
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.count).toBe(1)
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

  it('dedupes null subject with 60s-apart item', async () => {
    const v = await run(
      sources({
        audit: async () => ({
          ok: true,
          items: [
            item({ at: ago(60_000), subject: null }),
            item({ at: ago(0), subject: 'hi' }),
          ],
        }),
      }),
    )
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.count).toBe(1)
  })

  it('dedupes re: hello with hello', async () => {
    const v = await run(
      sources({
        audit: async () => ({
          ok: true,
          items: [
            item({ at: ago(60_000), subject: 're: hello' }),
            item({ at: ago(0), subject: 'hello' }),
          ],
        }),
      }),
    )
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.count).toBe(1)
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
    expect(v.ok).toBe(false)
    if (!v.ok && v.reason === 'frequency_unverifiable') {
      expect(v.error).toBe(`${key} down`)
    }
  })

  it('fails when a source throws', async () => {
    const v = await run(
      sources({
        audit: async () => {
          throw new Error('boom')
        },
      }),
    )
    expect(v.ok).toBe(false)
    if (!v.ok && v.reason === 'frequency_unverifiable') {
      expect(v.error).toBe('boom')
    }
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
    expect(v.ok).toBe(false)
    if (!v.ok && v.reason === 'frequency_unverifiable') {
      expect(v.error).toBe('timeout')
    }
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
      },
    })
    const after = Date.now()
    expect(calls).toHaveLength(4)
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
