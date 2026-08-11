import { describe, it, expect, beforeEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { POST } from '../route'

vi.mock('@/lib/flywheel/attribution/job', () => ({
  runAttributionJob: vi.fn(),
  // Mirrors the real export; the route needs it to derive the pass-1 window it
  // forwards to pass 2. NOTE: the forwarding assertions below exercise THIS
  // mocked constant, so they cannot detect drift from the real module — the
  // real export is pinned, unmocked, in window-handoff.test.ts ("the real
  // DEFAULT_WINDOW_DAYS export is 14").
  DEFAULT_WINDOW_DAYS: 14,
}))

vi.mock('@/lib/flywheel/attribution/gsc-bridge', () => ({
  runGscAttributionForClient: vi.fn(),
}))

// Deterministic connectors table for pass 2's client discovery. Settable per
// test: data rows for connected clients, or an error to simulate a transient
// connectors-query failure.
let connectorsResult: { data: Array<{ client_id: string }> | null; error: { message: string } | null } = {
  data: [],
  error: null,
}

/** What the route wrote into cron_run_logs on finish. */
let cronLogUpdate: Record<string, unknown> | null = null

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'cron_run_logs') {
        // startCronRun / finish (run-logger.ts) — log row lifecycle. The update
        // payload is captured so tests can assert what the cron summary claims,
        // not just what the HTTP response says.
        return {
          insert: () => ({
            select: () => ({ single: async () => ({ data: { id: 'run-1' }, error: null }) }),
          }),
          update: (payload: Record<string, unknown>) => {
            cronLogUpdate = payload
            return { eq: async () => ({ data: null, error: null }) }
          },
        }
      }
      if (table === 'client_connectors') {
        return {
          select: () => ({ eq: () => ({ eq: async () => connectorsResult }) }),
        }
      }
      // Any other table is a hole in this mock, not an empty result.
      throw new Error(`route.test supabase mock: unmodelled table "${table}"`)
    },
  },
}))

import { runAttributionJob } from '@/lib/flywheel/attribution/job'
import { DUAL_WINDOW_FLAG } from '@/lib/flywheel/attribution/dual-window-gate'
import { runGscAttributionForClient } from '@/lib/flywheel/attribution/gsc-bridge'

const mockRunAttributionJob = vi.mocked(runAttributionJob)
const mockRunGscAttribution = vi.mocked(runGscAttributionForClient)

