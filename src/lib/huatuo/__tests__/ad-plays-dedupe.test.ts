import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/anthropic/client', () => ({
  MODEL_SONNET: 'm',
  parseJsonResponse: JSON.parse,
  getAnthropicClient: () => ({}),
}))

import { normalizePrescriptionContent } from '../agent'
import { stripInvalidAdPlays } from '@/lib/diagnostic/prescription-generator'
import { collectAdPlays } from '@/lib/ads-strategy/plan-seed/attach'
import { dedupeAdPlayStepKeys } from '@/lib/ads-strategy/plan-seed/ad-plays'
import type { PrescriptionContent } from '@/types/diagnostic'

const SEED = { initiative_type: 'demand_generation', title: 't', posture: 'offensive', budget_percent: 50, hypothesis: 'h' }

function twoPhasesSameNumber(): Partial<PrescriptionContent> {
  return JSON.parse(JSON.stringify({
    summary: 's',
    phases: [
      { phase_number: 1, name: 'a', duration_weeks: 2, actions: [], initiative_seed: { ...SEED, ad_plays: [{ play: 'lead_form_harvest' }] } },
      { phase_number: 1, name: 'b', duration_weeks: 2, actions: [], initiative_seed: { ...SEED, ad_plays: [{ play: 'lead_form_harvest' }] } },
    ],
  }))
}

describe('system-generated step_key stays unique across phases', () => {
  it('normalizePrescriptionContent: two phases with the same phase_number keep both plays', () => {
    const out = normalizePrescriptionContent(twoPhasesSameNumber())
    const keys = out.phases.map((p) => p.initiative_seed?.ad_plays?.[0]?.step_key)
    expect(keys).toEqual(['p1-1-lead_form_harvest', 'p1-1-lead_form_harvest-2'])
    expect(collectAdPlays(out)).toHaveLength(2)
  })

  it('stripInvalidAdPlays (direct LLM JSON path) also dedupes', () => {
    const content = twoPhasesSameNumber() as PrescriptionContent
    stripInvalidAdPlays(content)
    const keys = content.phases.map((p) => p.initiative_seed?.ad_plays?.[0]?.step_key)
    expect(keys).toEqual(['p1-1-lead_form_harvest', 'p1-1-lead_form_harvest-2'])
  })

  it('dedupe keeps keys within 40 chars and never throws on junk', () => {
    const long = 'x'.repeat(40)
    const phases = [
      { initiative_seed: { ad_plays: [{ step_key: long, play: 'a' }] } },
      { initiative_seed: { ad_plays: [{ step_key: long, play: 'a' }] } },
      null,
      { initiative_seed: 'junk' },
    ]
    dedupeAdPlayStepKeys(phases)
    const k2 = (phases[1] as { initiative_seed: { ad_plays: { step_key: string }[] } }).initiative_seed.ad_plays[0].step_key
    expect(k2.length).toBeLessThanOrEqual(40)
    expect(k2).not.toBe(long)
    expect(() => dedupeAdPlayStepKeys(undefined)).not.toThrow()
  })

  it('a plan_seed nested inside initiative_seed is dropped on the direct LLM JSON path', () => {
    const content = JSON.parse(JSON.stringify({
      summary: 's',
      phases: [{ phase_number: 1, name: 'a', duration_weeks: 2, actions: [], initiative_seed: { ...SEED, plan_seed: { account: 'act_999', budget: 100 } } }],
    })) as PrescriptionContent
    stripInvalidAdPlays(content)
    expect('plan_seed' in (content.phases[0].initiative_seed ?? {})).toBe(false)
  })
})
