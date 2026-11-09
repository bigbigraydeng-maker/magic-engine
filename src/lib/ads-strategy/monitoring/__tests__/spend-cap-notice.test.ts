import { describe, expect, it } from 'vitest'
import type { ClientCapFacts } from '@/lib/ads-strategy/circuit-cap-facts'
import type { AccountSpendFact } from '@/lib/ads-strategy/circuit-detectors'
import { evaluateDailySpendOverCapNotice } from '../spend-cap-notice'

const baseFacts = (
  accounts: AccountSpendFact[],
  capCents: number | null,
): ClientCapFacts => ({
  clientReferenceDate: '2026-11-07',
  accounts,
  capCents,
  configSource: 'strategy',
})

describe('evaluateDailySpendOverCapNotice', () => {
  it('no cap → no alert', () => {
    const v = evaluateDailySpendOverCapNotice(baseFacts([], null))
    expect(v.alert).toBe(false)
  })

  it('spend strictly over cap → alert', () => {
    const accounts: AccountSpendFact[] = [
      {
        adAccountId: 'act_1',
        lastCompleteDate: '2026-11-07',
        spendCents: 12_000,
        hasDeliveringEntity: true,
        currency: 'NZD',
      },
    ]
    const v = evaluateDailySpendOverCapNotice(baseFacts(accounts, 10_000))
    expect(v).toMatchObject({ alert: true, spendMajor: 120, capMajor: 100, currency: 'NZD' })
  })

  it('at cap → no alert', () => {
    const accounts: AccountSpendFact[] = [
      {
        adAccountId: 'act_1',
        lastCompleteDate: '2026-11-07',
        spendCents: 10_000,
        hasDeliveringEntity: true,
        currency: 'NZD',
      },
    ]
    expect(evaluateDailySpendOverCapNotice(baseFacts(accounts, 10_000)).alert).toBe(false)
  })
})
