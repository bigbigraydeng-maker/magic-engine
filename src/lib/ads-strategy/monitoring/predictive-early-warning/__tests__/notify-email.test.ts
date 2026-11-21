import { describe, expect, it } from 'vitest'
import { buildEarlyWarningSubject, buildEarlyWarningText, deliverEarlyWarningEmail } from '../notify-email'

const FACTS = {
  clientName: '演示客户',
  clientId: '00000000-0000-0000-0000-0000000000aa',
  entityId: 'as_1',
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

describe('early warning email', () => {
  it('copy + deliver', async () => {
    expect(buildEarlyWarningText(FACTS)).toContain('没有自动暂停')
    expect(buildEarlyWarningSubject(FACTS)).toContain('预警')
    expect(await deliverEarlyWarningEmail([], FACTS)).toBe('no_recipients')
    expect(await deliverEarlyWarningEmail(['ops@example.test'], FACTS, { send: async () => ({ ok: true }) })).toBe(
      'sent',
    )
  })
})