function makeRequest(
  headers: Record<string, string> = {},
  search = ''
): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/cron/attribution${search}`,
    { method: 'POST', headers }
  )
}

describe('POST /api/cron/attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-secret'
    connectorsResult = { data: [], error: null }
    cronLogUpdate = null
    delete process.env[DUAL_WINDOW_FLAG] // shipped default: dual window OFF
    mockRunGscAttribution.mockResolvedValue({
      client_id: 'abc-123',
      actions_found: 0,
      outcomes_written: 0,
      skipped: 0,
      cleanup_errors: 0,
      reconcile_errors: 0,
      errors: [],
    })
  })

  // ── Auth ────────────────────────────────────────────────────────────────────

  it('returns 500 when CRON_SECRET env var is not set', async () => {
    delete process.env.CRON_SECRET
    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toMatch(/CRON_SECRET/)
  })

  it('returns 401 when Authorization header is missing', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  it('returns 401 when Authorization header is wrong', async () => {
    const res = await POST(makeRequest({ authorization: 'Bearer wrong' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('Unauthorized')
  })

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('calls runAttributionJob with default options and returns result', async () => {
    mockRunAttributionJob.mockResolvedValue({ processed: 5, written: 3, skipped: 2, failed: 0, deferred: 0, pass2ClientIds: [], unattributable: 0, unattributableSamples: [], reconcileErrors: 0, reconcileErrorSamples: [] })

    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.processed).toBe(5)
    expect(body.written).toBe(3)
    expect(body.skipped).toBe(2)
    expect(body.timestamp).toBeDefined()

    // The window is resolved through the gate before pass 1 sees it, so the
    // default arrives as an explicit 14 rather than undefined.
    expect(mockRunAttributionJob).toHaveBeenCalledWith({
      windowDays: 14,
      clientId: undefined,
    })
  })

  it('surfaces actions deferred to another evaluator in the response', async () => {
    // Deferrals are normal routing, not failures — but they still have to be
    // visible, otherwise "pass 1 wrote nothing today" looks like a gap.
    mockRunAttributionJob.mockResolvedValue({ processed: 9, written: 4, skipped: 1, failed: 0, deferred: 4, pass2ClientIds: [], unattributable: 0, unattributableSamples: [], reconcileErrors: 0, reconcileErrorSamples: [] })

    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.deferred).toBe(4)
  })

  it('refuses a custom pass-1 window while the gate is off, and says so', async () => {
    // Pass 1 accepts a window too. On main a re-run at a different window
    // REPLACED the previous rows; the natural key now appends, so this is a
    // third route to a second window and the same gate has to cover it.
    mockRunAttributionJob.mockResolvedValue({ processed: 2, written: 2, skipped: 0, failed: 0, deferred: 0, pass2ClientIds: [], unattributable: 0, unattributableSamples: [], reconcileErrors: 0, reconcileErrorSamples: [] })

    const res = await POST(
      makeRequest({ authorization: 'Bearer test-secret' }, '?window_days=30')
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(mockRunAttributionJob).toHaveBeenCalledWith({
      windowDays: 14, // the authoritative window, not the request
      clientId: undefined,
    })
    expect(body.window_override_refused).toMatchObject({ requested: 30, used: 14 })
  })

  it('honours a custom pass-1 window once the gate is on', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true'
    mockRunAttributionJob.mockResolvedValue({ processed: 2, written: 2, skipped: 0, failed: 0, deferred: 0, pass2ClientIds: [], unattributable: 0, unattributableSamples: [], reconcileErrors: 0, reconcileErrorSamples: [] })

    const res = await POST(
      makeRequest({ authorization: 'Bearer test-secret' }, '?window_days=30')
    )
    const body = await res.json()

    expect(mockRunAttributionJob).toHaveBeenCalledWith({
      windowDays: 30,
      clientId: undefined,
    })
    expect(body.window_override_refused).toBeUndefined()
  })

  it('passes client_id query param to runAttributionJob', async () => {
    mockRunAttributionJob.mockResolvedValue({ processed: 1, written: 1, skipped: 0, failed: 0, deferred: 0, pass2ClientIds: [], unattributable: 0, unattributableSamples: [], reconcileErrors: 0, reconcileErrorSamples: [] })

    const res = await POST(
      makeRequest(
        { authorization: 'Bearer test-secret' },
        '?client_id=abc-123'
      )
    )
    expect(res.status).toBe(200)
    expect(mockRunAttributionJob).toHaveBeenCalledWith({
      windowDays: 14,
      clientId: 'abc-123',
    })
  })

  // ── Pass 1 → Pass 2 window forwarding (Issue #859, Codex P2) ───────────────
  //
  // Pass 1 defers seo.gsc.* actions to the bridge, so the window pass 1 ran at
  // must ride along — otherwise the deferred actions' answer at that window is
  // produced by nobody. client_id pins the pass-2 client list so the loop runs
  // deterministically without touching the connectors table.

  it('forwards the default pass-1 window (14) to the GSC bridge when enabled', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true'
    mockRunAttributionJob.mockResolvedValue({ processed: 1, written: 0, skipped: 0, failed: 0, deferred: 1, pass2ClientIds: [], unattributable: 0, unattributableSamples: [], reconcileErrors: 0, reconcileErrorSamples: [] })

    const res = await POST(
      makeRequest({ authorization: 'Bearer test-secret' }, '?client_id=abc-123')
    )

    expect(res.status).toBe(200)
    expect(mockRunGscAttribution).toHaveBeenCalledWith('abc-123', undefined, {
      deferredWindowDays: 14,
    })
  })

  it('forwards an explicit ?window_days=7 to the GSC bridge when enabled', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true'
    mockRunAttributionJob.mockResolvedValue({ processed: 1, written: 0, skipped: 0, failed: 0, deferred: 1, pass2ClientIds: [], unattributable: 0, unattributableSamples: [], reconcileErrors: 0, reconcileErrorSamples: [] })

    const res = await POST(
      makeRequest({ authorization: 'Bearer test-secret' }, '?window_days=7&client_id=abc-123')
    )

    expect(res.status).toBe(200)
    expect(mockRunGscAttribution).toHaveBeenCalledWith('abc-123', undefined, {
      deferredWindowDays: 7,
    })
  })

  it.each([
    ['abc', 'non-numeric'],
    ['-7', 'negative'],
    ['0', 'zero'],
  ])('sanitises ?window_days=%s (%s) to the default before forwarding', async (raw) => {
    process.env[DUAL_WINDOW_FLAG] = 'true'
    // parseInt garbage yields NaN, which `??` does not catch; forwarded raw it
    // would defeat the bridge's dedupe guard and error every deferred action.
    // Pass 1 keeps main's behaviour for the same input — only the forwarding
    // is sanitised.
    mockRunAttributionJob.mockResolvedValue({ processed: 0, written: 0, skipped: 0, failed: 0, deferred: 0, pass2ClientIds: [], unattributable: 0, unattributableSamples: [], reconcileErrors: 0, reconcileErrorSamples: [] })

    const res = await POST(
      makeRequest({ authorization: 'Bearer test-secret' }, `?window_days=${raw}&client_id=abc-123`)
    )

    expect(res.status).toBe(200)
    expect(mockRunGscAttribution).toHaveBeenCalledWith('abc-123', undefined, {
      deferredWindowDays: 14,
    })
  })

  // ── Deferred clients drive pass 2 (Codex P2, second round) ─────────────────
  //
  // A deferral is a promise that the owning evaluator will answer. The
  // connectors list only decides who ELSE pass 2 visits — a client whose GSC
  // connector is disconnected (or whose connectors query failed) must still be
  // visited when pass 1 deferred actions for them.

  it('runs pass 2 for a deferred client even when it is not in the connected list', async () => {
    connectorsResult = { data: [], error: null } // nobody connected
    mockRunAttributionJob.mockResolvedValue({
      processed: 2, written: 0, skipped: 0, failed: 0, deferred: 2,
      pass2ClientIds: ['client-disconnected'],
      unattributable: 0,
      unattributableSamples: [],
      reconcileErrors: 0,
      reconcileErrorSamples: [],
    })

    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }))

    expect(res.status).toBe(200)
    // The point of this test is that the client is visited at all; the window
    // payload is the gate's business and is asserted in the gate tests.
    expect(mockRunGscAttribution).toHaveBeenCalledWith('client-disconnected', undefined, {})
  })

  it('visits each client once when it is both connected and deferred', async () => {
    connectorsResult = { data: [{ client_id: 'client-both' }], error: null }
    mockRunAttributionJob.mockResolvedValue({
      processed: 1, written: 0, skipped: 0, failed: 0, deferred: 1,
      pass2ClientIds: ['client-both'],
      unattributable: 0,
      unattributableSamples: [],
      reconcileErrors: 0,
      reconcileErrorSamples: [],
    })

    await POST(makeRequest({ authorization: 'Bearer test-secret' }))

    const visits = mockRunGscAttribution.mock.calls.filter(([cid]) => cid === 'client-both')
    expect(visits).toHaveLength(1)
  })

  it('a connectors-query failure is surfaced AND deferred clients still run', async () => {
    // Previously this failure produced an empty client list and a clean-looking
    // run, with the only trace in console.
    connectorsResult = { data: null, error: { message: 'connection refused' } }
    mockRunAttributionJob.mockResolvedValue({
      processed: 1, written: 0, skipped: 0, failed: 0, deferred: 1,
      pass2ClientIds: ['client-deferred'],
      unattributable: 0,
      unattributableSamples: [],
      reconcileErrors: 0,
      reconcileErrorSamples: [],
    })

    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.gsc.errors.join(' ')).toContain('connection refused')
    expect(mockRunGscAttribution).toHaveBeenCalledWith('client-deferred', undefined, {})
  })

  it('leaves the bridge cadence window to the bridge (never overrides it)', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true'
    mockRunAttributionJob.mockResolvedValue({ processed: 1, written: 0, skipped: 0, failed: 0, deferred: 1, pass2ClientIds: [], unattributable: 0, unattributableSamples: [], reconcileErrors: 0, reconcileErrorSamples: [] })

    await POST(
      makeRequest({ authorization: 'Bearer test-secret' }, '?window_days=7&client_id=abc-123')
    )

    // Second positional arg stays undefined: pass 1's window changes what the
    // bridge computes IN ADDITION, not what its own 28-day cadence runs at.
    const [, cadenceWindow] = mockRunGscAttribution.mock.calls[0]
    expect(cadenceWindow).toBeUndefined()
  })

  // ── The dual-window gate (Issue #859) ──────────────────────────────────────
  //
  // Implemented and correct, but production-disabled: the memory consumers of
  // flywheel_outcomes still count rows, so enabling it would double the
  // evidence behind every deferred action and move client-visible benchmarks.

  it('does NOT forward a deferred window by default', async () => {
    // The shipped state. Production behaviour must be exactly what it was.
    mockRunAttributionJob.mockResolvedValue({
      processed: 1, written: 0, skipped: 0, failed: 0, deferred: 1, pass2ClientIds: [],
      unattributable: 0, unattributableSamples: [], reconcileErrors: 0, reconcileErrorSamples: [],
    })

    await POST(makeRequest({ authorization: 'Bearer test-secret' }, '?client_id=abc-123'))

    expect(mockRunGscAttribution).toHaveBeenCalledWith('abc-123', undefined, {})
    const [, , opts] = mockRunGscAttribution.mock.calls[0]
    expect(opts).not.toHaveProperty('deferredWindowDays')
  })

  it.each(['false', '', '1', 'yes', 'TRUE'])(
    'does not forward a deferred window for flag value %p',
    async (value) => {
      process.env[DUAL_WINDOW_FLAG] = value
      mockRunAttributionJob.mockResolvedValue({
        processed: 1, written: 0, skipped: 0, failed: 0, deferred: 1, pass2ClientIds: [],
        unattributable: 0, unattributableSamples: [], reconcileErrors: 0, reconcileErrorSamples: [],
      })

      await POST(makeRequest({ authorization: 'Bearer test-secret' }, '?client_id=abc-123'))

      expect(mockRunGscAttribution).toHaveBeenCalledWith('abc-123', undefined, {})
    },
  )

  it('forwards the deferred window only when the flag is exactly "true"', async () => {
    process.env[DUAL_WINDOW_FLAG] = 'true'
    mockRunAttributionJob.mockResolvedValue({
      processed: 1, written: 0, skipped: 0, failed: 0, deferred: 1, pass2ClientIds: [],
      unattributable: 0, unattributableSamples: [], reconcileErrors: 0, reconcileErrorSamples: [],
    })

    await POST(makeRequest({ authorization: 'Bearer test-secret' }, '?client_id=abc-123'))

    expect(mockRunGscAttribution).toHaveBeenCalledWith('abc-123', undefined, {
      deferredWindowDays: 14,
    })
  })

  it('everything else about pass 2 is unchanged while the gate is off', async () => {
    // Deferred clients still get visited; only the extra window is withheld.
    mockRunAttributionJob.mockResolvedValue({
      processed: 2, written: 0, skipped: 0, failed: 0, deferred: 2,
      pass2ClientIds: ['client-deferred'],
      unattributable: 0, unattributableSamples: [], reconcileErrors: 0, reconcileErrorSamples: [],
    })

    await POST(makeRequest({ authorization: 'Bearer test-secret' }))

    expect(mockRunGscAttribution).toHaveBeenCalledWith('client-deferred', undefined, {})
  })

  // ── Cron summary truthfulness (Codex P2 round 3) ───────────────────────────

  it('counts attributed actions from BOTH passes as completed, in one unit', async () => {
    // `completed` used to be pass-1 only, so a run whose writes all came from
    // the GSC evaluator reported zero completed. It counts ACTIONS, not outcome
    // rows — one action yields three metric rows per window, so counting rows
    // would make completed several times larger than processed.
    mockRunAttributionJob.mockResolvedValue({
      processed: 4, written: 1, skipped: 0, failed: 0, deferred: 3, pass2ClientIds: ['c1'],
      unattributable: 0, unattributableSamples: [], reconcileErrors: 0, reconcileErrorSamples: [],
    })
    mockRunGscAttribution.mockResolvedValue({
      client_id: 'c1', actions_found: 3, outcomes_written: 9, skipped: 0,
      cleanup_errors: 0,
      reconcile_errors: 0, errors: [],
    })

    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.gsc.outcomes_written).toBe(9) // 9 ROWS from 3 actions
    expect(body.written).toBe(1)
    // 1 action attributed by pass 1 + 3 by pass 2 (actions_found 3 − skipped 0).
    expect(cronLogUpdate?.completed_count).toBe(4)
    // …and completed never exceeds processed: 4 pass-1 actions + 3 pass-2 = 7.
    expect(cronLogUpdate?.processed).toBe(7)
    expect(cronLogUpdate?.completed_count as number)
      .toBeLessThanOrEqual(cronLogUpdate?.processed as number)
  })

  it('reports rows landed AND reconciliation errors at the same time', async () => {
    // A post-write cleanup failure must not reduce the written count, and must
    // still be visible as a failure — the cron summary has to say both.
    mockRunAttributionJob.mockResolvedValue({
      processed: 1, written: 0, skipped: 0, failed: 0, deferred: 1, pass2ClientIds: ['c1'],
      unattributable: 0, unattributableSamples: [], reconcileErrors: 0, reconcileErrorSamples: [],
    })
    mockRunGscAttribution.mockResolvedValue({
      client_id: 'c1', actions_found: 1, outcomes_written: 3, skipped: 0,
      cleanup_errors: 1,
      reconcile_errors: 0, errors: ['action a1: retire stale outcomes: boom'],
    })

    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.gsc.outcomes_written).toBe(3) // landed rows survive the error
    expect(body.gsc.cleanup_errors).toBe(1)
    expect(body.gsc.errors).toHaveLength(1)
    // Both facts in the cron log at once: the action was attributed, and
    // reconciliation failed. Neither cancels the other.
    expect(cronLogUpdate?.completed_count).toBe(1)
    expect(cronLogUpdate?.failed_count).toBe(1)
  })

  it('does NOT count unattributable actions as run failures', async () => {
    // They are a standing property of stored rows, recomputed identically every
    // run. Folding them into failed_count would make the daily digest email
    // "N failed / —" every day forever, with no remediation path and no
    // diagnostic text (the digest reads error_message, never summary). They stay
    // visible in the response and the run summary instead.
    mockRunAttributionJob.mockResolvedValue({
      processed: 3, written: 1, skipped: 0, failed: 0, deferred: 0, pass2ClientIds: ['c1'],
      unattributable: 2, unattributableSamples: ['geo-1', 'social-1'], reconcileErrors: 0, reconcileErrorSamples: [],
    })

    await POST(makeRequest({ authorization: 'Bearer test-secret' }))

    expect(cronLogUpdate?.failed_count).toBe(0)
    expect(cronLogUpdate?.status).toBe('completed')
    const summary = cronLogUpdate?.summary as { pass1: { unattributableSamples: string[] } }
    expect(summary.pass1.unattributableSamples).toEqual(['geo-1', 'social-1'])
  })

  it('counts pass-1 action failures in the cron log', async () => {
    // The case this exists for: the expand migration is not applied, so every
    // upsert raises 42P10. Before, those landed in `skipped` and the run was
    // logged as completed with zero failures — a total outage, reported green.
    mockRunAttributionJob.mockResolvedValue({
      processed: 5, written: 0, skipped: 0, failed: 5, deferred: 0, pass2ClientIds: [],
      unattributable: 0, unattributableSamples: [], reconcileErrors: 0, reconcileErrorSamples: [],
    })

    await POST(makeRequest({ authorization: 'Bearer test-secret' }))

    expect(cronLogUpdate?.failed_count).toBe(5)
    expect(cronLogUpdate?.completed_count).toBe(0)
  })

  it('does not count a quiet day (no data yet) as failure', async () => {
    mockRunAttributionJob.mockResolvedValue({
      processed: 5, written: 0, skipped: 5, failed: 0, deferred: 0, pass2ClientIds: [],
      unattributable: 0, unattributableSamples: [], reconcileErrors: 0, reconcileErrorSamples: [],
    })

    await POST(makeRequest({ authorization: 'Bearer test-secret' }))

    expect(cronLogUpdate?.failed_count).toBe(0)
  })

  it('surfaces unattributable actions in the response', async () => {
    // An action no evaluator can attribute is a reported failure, not a
    // silently missing outcome.
    mockRunAttributionJob.mockResolvedValue({
      processed: 2, written: 0, skipped: 0, failed: 0, deferred: 0, pass2ClientIds: [],
      unattributable: 2, unattributableSamples: ['geo-action-1', 'social-action-2'], reconcileErrors: 0, reconcileErrorSamples: [],
    })

    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.unattributable).toBe(2)
    expect(body.unattributableSamples).toEqual(['geo-action-1', 'social-action-2'])
  })

  it('does not treat unattributable actions as deferred clients for pass 2', async () => {
    // They must not drag a client into pass 2 — the bridge cannot load them.
    mockRunAttributionJob.mockResolvedValue({
      processed: 1, written: 0, skipped: 0, failed: 0, deferred: 0, pass2ClientIds: [],
      unattributable: 1, unattributableSamples: ['geo-action-1'], reconcileErrors: 0, reconcileErrorSamples: [],
    })

    await POST(makeRequest({ authorization: 'Bearer test-secret' }))

    expect(mockRunGscAttribution).not.toHaveBeenCalled()
  })

  // ── Error handling ──────────────────────────────────────────────────────────

  it('returns 500 when runAttributionJob throws', async () => {
    mockRunAttributionJob.mockRejectedValue(new Error('DB connection failed'))

    const res = await POST(makeRequest({ authorization: 'Bearer test-secret' }))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('DB connection failed')
  })
})

// ── Reconciliation failures must reach the run summary ──────────────────────

describe('pass-1 reconciliation failures are reported, not logged', () => {
  it('counts them into the cron run\u2019s failed total', async () => {
    // The action still attributed, so `written` is 1 and `failed` would have
    // been 0 — a healthy-looking run while the unsigned row keeps the contract
    // migration blocked. (Codex P1, round 18.)
    mockRunAttributionJob.mockResolvedValue({
      processed: 1, written: 1, skipped: 0, failed: 0, deferred: 0,
      pass2ClientIds: [], unattributable: 0, unattributableSamples: [],
      reconcileErrors: 2,
      reconcileErrorSamples: ['action a1: claim unsigned outcomes: permission denied'],
    })

    await POST(makeRequest({ authorization: 'Bearer test-secret' }))

    const summary = cronLogUpdate?.summary as { pass1: { reconcileErrorSamples: string[] } }
    expect(cronLogUpdate?.failed_count).toBe(2)
    expect(summary.pass1.reconcileErrorSamples[0]).toContain('claim unsigned outcomes')
  })
})
