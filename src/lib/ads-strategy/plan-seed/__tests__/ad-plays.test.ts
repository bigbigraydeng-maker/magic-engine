import { describe, it, expect } from 'vitest'
import { parseAdPlays, lenientAdPlays, PLAY_KEYS } from '../ad-plays'

describe('parseAdPlays', () => {
  it('accepts a single valid play and returns the same data', () => {
    const res = parseAdPlays([{ step_key: 'step-1', play: 'thruplay_pool_build' }])
    expect(res).toEqual({
      ok: true,
      plays: [{ step_key: 'step-1', play: 'thruplay_pool_build' }],
    })
  })

  it('accepts every allowed play key with distinct step_keys', () => {
    const input = PLAY_KEYS.map((play, i) => ({ step_key: `step-${i}`, play }))
    const res = parseAdPlays(input)
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.plays).toHaveLength(PLAY_KEYS.length)
      expect(res.plays.map((p) => p.play)).toEqual([...PLAY_KEYS])
    }
  })

  it('trims surrounding spaces from step_key', () => {
    const res = parseAdPlays([{ step_key: '  step-1  ', play: 'messenger_direct' }])
    expect(res).toEqual({
      ok: true,
      plays: [{ step_key: 'step-1', play: 'messenger_direct' }],
    })
  })

  it('rejects non-array inputs with the list error', () => {
    const inputs: unknown[] = [undefined, null, 'x', {}]
    for (const input of inputs) {
      const res = parseAdPlays(input)
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error).toContain('必须是一个列表')
      }
    }
  })

  it('rejects an empty array', () => {
    const res = parseAdPlays([])
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('最多 8 条')
    }
  })

  it('rejects 9 items but accepts exactly 8', () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        step_key: `step-${i}`,
        play: 'reach_awareness' as const,
      }))

    const tooMany = parseAdPlays(make(9))
    expect(tooMany.ok).toBe(false)
    if (!tooMany.ok) {
      expect(tooMany.error).toContain('最多 8 条')
    }

    const exactlyEight = parseAdPlays(make(8))
    expect(exactlyEight.ok).toBe(true)
    if (exactlyEight.ok) {
      expect(exactlyEight.plays).toHaveLength(8)
    }
  })

  it('rejects items that are not objects', () => {
    const inputs: unknown[] = ['a', null, []]
    for (const item of inputs) {
      const res = parseAdPlays([item])
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error).toContain('第 1 项不是对象')
      }
    }
  })

  it('rejects illegal step_key values', () => {
    const badKeys: unknown[] = [
      '',
      '   ',
      'A-upper',
      'has space',
      'x'.repeat(41),
      123,
      undefined,
    ]
    for (const step_key of badKeys) {
      const res = parseAdPlays([{ step_key, play: 'thruplay_pool_build' }])
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error).toContain('第 1 项的 step_key 不合法')
      }
    }
  })

  it('accepts a step_key of exactly 40 characters', () => {
    const key = 'x'.repeat(40)
    const res = parseAdPlays([{ step_key: key, play: 'thruplay_pool_build' }])
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.plays[0].step_key).toBe(key)
    }
  })

  it('rejects bad play values', () => {
    const badPlays: unknown[] = ['nope', 5, undefined]
    for (const play of badPlays) {
      const res = parseAdPlays([{ step_key: 'step-1', play }])
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.error).toContain('第 1 项的 play 不在允许范围内')
      }
    }
  })

  it('reports the correct index for a bad play on the second item', () => {
    const res = parseAdPlays([
      { step_key: 'step-1', play: 'thruplay_pool_build' },
      { step_key: 'step-2', play: 'nope' },
    ])
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('第 2 项的 play 不在允许范围内')
    }
  })

  it('rejects duplicate step_keys', () => {
    const res = parseAdPlays([
      { step_key: 'step-1', play: 'thruplay_pool_build' },
      { step_key: 'step-1', play: 'messenger_direct' },
    ])
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain('第 2 项的 step_key 和前面重复')
    }
  })
})

describe('lenientAdPlays', () => {
  it('never throws for weird inputs', () => {
    const inputs: unknown[] = [undefined, null, 5, 'x', {}, [null, 1, 'x', {}]]
    for (const input of inputs) {
      expect(() => lenientAdPlays(input)).not.toThrow()
    }
  })

  it('returns an empty array for non-array input', () => {
    expect(lenientAdPlays(undefined)).toEqual([])
    expect(lenientAdPlays(null)).toEqual([])
    expect(lenientAdPlays('x')).toEqual([])
    expect(lenientAdPlays({})).toEqual([])
  })

  it('drops invalid items but keeps valid ones in order', () => {
    const res = lenientAdPlays([
      { step_key: 'step-1', play: 'thruplay_pool_build' },
      'not-an-object',
      { step_key: 'BAD KEY', play: 'messenger_direct' },
      { step_key: 'step-2', play: 'nope' },
      { step_key: 'step-3', play: 'reach_awareness' },
    ])
    expect(res).toEqual([
      { step_key: 'step-1', play: 'thruplay_pool_build' },
      { step_key: 'step-3', play: 'reach_awareness' },
    ])
  })

  it('drops duplicates keeping the first occurrence', () => {
    const res = lenientAdPlays([
      { step_key: 'step-1', play: 'thruplay_pool_build' },
      { step_key: 'step-1', play: 'messenger_direct' },
      { step_key: 'step-2', play: 'reach_awareness' },
    ])
    expect(res).toEqual([
      { step_key: 'step-1', play: 'thruplay_pool_build' },
      { step_key: 'step-2', play: 'reach_awareness' },
    ])
  })

  it('caps the result at 8 items even with 12 valid distinct items', () => {
    const input = Array.from({ length: 12 }, (_, i) => ({
      step_key: `step-${i}`,
      play: 'reach_awareness' as const,
    }))
    const res = lenientAdPlays(input)
    expect(res).toHaveLength(8)
    expect(res.map((p) => p.step_key)).toEqual([
      'step-0',
      'step-1',
      'step-2',
      'step-3',
      'step-4',
      'step-5',
      'step-6',
      'step-7',
    ])
  })

  it('trims step_key in the returned objects', () => {
    const res = lenientAdPlays([{ step_key: '  step-1  ', play: 'messenger_direct' }])
    expect(res).toEqual([{ step_key: 'step-1', play: 'messenger_direct' }])
  })

  it('does not mutate the input array', () => {
    const input = [
      { step_key: '  step-1  ', play: 'thruplay_pool_build' },
      { step_key: 'step-1', play: 'messenger_direct' },
      { step_key: 'step-2', play: 'reach_awareness' },
    ]
    const snapshot = JSON.parse(JSON.stringify(input)) as unknown
    lenientAdPlays(input)
    expect(input).toEqual(snapshot)
  })
})
