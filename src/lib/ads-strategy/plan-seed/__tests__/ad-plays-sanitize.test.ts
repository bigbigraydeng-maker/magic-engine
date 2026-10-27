import { describe, it, expect } from 'vitest'
import { sanitizeSeedAdPlays, parseAdPlays, PLAY_KEYS } from '../ad-plays'

describe('sanitizeSeedAdPlays', () => {
  it('returns the same two-field array for a valid list, preserving order', () => {
    const input = [
      { step_key: 'phase1-a', play: 'lead_form_harvest' },
      { step_key: 'phase1-b', play: 'thruplay_pool_build' },
    ]
    const res = sanitizeSeedAdPlays(input)
    expect(res).toEqual([
      { step_key: 'phase1-a', play: 'lead_form_harvest' },
      { step_key: 'phase1-b', play: 'thruplay_pool_build' },
    ])
  })

  it('returns undefined when one play is unknown', () => {
    const res = sanitizeSeedAdPlays([
      { step_key: 'phase1-a', play: 'lead_form_harvest' },
      { step_key: 'phase1-b', play: 'made_up_play' },
      { step_key: 'phase1-c', play: 'thruplay_pool_build' },
    ])
    expect(res).toBeUndefined()
  })

  it('returns undefined for duplicate step_keys, unlike lenient behaviour', () => {
    const input = [
      { step_key: 'phase1-a', play: 'lead_form_harvest' },
      { step_key: 'phase1-a', play: 'thruplay_pool_build' },
    ]
    expect(sanitizeSeedAdPlays(input)).toBeUndefined()

    const strict = parseAdPlays(input)
    expect(strict.ok).toBe(false)
  })

  it('returns undefined for non-array inputs', () => {
    const inputs: unknown[] = [undefined, null, 'x', {}, 5]
    for (const input of inputs) {
      expect(sanitizeSeedAdPlays(input)).toBeUndefined()
    }
  })

  it('returns undefined for an empty array', () => {
    expect(sanitizeSeedAdPlays([])).toBeUndefined()
  })

  it('rejects 9 items but accepts exactly 8', () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        step_key: `step-${i + 1}`,
        play: 'lead_form_harvest' as const,
      }))

    expect(sanitizeSeedAdPlays(make(9))).toBeUndefined()

    const eight = sanitizeSeedAdPlays(make(8))
    expect(eight).toBeDefined()
    expect(eight).toHaveLength(8)
  })

  it('drops extra fields, keeping only step_key and play', () => {
    const res = sanitizeSeedAdPlays([
      { step_key: 'phase1-a', play: 'lead_form_harvest', budget: 100, account: 'act_1' },
    ])
    expect(res).toEqual([{ step_key: 'phase1-a', play: 'lead_form_harvest' }])
    expect(res![0]).not.toHaveProperty('budget')
  })

  it('returns undefined for an invalid step_key', () => {
    const res = sanitizeSeedAdPlays([{ step_key: 'Has Space', play: 'lead_form_harvest' }])
    expect(res).toBeUndefined()
  })

  it('accepts every allowed play key with distinct step_keys', () => {
    const input = PLAY_KEYS.slice(0, 8).map((play, i) => ({ step_key: `step-${i}`, play }))
    const res = sanitizeSeedAdPlays(input)
    expect(res).toBeDefined()
    expect(res).toHaveLength(input.length)
  })
})
