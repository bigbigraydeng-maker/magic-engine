import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  adPlaysFromLlm,
  applyLlmAdPlays,
  markAdPlaysDropped,
  wasAdPlaysDropped,
  PLAY_KEYS,
} from '../ad-plays'

const KEY_RE = /^p\d+-\d+-[a-z_]+$/

afterEach(() => {
  vi.restoreAllMocks()
})

describe('adPlaysFromLlm', () => {
  it('builds system keys for a valid list of 2 plays in phase 3', () => {
    const raw = [
      { play: 'lead_form_harvest' },
      { play: 'reach_awareness' },
    ]
    const res = adPlaysFromLlm(raw, 3)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.plays).toHaveLength(2)
    expect(res.plays[0].step_key).toBe('p3-1-lead_form_harvest')
    expect(res.plays[1].step_key).toBe('p3-2-reach_awareness')
    for (const p of res.plays) {
      expect(p.step_key).toMatch(KEY_RE)
      expect(p.step_key.length).toBeLessThanOrEqual(40)
    }
  })

  it('produces valid keys for every play in PLAY_KEYS at phase 12', () => {
    for (const play of PLAY_KEYS) {
      const res = adPlaysFromLlm([{ play }], 12)
      expect(res.ok).toBe(true)
      if (!res.ok) continue
      expect(res.plays).toHaveLength(1)
      const key = res.plays[0].step_key
      expect(key).toBe(`p12-1-${play}`)
      expect(key).toMatch(KEY_RE)
      expect(key.length).toBeLessThanOrEqual(40)
    }
  })

  it('ignores step_key, budget, account and any other fields on items', () => {
    const raw = [
      {
        step_key: 'ABC-1234567890',
        play: 'lead_form_harvest',
        budget: 500,
        account: 'act_1',
      },
    ]
    const res = adPlaysFromLlm(raw, 1)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.plays).toEqual([
      { step_key: 'p1-1-lead_form_harvest', play: 'lead_form_harvest' },
    ])
  })

  it('rejects non-array input', () => {
    const inputs: unknown[] = [undefined, null, 'x', {}, 5]
    for (const input of inputs) {
      const res = adPlaysFromLlm(input, 1)
      expect(res.ok).toBe(false)
      if (res.ok) continue
      expect(res.reason).toBe('广告打法必须是一个列表')
    }
  })

  it('returns ok with empty plays for an empty array', () => {
    const res = adPlaysFromLlm([], 1)
    expect(res).toEqual({ ok: true, plays: [] })
  })

  it('rejects 9 items but accepts exactly 8', () => {
    const nine = Array.from({ length: 9 }, () => ({ play: 'reach_awareness' }))
    const resNine = adPlaysFromLlm(nine, 1)
    expect(resNine.ok).toBe(false)
    if (!resNine.ok) {
      expect(resNine.reason).toBe('广告打法最多 8 条')
    }

    const eight = Array.from({ length: 8 }, () => ({ play: 'reach_awareness' }))
    const resEight = adPlaysFromLlm(eight, 1)
    expect(resEight.ok).toBe(true)
    if (resEight.ok) {
      expect(resEight.plays).toHaveLength(8)
    }
  })

  it('reports non-object items with their 1-based index', () => {
    const badItems: unknown[] = [null, 'x', []]
    for (const bad of badItems) {
      const res = adPlaysFromLlm([bad], 1)
      expect(res.ok).toBe(false)
      if (res.ok) continue
      expect(res.reason).toBe('第 1 项不是对象')
    }

    const res = adPlaysFromLlm(
      [{ play: 'reach_awareness' }, { play: 'reach_awareness' }, null],
      1,
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('第 3 项不是对象')
    }
  })

  it('reports invalid or missing play with its 1-based index', () => {
    const res = adPlaysFromLlm(
      [{ play: 'reach_awareness' }, { play: 'retargeting' }],
      1,
    )
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.reason).toBe('第 2 项的 play 不在允许范围内')
    }

    const resMissing = adPlaysFromLlm([{ play: 'reach_awareness' }, {}], 1)
    expect(resMissing.ok).toBe(false)
    if (!resMissing.ok) {
      expect(resMissing.reason).toBe('第 2 项的 play 不在允许范围内')
    }
  })

  it('falls back to phase 0 for invalid phase numbers', () => {
    const phases: number[] = [-1, 1.5, NaN]
    for (const phase of phases) {
      const res = adPlaysFromLlm([{ play: 'reach_awareness' }], phase)
      expect(res.ok).toBe(true)
      if (!res.ok) continue
      expect(res.plays[0].step_key.startsWith('p0-')).toBe(true)
    }
  })
})

describe('applyLlmAdPlays', () => {
  it('sets system keys for valid raw without warning or marking', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const target: { ad_plays?: { step_key: string; play: string }[] } = {}
    applyLlmAdPlays(target, [{ play: 'lead_form_harvest' }], 4)
    expect(target.ad_plays).toEqual([
      { step_key: 'p4-1-lead_form_harvest', play: 'lead_form_harvest' },
    ])
    expect(warn).not.toHaveBeenCalled()
    expect(wasAdPlaysDropped(target)).toBe(false)
  })

  it('removes existing ad_plays for undefined and null without warning or marking', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const targetUndefined: { ad_plays?: { step_key: string; play: string }[] } = {
      ad_plays: [{ step_key: 'old', play: 'reach_awareness' }],
    }
    applyLlmAdPlays(targetUndefined, undefined, 1)
    expect('ad_plays' in targetUndefined).toBe(false)
    expect(warn).not.toHaveBeenCalled()
    expect(wasAdPlaysDropped(targetUndefined)).toBe(false)

    const targetNull: { ad_plays?: { step_key: string; play: string }[] } = {
      ad_plays: [{ step_key: 'old', play: 'reach_awareness' }],
    }
    applyLlmAdPlays(targetNull, null, 1)
    expect('ad_plays' in targetNull).toBe(false)
    expect(warn).not.toHaveBeenCalled()
    expect(wasAdPlaysDropped(targetNull)).toBe(false)
  })

  it('removes the key for an empty array without warning or marking', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const target: { ad_plays?: { step_key: string; play: string }[] } = {
      ad_plays: [{ step_key: 'old', play: 'reach_awareness' }],
    }
    applyLlmAdPlays(target, [], 1)
    expect('ad_plays' in target).toBe(false)
    expect(warn).not.toHaveBeenCalled()
    expect(wasAdPlaysDropped(target)).toBe(false)
  })

  it('drops invalid raw, marks the target and warns exactly once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const target: { ad_plays?: { step_key: string; play: string }[] } = {
      ad_plays: [{ step_key: 'old', play: 'reach_awareness' }],
    }
    applyLlmAdPlays(target, [{ play: 'retargeting' }], 2)
    expect('ad_plays' in target).toBe(false)
    expect(wasAdPlaysDropped(target)).toBe(true)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      '[huatuo] ad_plays dropped phase=2 reason=第 1 项的 play 不在允许范围内',
    )
  })

  it('keeps the marker per object and never serializes it', () => {
    const target: { title: string; ad_plays?: { step_key: string; play: string }[] } = {
      title: 't',
    }
    const other: { title: string } = { title: 't' }

    markAdPlaysDropped(target)
    expect(wasAdPlaysDropped(target)).toBe(true)
    expect(wasAdPlaysDropped(other)).toBe(false)

    expect(JSON.stringify(target)).toBe('{"title":"t"}')
  })
})
