/**
 * Poison-pill retry-cap regression for draftBatch (Phase 35 auto-sweep).
 *
 * A prospect whose email draft keeps failing must NOT (a) re-spend AI every
 * fire, nor (b) keep pickStage returning 'draft' forever and starve discovery.
 * The fix caps retries at MAX_ATTEMPTS=2: after the 2nd failure the row is
 * parked with `ai_report.draft_error`, which both draftBatch's SELECT and
 * countDraftable() exclude.
 *
 * These tests drive the real draftBatch against a chainable supabaseAdmin mock
 * so the attempt counting, the park write, and the starvation-guard SELECT
 * filter are all exercised for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Captured across the chainable mock so tests can assert on what was written.
const selectFilters: Array<[string, unknown]> = []
const updatePayloads: Array<Record<string, unknown>> = []
let resultQueue: unknown[] = []

// A minimal chainable/thenable query-builder: every method returns the same
// builder; awaiting it resolves to the next queued result (in call order).
function builder() {
  const b: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'order', 'limit', 'update'] as const) {
    b[m] = vi.fn((...args: unknown[]) => {
      if (m === 'is') selectFilters.push([args[0] as string, args[1]])
      if (m === 'update') updatePayloads.push(args[0] as Record<string, unknown>)
      return b
    })
  }
  b.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(resultQueue.shift()).then(resolve, reject)
  return b
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn(() => builder()) },
}))
// buildLeakReport is pure but irrelevant here; stub it to keep the row minimal.
vi.mock('../report', () => ({ buildLeakReport: vi.fn(() => ({})) }))
vi.mock('../outreach', () => ({ generateOutreachEmail: vi.fn() }))

import { draftBatch } from '../pipeline'
import { generateOutreachEmail } from '../outreach'

const mockGen = vi.mocked(generateOutreachEmail)

function row(ai_report: Record<string, unknown>) {
  return {
    id: 'p1', business_name: 'X Co', industry: 'flooring', city: 'auckland', country: 'NZ',
    domain: 'x.co.nz', website_url: 'https://x.co.nz', rating: 4.5, review_count: 50,
    ai_report, audit: null, score_breakdown: null, updated_at: 't0',
  }
}
const analysis = { analyzed_at: 't', segment: 'core_target' }

beforeEach(() => {
  vi.clearAllMocks()
  selectFilters.length = 0
  updatePayloads.length = 0
  resultQueue = []
})

describe('draftBatch — poison-pill retry cap', () => {
  it('SELECT excludes already-parked rows (draft_error) so pickStage can leave draft', async () => {
    resultQueue = [{ data: [] }] // empty batch; we only care about the filter args
    await draftBatch(5)
    // The starvation guard: without this filter a parked row still counts as
    // draftable and pickStage returns 'draft' forever.
    expect(selectFilters).toContainEqual(['ai_report->draft_error', null])
    expect(selectFilters).toContainEqual(['ai_report->error', null])
  })

  it('1st failure: increments draft_attempts to 1 but does NOT park (still retryable)', async () => {
    resultQueue = [
      { data: [row({ ...analysis })] }, // batch SELECT
      { data: [{ id: 'p1' }] },         // claim CAS
      {},                               // failure update
    ]
    mockGen.mockRejectedValue(new Error('overloaded'))

    const res = await draftBatch(5)

    expect(res).toEqual({ drafted: 0, failed: 1 })
    expect(mockGen).toHaveBeenCalledTimes(1) // exactly one AI burn this fire
    // [0] is the claim {updated_at}; [1] is the failure write {ai_report, updated_at}
    const patch = updatePayloads[1].ai_report as Record<string, unknown>
    expect(patch.draft_attempts).toBe(1)
    expect(patch.draft_error).toBeUndefined() // not parked → next fire retries once
  })

  it('2nd failure: reaches MAX_ATTEMPTS → writes draft_error (parks the row)', async () => {
    resultQueue = [
      { data: [row({ ...analysis, draft_attempts: 1 })] },
      { data: [{ id: 'p1' }] },
      {},
    ]
    mockGen.mockRejectedValue(new Error('overloaded'))

    const res = await draftBatch(5)

    expect(res).toEqual({ drafted: 0, failed: 1 })
    const patch = updatePayloads[1].ai_report as Record<string, unknown>
    expect(patch.draft_attempts).toBe(2)
    expect(patch.draft_error).toBe('overloaded') // parked: dropped from future draftable
  })

  it('success path still drafts and promotes to outreach_ready', async () => {
    resultQueue = [
      { data: [row({ ...analysis })] },
      { data: [{ id: 'p1' }] },
      {},
    ]
    mockGen.mockResolvedValue({ subject: 's', body: 'b', angle: 'core_target', generated_at: 't' } as never)

    const res = await draftBatch(5)

    expect(res).toEqual({ drafted: 1, failed: 0 })
    expect(updatePayloads[1].status).toBe('outreach_ready')
  })
})
