import { describe, expect, it } from 'vitest'
import type { PlanSeed } from '@/lib/ads-strategy/plan-seed/types'
import type { AccountCapFacts } from '../budget-caps'
import { mapSeedToPromo } from '../plan-draft-map'
import { validatePlanDraft } from '../plan-draft-validate'

const PERIOD = { start_date: '2026-11-01', end_date: '2026-11-30' }

function basis(value: string) {
  return [{ label: 'test', value, source: 'test', as_of: null }]
}

function seed(cents: number): PlanSeed {
  return {
    schema_version: 1,
    produced_by: 'ads-agent',
    facts_as_of: '2026-10-26T00:00:00.000Z',
    currency: 'AUD',
    period: PERIOD,
    captured_at: {},
    ad_steps: [{
      step_key: 'play-1',
      play: 'lead_form_harvest',
      page_id: { ok: true, value: 'page-1', basis: basis('page-1'), notes: [] },
      ad_account_id: { ok: true, value: 'act_1', basis: basis('act_1'), notes: [] },
      daily_budget_cents: { ok: true, value: cents, basis: basis(String(cents)), notes: [] },
    }],
    skipped: [],
    notes: [],
  }
}

function account(over: Partial<AccountCapFacts> = {}): AccountCapFacts {
  return { ad_account_id: 'act_1', currency: 'AUD', daily_cap_cents: 10000, owned_by_client: true, ...over }
}

function drafted(cents = 5000) {
  const mapped = mapSeedToPromo({
    goalId: 'goal-1',
    period: PERIOD,
    plays: [{ step_key: 'play-1' }],
    seed: seed(cents),
    country: 'AU',
    accounts: [account()],
    clientCapCents: 20000,
  })
  if (!mapped.ok) throw new Error(mapped.text)
  return mapped.spec
}

describe('validatePlanDraft', () => {
  it('accepts an auto-drafted spec with the facts the save route has, and with the seed', () => {
    const spec = drafted()
    const saved = validatePlanDraft(spec, { accounts: [account()], clientCapCents: 20000 })
    expect(saved).toEqual({ ok: true, spec })
    const withSeed = validatePlanDraft(spec, { accounts: [account()], clientCapCents: 20000, seed: seed(5000) })
    expect(withSeed.ok).toBe(true)
  })

  it('still rejects a foreign account, a definite cap breach, and a missing or lower seed', () => {
    const spec = drafted()
    const foreign = validatePlanDraft(spec, { accounts: [account({ owned_by_client: false })], clientCapCents: 20000 })
    expect(foreign.ok).toBe(false)
    const over = validatePlanDraft(spec, { accounts: [account({ daily_cap_cents: 100 })], clientCapCents: 20000 })
    expect(over.ok).toBe(false)
    const missing = validatePlanDraft(spec, { accounts: [account()], clientCapCents: 20000, seed: null })
    expect(missing.ok).toBe(false)
    const lower = validatePlanDraft(spec, { accounts: [account()], clientCapCents: 20000, seed: seed(100) })
    expect(lower.ok).toBe(false)
  })

  it('does not reject an unknown cap', () => {
    const spec = drafted()
    const unknown = validatePlanDraft(spec, {
      accounts: [account({ currency: null, daily_cap_cents: null })],
      clientCapCents: null,
    })
    expect(unknown.ok).toBe(true)
  })

  it('drops approval receipts and still accepts the shape', () => {
    const spec = drafted()
    const raw = {
      ...spec,
      checks: [{ phase_id: 'phase-1', check_key: 'landing.item_live', verified_by: 'fde', verified_at: '2026-10-26T00:00:00.000Z' }],
      gate_snapshot: { taken_at: '2026-10-26T00:00:00.000Z' },
    }
    const result = validatePlanDraft(raw, { accounts: [account()], clientCapCents: 20000 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.spec.checks).toEqual([])
    expect(result.spec.gate_snapshot).toBeUndefined()
  })
})
