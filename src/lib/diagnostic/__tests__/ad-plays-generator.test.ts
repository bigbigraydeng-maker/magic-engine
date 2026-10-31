import { describe, expect, it, vi } from 'vitest'
import type { PrescriptionContent, PrescriptionIntake } from '@/types/diagnostic'
import { generatePrescription, stripInvalidAdPlays } from '../prescription-generator'

const INTAKE: PrescriptionIntake = {
  business_goal: 'Grow',
  timeline_urgency: 'short_term',
  monthly_budget_aud: 3000,
  priority_dimensions: ['ads'],
  notes: null,
}

function asContent(v: object): PrescriptionContent {
  return JSON.parse(JSON.stringify(v)) as PrescriptionContent
}

describe('retired diagnostic prescription path', () => {
  it('does not call the model or the diagnostic tables', async () => {
    const supabase = { from: vi.fn() }
    await expect(
      generatePrescription(supabase as never, 'run-1', 'client-1', INTAKE),
    ).rejects.toThrow(/已废弃/)
    expect(supabase.from).not.toHaveBeenCalled()
  })
})

describe('stripInvalidAdPlays', () => {
  it('deletes non-array ad_plays and never throws on bad shapes', () => {
    const withBadAdPlays = asContent({
      summary: 'stub',
      phases: [{
        phase_number: 1,
        name: 'Phase 1',
        duration_weeks: 4,
        actions: [],
        initiative_seed: { ad_plays: 'bad' },
      }],
      kpi_targets: [],
      budget_allocation: [],
    })
    stripInvalidAdPlays(withBadAdPlays)
    const seed = withBadAdPlays.phases[0].initiative_seed
    expect(seed && 'ad_plays' in seed).toBe(false)

    const withoutSeed = {
      summary: 'stub',
      phases: [{ phase_number: 1, name: 'Phase 1', duration_weeks: 4, actions: [] }],
      kpi_targets: [],
      budget_allocation: [],
    } as PrescriptionContent
    expect(() => stripInvalidAdPlays(withoutSeed)).not.toThrow()

    const badPhases = asContent({
      summary: 'stub',
      phases: null,
      kpi_targets: [],
      budget_allocation: [],
    })
    expect(() => stripInvalidAdPlays(badPhases)).not.toThrow()
  })

  it('uses phase 0 in step_key when phase_number is missing', () => {
    const content = asContent({
      summary: 'stub',
      phases: [{
        name: 'Phase 1',
        duration_weeks: 4,
        actions: [],
        initiative_seed: { ad_plays: [{ play: 'lead_form_harvest' }] },
      }],
      kpi_targets: [],
      budget_allocation: [],
    })
    stripInvalidAdPlays(content)
    expect(content.phases[0].initiative_seed?.ad_plays).toEqual([
      { step_key: 'p0-1-lead_form_harvest', play: 'lead_form_harvest' },
    ])
  })
})
