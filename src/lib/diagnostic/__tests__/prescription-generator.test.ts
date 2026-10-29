import { describe, expect, it, vi } from 'vitest'
import type { PrescriptionIntake } from '@/types/diagnostic'
import { generatePrescription } from '../prescription-generator'

const INTAKE: PrescriptionIntake = {
  business_goal: 'Grow',
  timeline_urgency: 'short_term',
  monthly_budget_aud: 3000,
  priority_dimensions: ['seo'],
  notes: null,
}

describe('generatePrescription()', () => {
  it('refuses the diagnostic-run path and does not read score tables', async () => {
    const supabase = { from: vi.fn() }
    await expect(
      generatePrescription(supabase as never, 'run-1', 'client-1', INTAKE),
    ).rejects.toThrow(/已废弃/)
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
