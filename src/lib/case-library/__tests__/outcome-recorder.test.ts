/**
 * Tests for src/lib/case-library/outcome-recorder.ts — P8.12.S2.3
 * TDD: recordOutcome, calcDaysSince, pendingCheckpoints, fetchRecordedCheckpoints,
 *      backfillSemrushKpisForPrescription
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  calcDaysSince,
  pendingCheckpoints,
  recordOutcome,
  fetchRecordedCheckpoints,
  backfillSemrushKpisForPrescription,
  KPI_CHECKPOINTS,
} from '../outcome-recorder'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('@/lib/semrush/client', () => ({
  getDomainMetrics: vi.fn().mockResolvedValue({
    organic_keywords: 1200,
    organic_traffic: 8500,
    authority_score: 42,
  }),
}))

// ---------------------------------------------------------------------------
// 1. calcDaysSince
// ---------------------------------------------------------------------------

describe('calcDaysSince', () => {
  it('returns 0 for now', () => {
    const days = calcDaysSince(new Date().toISOString())
    expect(days).toBe(0)
  })

  it('returns 30 for 30 days ago', () => {
    const d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    expect(calcDaysSince(d.toISOString())).toBe(30)
  })

  it('returns 90 for 90 days ago', () => {
    const d = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    expect(calcDaysSince(d.toISOString())).toBe(90)
  })
})

// ---------------------------------------------------------------------------
// 2. pendingCheckpoints
// ---------------------------------------------------------------------------

describe('pendingCheckpoints', () => {
  it('returns [30] when exactly at day 30', () => {
    const result = pendingCheckpoints(30, new Set())
    expect(result).toEqual([30])
  })

  it('returns [30] within window (day 26)', () => {
    const result = pendingCheckpoints(26, new Set())
    expect(result).toContain(30)
  })

  it('returns [30] within window (day 37)', () => {
    expect(pendingCheckpoints(37, new Set())).toContain(30)
  })

  it('returns empty outside window (day 20)', () => {
    expect(pendingCheckpoints(20, new Set())).toHaveLength(0)
  })

  it('excludes already-recorded checkpoints', () => {
    const result = pendingCheckpoints(30, new Set([30]))
    expect(result).not.toContain(30)
  })

  it('returns [60] at day 60', () => {
    expect(pendingCheckpoints(60, new Set())).toEqual([60])
  })

  it('returns [90] at day 90', () => {
    expect(pendingCheckpoints(90, new Set())).toEqual([90])
  })

  it('returns empty at day 5 (before any window)', () => {
    expect(pendingCheckpoints(5, new Set())).toHaveLength(0)
  })

  it('KPI_CHECKPOINTS constant has 3 entries', () => {
    expect(KPI_CHECKPOINTS).toHaveLength(3)
    expect(KPI_CHECKPOINTS).toContain(30)
    expect(KPI_CHECKPOINTS).toContain(60)
    expect(KPI_CHECKPOINTS).toContain(90)
  })
})

// ---------------------------------------------------------------------------
// 3. recordOutcome — Supabase insert
// ---------------------------------------------------------------------------

function makeOutcomeMock(returnId: string | null, error: unknown = null) {
  const singleFn = vi.fn().mockResolvedValue({ data: returnId ? { id: returnId } : null, error })
  const selectFn = vi.fn().mockReturnValue({ single: singleFn })
  const insertFn = vi.fn().mockReturnValue({ select: selectFn })
  return {
    from: vi.fn().mockReturnValue({ insert: insertFn }),
    _insertFn: insertFn,
  }
}

describe('recordOutcome — happy path', () => {
  it('returns outcome_id on success', async () => {
    const { from } = makeOutcomeMock('outcome-123')
    const supabase = { from }

    const id = await recordOutcome(supabase as never, {
      prescriptionId:   'presc-1',
      caseId:           'case-1',
      clientId:         'client-1',
      kpiMetric:        'organic_traffic',
      actualValue:      5000,
      unit:             'visits/month',
      dimension:        'seo',
      daysSinceApproval: 30,
      dataSource:       'semrush_auto',
    })

    expect(id).toBe('outcome-123')
  })

  it('passes correct fields to insert', async () => {
    const singleFn = vi.fn().mockResolvedValue({ data: { id: 'x' }, error: null })
    const selectFn = vi.fn().mockReturnValue({ single: singleFn })
    const insertFn = vi.fn().mockReturnValue({ select: selectFn })
    const supabase = { from: vi.fn().mockReturnValue({ insert: insertFn }) }

    await recordOutcome(supabase as never, {
      prescriptionId:   'p1',
      caseId:           'c1',
      clientId:         'cl1',
      kpiMetric:        'authority_score',
      actualValue:      42,
      unit:             'score',
      dimension:        'seo',
      daysSinceApproval: 60,
      dataSource:       'manual_fde',
    })

    const row = insertFn.mock.calls[0][0] as Record<string, unknown>
    expect(row.prescription_id).toBe('p1')
    expect(row.case_id).toBe('c1')
    expect(row.client_id).toBe('cl1')
    expect(row.kpi_metric).toBe('authority_score')
    expect(row.actual_value).toBe(42)
    expect(row.unit).toBe('score')
    expect(row.days_since_approval).toBe(60)
    expect(row.data_source).toBe('manual_fde')
  })
})

describe('recordOutcome — silent failure', () => {
  it('returns null on DB error', async () => {
    const { from } = makeOutcomeMock(null, new Error('db error'))
    const id = await recordOutcome({ from } as never, {
      prescriptionId: 'p1', caseId: 'c1', clientId: 'cl1',
      kpiMetric: 'organic_keywords', dataSource: 'semrush_auto',
    })
    expect(id).toBeNull()
  })

  it('returns null when supabase throws', async () => {
    const supabase = { from: vi.fn().mockImplementation(() => { throw new Error('network') }) }
    const id = await recordOutcome(supabase as never, {
      prescriptionId: 'p1', caseId: 'c1', clientId: 'cl1',
      kpiMetric: 'organic_keywords', dataSource: 'semrush_auto',
    })
    expect(id).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 4. fetchRecordedCheckpoints
// ---------------------------------------------------------------------------

describe('fetchRecordedCheckpoints', () => {
  it('returns Set with correct checkpoint when days_since_approval=30', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis(),
          then: undefined,
        }),
      }),
    }
    // Chain returns
    const eqFn = vi.fn().mockReturnThis()
    const resolveFn = vi.fn().mockResolvedValue({
      data: [{ days_since_approval: 30 }],
      error: null,
    })
    supabase.from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: eqFn.mockReturnValue({
          eq: eqFn.mockReturnValue({
            eq: eqFn.mockResolvedValue({ data: [{ days_since_approval: 30 }], error: null }),
          }),
        }),
      }),
    })

    // Simpler direct mock
    const selectMock = vi.fn().mockResolvedValue({ data: [{ days_since_approval: 30 }], error: null })
    const supabase2 = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: selectMock,
            }),
          }),
        }),
      }),
    }

    const result = await fetchRecordedCheckpoints(supabase2 as never, 'p1', 'organic_keywords')
    expect(result.has(30)).toBe(true)
  })

  it('returns empty Set on error', async () => {
    const supabase = {
      from: vi.fn().mockImplementation(() => { throw new Error('fail') }),
    }
    const result = await fetchRecordedCheckpoints(supabase as never, 'p1', 'organic_keywords')
    expect(result.size).toBe(0)
  })

  it('maps days_since_approval=62 to checkpoint 60', async () => {
    const selectMock = vi.fn().mockResolvedValue({ data: [{ days_since_approval: 62 }], error: null })
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: selectMock,
            }),
          }),
        }),
      }),
    }
    const result = await fetchRecordedCheckpoints(supabase as never, 'p1', 'organic_traffic')
    expect(result.has(60)).toBe(true)
    expect(result.has(30)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 5. backfillSemrushKpisForPrescription
// ---------------------------------------------------------------------------

function makeBackfillSupabase(existingDaysList: number[] = []) {
  // Shared insert tracker
  const insertedRows: unknown[] = []
  const singleFn = vi.fn().mockImplementation(() =>
    Promise.resolve({ data: { id: `outcome-${Math.random()}` }, error: null }),
  )
  const insertFn = vi.fn().mockImplementation(row => {
    insertedRows.push(row)
    return { select: vi.fn().mockReturnValue({ single: singleFn }) }
  })

  // fetchRecordedCheckpoints mock: returns existing days
  const eqChainFn = vi.fn()
  const existingData = existingDaysList.map(d => ({ days_since_approval: d }))
  eqChainFn.mockResolvedValue({ data: existingData, error: null })

  let callCount = 0
  const fromFn = vi.fn().mockImplementation(() => {
    callCount++
    if (callCount % 2 === 0) {
      // Even calls = select (fetchRecordedCheckpoints)
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: eqChainFn,
            }),
          }),
        }),
      }
    }
    // Odd calls = insert (recordOutcome)
    return { insert: insertFn }
  })

  return { from: fromFn, _insertedRows: insertedRows, _insertFn: insertFn }
}

describe('backfillSemrushKpisForPrescription', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns outcomesWritten=0 when not in any checkpoint window (day 5)', async () => {
    const approvedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString()
    const result = await backfillSemrushKpisForPrescription(
      {} as never,
      'p1', 'c1', 'cl1', approvedAt, 'example.com',
    )
    expect(result.outcomesWritten).toBe(0)
    expect(result.skipped).toBe(0)
    expect(result.error).toBeUndefined()
  })

  it('writes 3 outcomes at day 30 (3 KPI metrics × 1 checkpoint)', async () => {
    const approvedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

    // Mock: no existing records, all inserts succeed
    const singleFn = vi.fn().mockResolvedValue({ data: { id: 'oid' }, error: null })
    const insertFn = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: singleFn }) })
    const eqFn = vi.fn().mockResolvedValue({ data: [], error: null })

    const supabase = {
      from: vi.fn().mockImplementation(() => ({
        insert: insertFn,
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: eqFn,
            }),
          }),
        }),
      })),
    }

    const result = await backfillSemrushKpisForPrescription(
      supabase as never,
      'p1', 'c1', 'cl1', approvedAt, 'example.com.au', 'au',
    )

    // 3 metrics × 1 checkpoint = 3 outcomes written
    expect(result.outcomesWritten).toBe(3)
    expect(result.error).toBeUndefined()
  })

  it('returns error field on SEMrush failure', async () => {
    const { getDomainMetrics } = await import('@/lib/semrush/client')
    vi.mocked(getDomainMetrics).mockRejectedValueOnce(new Error('SEMrush API error: 403'))

    const approvedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const supabase = { from: vi.fn() }

    const result = await backfillSemrushKpisForPrescription(
      supabase as never,
      'p1', 'c1', 'cl1', approvedAt, 'example.com',
    )

    expect(result.error).toContain('SEMrush API error: 403')
  })
})
