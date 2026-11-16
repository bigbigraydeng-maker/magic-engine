import { describe, expect, it, vi } from 'vitest'
import type { EarlyWarningChannels, EarlyWarningEmailFacts } from '../notify-email'
import { deliverEarlyWarningToFde } from '../fde-outreach'

const FACTS: EarlyWarningEmailFacts = {
  clientName: 'Demo Client',
  clientId: '00000000-0000-0000-0000-000000000099',
  entityId: 'adset-1',
  level: 'adset',
  metric: 'leads',
  accountDay: '2026-11-15',
  todayCprMajor: 50,
  baselineCprMajor: 30,
  spendMajor: 100,
  currency: 'NZD',
  zeroResults: false,
  kind: 'cpl_spike',
}

describe('deliverEarlyWarningToFde', () => {
  it('keeps email sent when telegram throws', async () => {
    const channels: EarlyWarningChannels = {
      email: vi.fn(async () => 'sent'),
      telegram: vi.fn(async () => {
        throw new Error('telegram down')
      }),
    }
    const sb = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { leads_config: {} }, error: null }),
          }),
        }),
      }),
    } as never
    const result = await deliverEarlyWarningToFde(
      sb,
      channels,
      FACTS.clientId,
      [{ portalUserId: '11111111-1111-1111-1111-111111111111', email: 'fde@example.test' }],
      FACTS,
    )
    expect(result.email).toBe('sent')
    expect(result.telegram).toBe('send_failed')
  })

  it('does not call telegram when handler missing', async () => {
    const email = vi.fn(async () => 'sent')
    const sb = { from: vi.fn() } as never
    const result = await deliverEarlyWarningToFde(sb, { email }, FACTS.clientId, [], FACTS)
    expect(result.telegram).toBe('skipped')
    expect(result.email).toBe('sent')
  })
})