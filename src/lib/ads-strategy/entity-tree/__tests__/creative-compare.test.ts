import { describe, it, expect } from 'vitest'
import {
  resultsOf,
  judgeCreative,
  judgeCreatives,
  audienceKeyOf,
  audienceChangedOn,
  type CreativeInput,
  type AudienceSnapshot,
} from '../creative-compare'

function ad(over: Partial<CreativeInput> = {}): CreativeInput {
  return {
    spend: 100,
    leads: 10,
    messagingConversations: 20,
    linkClicks: 200,
    linkClicksStored: true,
    ...over,
  }
}

describe('resultsOf', () => {
  it('lead ad set uses leads', () => {
    expect(resultsOf({ leads: 7, messagingConversations: 99 }, 'lead')).toBe(7)
  })

  it('messaging ad set uses conversations and ignores leads', () => {
    expect(resultsOf({ leads: 7, messagingConversations: 99 }, 'messaging_started')).toBe(99)
  })

  it('null result type yields null', () => {
    expect(resultsOf({ leads: 7, messagingConversations: 99 }, null)).toBeNull()
  })
})

describe('judgeCreative', () => {
  it('lead ad set: costPerResult = spend / leads', () => {
    const v = judgeCreative(ad({ spend: 100, leads: 10 }), {
      resultType: 'lead',
      minLinkClicks: 150,
      siblingsWithSpend: 2,
    })
    expect(v.results).toBe(10)
    expect(v.costPerResult).toBe(10)
    expect(v.comparability).toBe('enough')
  })

  it('messaging ad set: results = conversations', () => {
    const v = judgeCreative(ad({ spend: 100, leads: 999, messagingConversations: 25 }), {
      resultType: 'messaging_started',
      minLinkClicks: 150,
      siblingsWithSpend: 2,
    })
    expect(v.results).toBe(25)
    expect(v.costPerResult).toBe(4)
  })

  it('null result type wins even with only one sibling', () => {
    const v = judgeCreative(ad(), { resultType: null, minLinkClicks: 150, siblingsWithSpend: 1 })
    expect(v.comparability).toBe('no_result_type')
    expect(v.results).toBeNull()
    expect(v.costPerResult).toBeNull()
  })

  it('only one sibling with spend -> only_one', () => {
    const verdicts = judgeCreatives(
      [ad({ spend: 100 }), ad({ spend: 0 })],
      'lead',
      150,
    )
    expect(verdicts[0].comparability).toBe('only_one')
    expect(verdicts[1].comparability).toBe('only_one')
  })

  it('null threshold -> no_threshold', () => {
    const v = judgeCreative(ad(), { resultType: 'lead', minLinkClicks: null, siblingsWithSpend: 2 })
    expect(v.comparability).toBe('no_threshold')
  })

  it('clicks not stored -> clicks_not_stored and linkClicks null', () => {
    const v = judgeCreative(ad({ linkClicksStored: false }), {
      resultType: 'lead',
      minLinkClicks: 150,
      siblingsWithSpend: 2,
    })
    expect(v.comparability).toBe('clicks_not_stored')
    expect(v.linkClicks).toBeNull()
  })

  it('149 clicks with threshold 150 -> too_few_clicks', () => {
    const v = judgeCreative(ad({ linkClicks: 149 }), {
      resultType: 'lead',
      minLinkClicks: 150,
      siblingsWithSpend: 2,
    })
    expect(v.comparability).toBe('too_few_clicks')
  })

  it('exactly 150 clicks -> enough', () => {
    const v = judgeCreative(ad({ linkClicks: 150 }), {
      resultType: 'lead',
      minLinkClicks: 150,
      siblingsWithSpend: 2,
    })
    expect(v.comparability).toBe('enough')
  })

  it('zero results -> costPerResult null', () => {
    const v = judgeCreative(ad({ leads: 0 }), {
      resultType: 'lead',
      minLinkClicks: 150,
      siblingsWithSpend: 2,
    })
    expect(v.results).toBe(0)
    expect(v.costPerResult).toBeNull()
  })
})

describe('audienceKeyOf', () => {
  it('array order does not matter', () => {
    const a = audienceKeyOf({ included: ['x', 'y'], excluded: null, targeting: null, advantage: null })
    const b = audienceKeyOf({ included: ['y', 'x'], excluded: null, targeting: null, advantage: null })
    expect(a).toBe(b)
  })

  it('nested object key order does not matter', () => {
    const a = audienceKeyOf({
      included: null,
      excluded: null,
      targeting: { age: { min: 18, max: 65 }, geo: 'US' },
      advantage: null,
    })
    const b = audienceKeyOf({
      included: null,
      excluded: null,
      targeting: { geo: 'US', age: { max: 65, min: 18 } },
      advantage: null,
    })
    expect(a).toBe(b)
  })

  it('all-null parts -> null', () => {
    expect(
      audienceKeyOf({ included: null, excluded: null, targeting: null, advantage: null }),
    ).toBeNull()
  })

  it('different included ids -> different keys', () => {
    const a = audienceKeyOf({ included: ['x'], excluded: null, targeting: null, advantage: null })
    const b = audienceKeyOf({ included: ['z'], excluded: null, targeting: null, advantage: null })
    expect(a).not.toBe(b)
  })
})

describe('audienceChangedOn', () => {
  const row = (capturedAt: string, audienceKey: string | null): AudienceSnapshot => ({
    capturedAt,
    audienceKey,
  })

  it('no change -> null', () => {
    const rows = [row('2024-03-04T00:00:00Z', 'a'), row('2024-03-06T00:00:00Z', 'a')]
    expect(audienceChangedOn(rows, '2024-03-04', '2024-03-10')).toBeNull()
  })

  it('change inside window is reported on its day', () => {
    const rows = [row('2024-03-04T00:00:00Z', 'a'), row('2024-03-07T00:00:00Z', 'b')]
    expect(audienceChangedOn(rows, '2024-03-04', '2024-03-10')).toBe('2024-03-07')
  })

  it('change only before window -> null', () => {
    const rows = [row('2024-03-01T00:00:00Z', 'a'), row('2024-03-02T00:00:00Z', 'b')]
    expect(audienceChangedOn(rows, '2024-03-04', '2024-03-10')).toBeNull()
  })

  it('baseline before window differing from first in-window row is reported', () => {
    const rows = [row('2024-03-02T00:00:00Z', 'a'), row('2024-03-05T00:00:00Z', 'b')]
    expect(audienceChangedOn(rows, '2024-03-04', '2024-03-10')).toBe('2024-03-05')
  })

  it('null keys are skipped', () => {
    const rows = [
      row('2024-03-04T00:00:00Z', 'a'),
      row('2024-03-05T00:00:00Z', null),
      row('2024-03-06T00:00:00Z', 'a'),
    ]
    expect(audienceChangedOn(rows, '2024-03-04', '2024-03-10')).toBeNull()
  })

  it('rows given out of order still work', () => {
    const rows = [row('2024-03-07T00:00:00Z', 'b'), row('2024-03-04T00:00:00Z', 'a')]
    expect(audienceChangedOn(rows, '2024-03-04', '2024-03-10')).toBe('2024-03-07')
  })

  it('change after until -> null', () => {
    const rows = [row('2024-03-04T00:00:00Z', 'a'), row('2024-03-12T00:00:00Z', 'b')]
    expect(audienceChangedOn(rows, '2024-03-04', '2024-03-10')).toBeNull()
  })
})
