import { describe, expect, it } from 'vitest'
import { authorizedAdSetIds, earliestReceiptFor, parseLaunchReceipts } from '../launch-receipts'

const executed = (over: Record<string, unknown> = {}) => ({
  status: 'active',
  campaignId: 'camp-1',
  adSetId: 'set-1',
  readback: '广告组是暂停的，读回来了',
  activation: { status: 'executed', authorized_at: '2026-10-20T01:00:00.000Z', basis: 'global_admin' },
  ...over,
})

describe('parseLaunchReceipts', () => {
  it('keeps an executed read-back and ignores a launch that was not read back', () => {
    const rows = parseLaunchReceipts([
      { id: 'a', payload: executed() },
      { id: 'b', payload: executed({ adSetId: 'set-2', readback: '  ', goLiveStartedAt: undefined }) },
      { id: 'c', payload: executed({ adSetId: 'set-3', activation: { status: 'authorized_pending', authorized_at: '2026-10-20T01:00:00.000Z' } }) },
    ])
    expect(rows.map(row => row.adSetIds[0])).toEqual(['set-1'])
    expect(rows[0]).toMatchObject({ basis: 'pm', authorizedAt: '2026-10-20T01:00:00.000Z' })
  })

  it('accepts a confirmation card whose go-live read-back marked the ad live', () => {
    const rows = parseLaunchReceipts([{
      id: 'card',
      payload: executed({
        adSetId: 'set-9',
        readback: '',
        goLiveStartedAt: '2026-10-21T02:00:00.000Z',
        activation: { status: 'executed', authorized_at: '2026-10-21T01:00:00.000Z', basis: 'go_live_card' },
      }),
    }])
    expect(rows[0]).toMatchObject({ basis: 'confirmation_card', adSetIds: ['set-9'] })
  })

  it('uses the earliest authorization time and does not replace it with a later row', () => {
    const receipts = parseLaunchReceipts([
      { id: 'later', payload: executed({ activation: { status: 'executed', authorized_at: '2026-10-22T01:00:00.000Z', basis: 'global_admin' } }) },
      { id: 'earlier', payload: executed({ activation: { status: 'executed', authorized_at: '2026-10-20T01:00:00.000Z', basis: 'global_admin' } }) },
    ])
    expect(earliestReceiptFor('set-1', receipts)?.actionId).toBe('earlier')
    expect(authorizedAdSetIds(receipts)).toEqual(new Set(['set-1']))
  })
})
