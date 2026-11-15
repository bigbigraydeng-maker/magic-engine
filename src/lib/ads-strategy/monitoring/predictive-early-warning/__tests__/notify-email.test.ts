import { describe, expect, it } from 'vitest'
import { buildEarlyWarningSubject, buildEarlyWarningText, deliverEarlyWarningEmail } from '../notify-email'

const FACTS = {
  clientName: '演示客户',
  clientId: '00000000-0000-0000-0000-000000000001',
  entityId: '1234567890',
  level: 'adset' as const,
  metric: 'leads' as const,
  accountDay: '2026-11-15',
  todayCprMajor: 18,
  baselineCprMajor: 12,
  spendMajor: 36,
  currency: 'NZD',
  zeroResults: false,
  kind: 'cpl_spike' as const,
}

describe('early warning email copy', () => {
  it('mentions notify-only and no auto pause', () => {
    const text = buildEarlyWarningText(FACTS)
    expect(text).toContain('没有自动暂停')
    expect(buildEarlyWarningSubject(FACTS)).toContain('预警')
  })
})

describe('deliverEarlyWarningEmail', () => {
  it('returns no_recipients without sending', async () => {
    expect(await deliverEarlyWarningEmail([], FACTS)).toBe('no_recipients')
  })

  it('uses injected mailer in tests', async () => {
    const sent = await deliverEarlyWarningEmail(['ops@example.test'], FACTS, {
      send: async () => ({ ok: true }),
    })
    expect(sent).toBe('sent')
  })
})