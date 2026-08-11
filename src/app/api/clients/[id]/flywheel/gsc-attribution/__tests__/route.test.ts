/**
 * Manual GSC attribution route — the user-visible half of Issue #859's
 * write-vs-reconciliation split.
 *
 * A post-write cleanup failure does not take the outcome rows back out of the
 * database, so this route must not answer "nothing landed" (502) for a run that
 * wrote three rows. But it must still fail loudly when the writes themselves
 * failed. `errors[]` holds both kinds, so `cleanup_errors` is what tells them
 * apart — these tests pin that distinction from the caller's side.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../route'

vi.mock('@/lib/flywheel/attribution/gsc-bridge', () => ({
  runGscAttributionForClient: vi.fn(),
}))

// The route's two guards are exercised by their own suites; these tests are
// about what the body and status say once a caller is through them.
vi.mock('@/lib/auth/client-access', () => ({
  requirePaidClientAccess: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/validation-utils', () => ({
  requireBearerToken: vi.fn(() => ({ ok: true })),
}))

import { runGscAttributionForClient } from '@/lib/flywheel/attribution/gsc-bridge'
import { DUAL_WINDOW_FLAG } from '@/lib/flywheel/attribution/dual-window-gate'

const mockRun = vi.mocked(runGscAttributionForClient)

function makeRequest(body: unknown = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/clients/c1/flywheel/gsc-attribution', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer test' },
    body: JSON.stringify(body),
  })
}

const params = { id: 'c1' }

function result(over: Partial<Awaited<ReturnType<typeof runGscAttributionForClient>>> = {}) {
  return {
    client_id: 'c1',
    actions_found: 1,
    outcomes_written: 0,
    skipped: 0,
    cleanup_errors: 0,
    reconcile_errors: 0,
    errors: [] as string[],
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env[DUAL_WINDOW_FLAG] // shipped default: dual window OFF
})

describe('POST /api/clients/[id]/flywheel/gsc-attribution', () => {
  it('reports success for a clean run', async () => {
    mockRun.mockResolvedValue(result({ outcomes_written: 3 }))

    const res = await POST(makeRequest(), { params })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.outcomes_written).toBe(3)
    expect(body.cleanup_errors).toBe(0)
  })

  it('does not claim "nothing landed" when only the cleanup failed', async () => {
    // The bug: 3 rows are in the database, and this used to answer 502 with
    // outcomes_written implicitly disowned.
    mockRun.mockResolvedValue(result({
      outcomes_written: 3,
      cleanup_errors: 1,
      reconcile_errors: 0,
      errors: ['action a1: retire stale outcomes: deadlock'],
    }))

    const res = await POST(makeRequest(), { params })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true) // reconciliation debt, not a failed write
    expect(body.outcomes_written).toBe(3)
    expect(body.cleanup_errors).toBe(1)
    expect(body.errors).toHaveLength(1) // still reported, not hidden
  })

  it('fails loudly when the writes themselves failed and nothing landed', async () => {
    mockRun.mockResolvedValue(result({
      outcomes_written: 0,
      skipped: 1,
      cleanup_errors: 0,
      reconcile_errors: 0,
      errors: ['action a1: upsert outcomes: connection reset'],
    }))

    const res = await POST(makeRequest(), { params })
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.success).toBe(false)
  })

  it('does not report success when most writes failed but one landed', async () => {
    // `success` used to be "did anything at all land", so 9 failures and 1
    // success answered success:true.
    mockRun.mockResolvedValue(result({
      actions_found: 10,
      outcomes_written: 3,
      skipped: 9,
      cleanup_errors: 0,
      reconcile_errors: 0,
      errors: Array.from({ length: 9 }, (_, i) => `action a${i}: upsert outcomes: boom`),
    }))

    const res = await POST(makeRequest(), { params })
    const body = await res.json()

    expect(body.success).toBe(false)
    expect(res.status).toBe(200) // rows did land, so not 502 — but not "success"
  })

  it('separates hard failures from cleanup debt when both happen', async () => {
    mockRun.mockResolvedValue(result({
      actions_found: 2,
      outcomes_written: 3,
      cleanup_errors: 1,
      reconcile_errors: 0,
      errors: ['action a1: retire stale outcomes: x', 'action a2: upsert outcomes: y'],
    }))

    const res = await POST(makeRequest(), { params })
    const body = await res.json()

    expect(body.success).toBe(false) // one of the two is a real write failure
    expect(body.cleanup_errors).toBe(1)
    expect(body.errors).toHaveLength(2)
  })

  it('does not call a zero-write run successful just because the error was a cleanup', async () => {
    // Reachable: a page-scoped action whose page is missing from top_pages
    // writes nothing and still retires the domain keys it no longer stands
    // behind. If that retire fails, the stale rows are still on the board and
    // still feeding memory — and nothing was written to weigh against it.
    // (Codex P2, round 19.)
    mockRun.mockResolvedValue(result({
      outcomes_written: 0,
      cleanup_errors: 1,
      reconcile_errors: 0,
      errors: ['action a1: retire stale outcomes: deadlock'],
    }))

    const res = await POST(makeRequest(), { params })
    const body = await res.json()

    expect(body.success).toBe(false)
    expect(res.status).toBe(200) // still not a 502 — no write was lost
  })

  it('never answers 502 for a run whose only errors were reconciliation debt', async () => {
    // A post-write cleanup failure must never be the thing that makes this a
    // 502 — the rows landed. (This shape used to be unreachable because cleanup
    // only ran after a successful upsert; it is reachable now that the
    // pre-write half exists, which is exactly why the two are counted apart.)
    mockRun.mockResolvedValue(result({
      outcomes_written: 0,
      cleanup_errors: 1,
      reconcile_errors: 0,
      errors: ['action a1: retire stale outcomes: deadlock'],
    }))

    const res = await POST(makeRequest(), { params })

    expect(res.status).toBe(200)
  })

  it('does NOT report success when a pre-write reconciliation failed', async () => {
    // Reconciliation runs before the snapshot maturity check, so a run can end
    // with zero writes and a reconciliation error. Counting that as cleanup
    // debt would answer success:true for a run that made nothing right: the
    // unsigned rows still block the contract migration, and a duplicated window
    // is still double-counted downstream. (Codex P2, round 18.)
    mockRun.mockResolvedValue(result({
      outcomes_written: 0,
      cleanup_errors: 0,
      reconcile_errors: 1,
      errors: ['action a1: claim unsigned outcomes: permission denied'],
    }))

    const res = await POST(makeRequest(), { params })
    const body = await res.json()

    expect(body.success).toBe(false)
    expect(body.reconcile_errors).toBe(1)
    // Not a 502 either — nothing was attempted-and-lost, the run simply could
    // not reconcile. 502 stays reserved for failed writes.
    expect(res.status).toBe(200)
  })

  it('keeps the two kinds apart when both happen in one run', async () => {
    mockRun.mockResolvedValue(result({
      outcomes_written: 3,
      cleanup_errors: 1,
      reconcile_errors: 1,
      errors: [
        'action a1: retire stale outcomes: deadlock',
        'action a2: claim unsigned outcomes: permission denied',
      ],
    }))

    const res = await POST(makeRequest(), { params })
    const body = await res.json()

    expect(body.success).toBe(false) // the reconciliation half is not debt
    expect(body.outcomes_written).toBe(3) // …and the rows still landed
    expect(body.cleanup_errors).toBe(1)
    expect(body.reconcile_errors).toBe(1)
  })

  it('refuses a custom window while dual-window is gated off, and says so', async () => {
    // On main a manual run REPLACED the previous rows, so an action never held
    // two windows. The natural key now includes window_days, so a manual 7-day
    // run beside the cron's 28-day one would ADD rows — doubling the evidence
    // for consumers that still count them. The gate has to cover this path too.
    mockRun.mockResolvedValue(result({ outcomes_written: 3 }))

    const res = await POST(makeRequest({ window_days: 7 }), { params })
    const body = await res.json()

    expect(mockRun).toHaveBeenCalledWith('c1', 28) // the authoritative window
    expect(body.window_days).toBe(28)
    // Refused out loud: silently substituting 28 would let the caller read the
    // result as a 7-day answer.
    expect(body.window_override_refused).toMatchObject({ requested: 7, used: 28 })
  })

  it('honours a custom window once dual-window is enabled', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true'
    mockRun.mockResolvedValue(result({ outcomes_written: 3 }))

    const res = await POST(makeRequest({ window_days: 7 }), { params })
    const body = await res.json()

    expect(mockRun).toHaveBeenCalledWith('c1', 7)
    expect(body.window_override_refused).toBeUndefined()
  })

  it('clamps an oversized window when enabled', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true'
    mockRun.mockResolvedValue(result({ outcomes_written: 3 }))

    await POST(makeRequest({ window_days: 9999 }), { params })

    const [, clamped] = mockRun.mock.calls[0]
    expect(clamped).toBeLessThanOrEqual(90)
  })

  it('does not flag a refusal when the caller asked for the default anyway', async () => {
    mockRun.mockResolvedValue(result({ outcomes_written: 3 }))

    const res = await POST(makeRequest({ window_days: 28 }), { params })
    const body = await res.json()

    expect(body.window_override_refused).toBeUndefined()
  })
})

// ── Bodies that are valid JSON but not objects ──────────────────────────────

describe('request body handling', () => {
  it('falls back to the default window for a literal null body', async () => {
    // `req.json()` SUCCEEDS on `null`, so a plain assignment put null into the
    // parsed body and reading `.window_days` off it threw — a 500 for a request
    // that used to work. (Codex P2, round 32.)
    mockRun.mockResolvedValue(result({ outcomes_written: 3 }))

    const res = await POST(makeRequest(null), { params })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.window_days).toBe(28)
  })

  it('falls back to the default window for a non-object body', async () => {
    mockRun.mockResolvedValue(result({ outcomes_written: 3 }))

    const res = await POST(makeRequest(42), { params })

    expect(res.status).toBe(200)
    expect((await res.json()).window_days).toBe(28)
  })
})
