import { describe, expect, it } from 'vitest'
import { buildEarlyWarningSubject, buildEarlyWarningText } from '../alert-copy'

describe('alert copy', () => {
  it('builds subject and body for cpl spike', () => {
    const text = buildEarlyWarningText({
      clientName: 'Acme',
      clientId: '00000000-0000-0000-0000-000000000001',
      entityId: '1',
      level: 'adset',
      metric: 'leads',
      accountDay: '2026-11-15',
      todayCprMajor: 40,
      baselineCprMajor: 20,
      spendMajor: 80,
      currency: 'NZD',
      zeroResults: false,
      kind: 'cpl_spike',
    })
    expect(buildEarlyWarningSubject({ clientName: 'Acme', kind: 'cpl_spike', metric: 'leads', accountDay: '2026-11-15' } as never)).toContain('预警')
    expect(text).toContain('没有自动暂停或改预算')
  })
})