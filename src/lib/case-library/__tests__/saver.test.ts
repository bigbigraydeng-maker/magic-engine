/**
 * Tests for src/lib/case-library/saver.ts — P8.12.S2.2
 * TDD: savePrescriptionCase silent-failure + field mapping
 */

import { describe, it, expect, vi } from 'vitest'
import { savePrescriptionCase } from '../saver'

// ---------------------------------------------------------------------------
// Supabase mock helpers
// ---------------------------------------------------------------------------

function makeInsertMock(returnId: string | null, error: unknown = null) {
  const selectFn = vi.fn().mockResolvedValue({
    data: returnId ? { id: returnId } : null,
    error,
  })
  const insertFn = vi.fn().mockReturnValue({ select: () => ({ single: selectFn }) })
  return {
    from: vi.fn().mockReturnValue({ insert: insertFn }),
    _insertFn: insertFn,
  }
}

// ---------------------------------------------------------------------------
// 1. Happy path
// ---------------------------------------------------------------------------

describe('savePrescriptionCase — happy path', () => {
  it('returns case_id on success', async () => {
    const { from: fromFn } = makeInsertMock('new-case-id')
    const supabase = { from: fromFn }
    const caseId = await savePrescriptionCase(supabase as never, {
      clientId: 'client-1',
      discoveryId: 'disc-1',
      prescriptionId: 'presc-1',
      industryCategory: 'tourism_operator',
      crisisType: 'seo',
      monthlyBudgetAud: 3000,
      market: 'AU',
      businessSize: 'small',
      prescriptionSummary: 'Improve local SEO.',
      selfGradeOverall: 8.0,
    })
    expect(caseId).toBe('new-case-id')
  })

  it('passes all fields to the insert', async () => {
    const selectFn = vi.fn().mockResolvedValue({ data: { id: 'cid' }, error: null })
    const insertFn = vi.fn().mockReturnValue({ select: () => ({ single: selectFn }) })
    const fromFn = vi.fn().mockReturnValue({ insert: insertFn })
    const supabase = { from: fromFn }

    await savePrescriptionCase(supabase as never, {
      clientId: 'c1',
      discoveryId: 'd1',
      prescriptionId: 'p1',
      industryCategory: 'dental_clinic',
      crisisType: 'reputation',
      monthlyBudgetAud: 2000,
      market: 'NZ',
      businessSize: 'small',
      prescriptionSummary: 'Summary text.',
      selfGradeOverall: 7.5,
    })

    const insertedRow = insertFn.mock.calls[0][0] as Record<string, unknown>
    expect(insertedRow.client_id).toBe('c1')
    expect(insertedRow.discovery_id).toBe('d1')
    expect(insertedRow.prescription_id).toBe('p1')
    expect(insertedRow.industry_category).toBe('dental_clinic')
    expect(insertedRow.crisis_type).toBe('reputation')
    expect(insertedRow.monthly_budget_aud).toBe(2000)
    expect(insertedRow.market).toBe('NZ')
    expect(insertedRow.self_grade_overall).toBe(7.5)
    expect(insertedRow.prescription_summary).toBe('Summary text.')
  })
})

// ---------------------------------------------------------------------------
// 2. Silent failure — DB error returns null without throwing
// ---------------------------------------------------------------------------

describe('savePrescriptionCase — silent failure', () => {
  it('returns null on DB insert error', async () => {
    const selectFn = vi.fn().mockResolvedValue({ data: null, error: new Error('constraint') })
    const insertFn = vi.fn().mockReturnValue({ select: () => ({ single: selectFn }) })
    const fromFn = vi.fn().mockReturnValue({ insert: insertFn })
    const supabase = { from: fromFn }

    const result = await savePrescriptionCase(supabase as never, {
      clientId: 'c1',
      discoveryId: 'd1',
      prescriptionId: 'p1',
      industryCategory: null,
      crisisType: null,
      monthlyBudgetAud: null,
      market: null,
      businessSize: null,
      prescriptionSummary: null,
      selfGradeOverall: null,
    })
    expect(result).toBeNull()
  })

  it('does not throw even when supabase throws', async () => {
    const fromFn = vi.fn().mockImplementation(() => {
      throw new Error('network error')
    })
    const supabase = { from: fromFn }

    await expect(
      savePrescriptionCase(supabase as never, {
        clientId: 'c1',
        discoveryId: 'd1',
        prescriptionId: 'p1',
        industryCategory: null,
        crisisType: null,
        monthlyBudgetAud: null,
        market: null,
        businessSize: null,
        prescriptionSummary: null,
        selfGradeOverall: null,
      }),
    ).resolves.toBeNull()
  })
})
