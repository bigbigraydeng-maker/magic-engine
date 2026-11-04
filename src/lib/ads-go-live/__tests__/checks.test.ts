import { describe, expect, it } from 'vitest'
import { PREFLIGHT_GATE_KEYS } from '@/lib/ads-tracking-preflight/types'
import { gatesFromReceipt, hardChecksForGoLive, type StoredGate } from '../checks'

const NOW = new Date('2026-10-28T12:00:00.000Z')

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString()
}

function receipt(status: string, checkedAt: string, extra?: Partial<StoredGate>) {
  return {
    checkedAt,
    gates: PREFLIGHT_GATE_KEYS.map((key) => ({ key, status, reason: '记下了', ...extra })),
  }
}

describe('go-live hard checks', () => {
  it('folds ten green gates into one green line', () => {
    const gates = gatesFromReceipt({ receipt: receipt('green', hoursAgo(1)), now: NOW })
    expect(hardChecksForGoLive(gates, [])).toEqual([
      { label: '开投前十道检查', state: 'green', reason: '十道都是绿灯' },
    ])
  })

  it('treats yellow as red and does not call it green', () => {
    const gates = gatesFromReceipt({
      receipt: {
        checkedAt: hoursAgo(1),
        gates: PREFLIGHT_GATE_KEYS.map((key, index) => ({
          key,
          status: index === 1 ? 'yellow' : 'green',
          reason: index === 1 ? '' : '记下了',
        })),
      },
      now: NOW,
    })
    const checks = hardChecksForGoLive(gates, [])
    expect(checks).toHaveLength(1)
    expect(checks[0]?.state).toBe('red')
    expect(checks[0]?.reason).toBe('还不是绿灯')
  })

  it('keeps grey, missing, and stale results unreadable', () => {
    const grey = gatesFromReceipt({
      receipt: {
        checkedAt: hoursAgo(1),
        gates: [{ key: 'tracking.pixel_alive', status: 'gray', reason: '' }],
      },
      now: NOW,
    })
    const pixel = hardChecksForGoLive(grey, []).find((row) => row.label === '像素在线')
    expect(pixel).toMatchObject({ state: 'unread', reason: '读不到' })

    const missing = gatesFromReceipt({ receipt: null, now: NOW })
    const packed = hardChecksForGoLive(missing, [])
    expect(packed.every((row) => row.state === 'unread')).toBe(true)
    expect(packed.length).toBeLessThanOrEqual(8)
    expect(packed.some((row) => row.reason === '这道检查没有结果' || row.label === '还有没通过的检查')).toBe(true)
  })

  it('stales the budget gate after 12 hours and leaves the other gates fresh', () => {
    const gates = gatesFromReceipt({ receipt: receipt('green', hoursAgo(13)), now: NOW })
    const checks = hardChecksForGoLive(gates, [])
    expect(checks).toEqual([
      { label: '广告账户与付款', state: 'unread', reason: '这道检查的结果过期了' },
    ])
  })

  it('skips a gate marked not applicable and says the rest are green', () => {
    const gates = gatesFromReceipt({
      receipt: receipt('green', hoursAgo(1), { na: true }),
      now: NOW,
    })
    const oneApplicable = gates.map((gate, index) => (index === 0 ? { ...gate, na: false } : gate))
    expect(hardChecksForGoLive(oneApplicable, [])).toEqual([
      { label: '开投前十道检查', state: 'green', reason: '适用的检查都是绿灯' },
    ])
  })

  it('packs more than eight problems into the eighth line', () => {
    const gates = gatesFromReceipt({ receipt: receipt('red', hoursAgo(1)), now: NOW })
    const checks = hardChecksForGoLive(gates, [])
    expect(checks).toHaveLength(8)
    expect(checks[7]?.label).toBe('还有没通过的检查')
    expect(checks[7]?.state).toBe('red')
  })

  it('does not name a client', () => {
    const text = JSON.stringify(hardChecksForGoLive(
      gatesFromReceipt({ receipt: receipt('red', hoursAgo(1)), now: NOW }),
      [],
    ))
    expect(text).not.toMatch(/CTS|Oztop|Roman|act_/i)
  })
})
