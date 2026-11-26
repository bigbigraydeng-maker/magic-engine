import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PREFLIGHT_GATE_KEYS } from '@/lib/ads-tracking-preflight/types'

const receipt = vi.hoisted(() => ({ current: null as unknown }))
vi.mock('@/lib/ads-tracking-preflight/load-receipt', () => ({
  loadTrackingGateFacts: vi.fn(async () => receipt.current),
}))

import { loadGoLive } from '../load'

const NOW = new Date('2026-11-25T01:00:00.000Z')
const CLIENT = 'client-a'

function billingReceipt(checkedAccount: string, flag: boolean) {
  return {
    receipt: {
      checked_at: '2026-11-25T00:30:00.000Z',
      gates: PREFLIGHT_GATE_KEYS.map((key) => (
        key === 'env.account_billing'
          ? { key, status: 'yellow', reason: '空账户', na: false, evidence: { empty_account_only: flag, checked_ad_account: checkedAccount } }
          : { key, status: 'green', reason: '记下了', na: false, evidence: {} }
      )),
    },
  }
}

function fakeSb(payload: Record<string, unknown>) {
  const chain = (result: unknown) => {
    const q: Record<string, unknown> = {}
    for (const m of ['select', 'eq']) q[m] = () => q
    q.maybeSingle = async () => result
    q.then = (resolve: (v: unknown) => unknown) => resolve(result)
    return q
  }
  return {
    from: (table: string) => table === 'flywheel_actions'
      ? chain({ data: { client_id: CLIENT, payload }, error: null })
      : chain({ data: [{ label: '主账户' }, { label: '官方账户' }], error: null }),
  } as never
}

const PAYLOAD = {
  status: 'awaiting_approval',
  accountLabel: '主账户',
  adAccountId: 'act_111',
  campaignId: 'c1', adSetId: 's1', adIds: ['a1'],
  draft: { kind: 'lead_form', dailyBudget: 200, durationDays: 10 },
}

function budgetCheck(facts: { hardChecks: readonly { label: string; state: string }[] }) {
  return facts.hardChecks
}

describe('loadGoLive · empty-account budget yellow', () => {
  beforeEach(() => { receipt.current = null })

  it('passes when the receipt read the same account the draft lives in', async () => {
    receipt.current = billingReceipt('111', true)
    const out = await loadGoLive(fakeSb(PAYLOAD), CLIENT, 'draft-1', NOW)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(budgetCheck(out.facts).every((row) => row.state === 'green')).toBe(true)
  })

  it('still blocks when the receipt read a different account', async () => {
    receipt.current = billingReceipt('act_222', true)
    const out = await loadGoLive(fakeSb(PAYLOAD), CLIENT, 'draft-1', NOW)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(budgetCheck(out.facts).some((row) => row.state === 'red')).toBe(true)
  })

  it('still blocks an old draft that never recorded its account', async () => {
    receipt.current = billingReceipt('act_111', true)
    const { adAccountId: _drop, ...old } = PAYLOAD
    const out = await loadGoLive(fakeSb(old), CLIENT, 'draft-1', NOW)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(budgetCheck(out.facts).some((row) => row.state === 'red')).toBe(true)
  })
})
