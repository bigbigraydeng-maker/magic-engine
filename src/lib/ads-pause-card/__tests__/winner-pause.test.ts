/**
 * Confirmed winner pause: guards, one write, read-back.
 * No second card. No live Meta calls. Ids here are short fakes.
 */

import { describe, expect, it, vi } from 'vitest'
import { pauseConfirmedWinnerAd, type WinnerPausePorts } from '../winner-pause'

const input = { clientId: 'client-1', adId: '101', adAccountId: 'act_11', adsetId: '301' }

function ports(over: Partial<WinnerPausePorts> = {}): WinnerPausePorts {
  return {
    token: vi.fn(async () => 'token'),
    accounts: vi.fn(async () => ({ ids: ['11'] })),
    read: vi.fn(async () => ({ status: 'ACTIVE', accountId: '11', adsetId: '301' })),
    pause: vi.fn(async () => undefined),
    ...over,
  }
}

describe('confirmed winner pause', () => {
  it('pauses once when the ad is still active in this account', async () => {
    const used = ports({
      read: vi.fn()
        .mockResolvedValueOnce({ status: 'ACTIVE', accountId: 'act_11', adsetId: '301' })
        .mockResolvedValueOnce({ status: 'PAUSED', accountId: 'act_11', adsetId: '301' }),
    })
    const result = await pauseConfirmedWinnerAd(input, used)
    expect(used.pause).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: true, wroteMeta: true, readback: 'PAUSED' })
  })

  it('does not pause when the account, ad set, or status does not match', async () => {
    const cases = [
      ports({ accounts: vi.fn(async () => ({ ids: [], error: 'unread' })) }),
      ports({ read: vi.fn(async () => null) }),
      ports({ read: vi.fn(async () => ({ status: 'ACTIVE', accountId: '99', adsetId: '301' })) }),
      ports({ accounts: vi.fn(async () => ({ ids: ['99'] })) }),
      ports({ read: vi.fn(async () => ({ status: 'ACTIVE', accountId: '11', adsetId: '999' })) }),
      ports({ read: vi.fn(async () => ({ status: 'PAUSED', accountId: '11', adsetId: '301' })) }),
    ]
    for (const used of cases) {
      const result = await pauseConfirmedWinnerAd(input, used)
      expect(used.pause).not.toHaveBeenCalled()
      expect(result.wroteMeta).toBe(false)
      expect(result.reason.length).toBeGreaterThan(0)
    }
  })

  it('does not pause a second time when the read-back is not paused', async () => {
    const used = ports({
      read: vi.fn()
        .mockResolvedValueOnce({ status: 'ACTIVE', accountId: '11', adsetId: '301' })
        .mockResolvedValueOnce({ status: 'ACTIVE', accountId: '11', adsetId: '301' }),
    })
    const result = await pauseConfirmedWinnerAd(input, used)
    expect(used.pause).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(false)
    expect(result.wroteMeta).toBe(true)
    expect(result.reason).toContain('没有再写一次')
  })
})
