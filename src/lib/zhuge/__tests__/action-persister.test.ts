import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildSessionKey,
  persistZhugeActions,
  type PersistZhugeActionsInput,
} from '../action-persister'
import type { PriorityAction, ZhugeOutput, DiagnosticDimension } from '../types'
import type { ExecutionMode } from '@/lib/flywheel/adapters/types'

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeAction(
  dimension: DiagnosticDimension,
  action_type: string,
  execution_mode: ExecutionMode = 'in_house',
): PriorityAction {
  return {
    rank: 1,
    dimension,
    action_type,
    why_now: 'Important now',
    evidence_refs: ['finding:f-1'],
    expected_impact: 'high',
    effort: 'low',
    execution_mode,
    executable_by: null,
  }
}

function makeZhugeOutput(actions: PriorityAction[]): ZhugeOutput {
  return {
    top_actions: actions,
    generated_at: '2025-01-01T00:00:00Z',
    cost_usd: 0.01,
    input_tokens: 100,
    output_tokens: 200,
  }
}

// ── Supabase mock helpers ──────────────────────────────────────────────────────

function makeSelectChain(result: { data: { id: string }[] | null; error: null | { message: string } }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
  } as ReturnType<typeof vi.fn> & Record<string, ReturnType<typeof vi.fn>>
  // Ensure chained calls return `chain` itself
  chain.select.mockReturnValue(chain)
  chain.eq.mockReturnValue(chain)
  return chain
}

function makeInsertChain(result: { data: { id: string }[] | null; error: null | { message: string } }) {
  const selectFn = vi.fn().mockResolvedValue(result)
  const insertFn = vi.fn().mockReturnValue({ select: selectFn })
  return { insert: insertFn, _selectFn: selectFn }
}

function makeSupabaseMock(
  selectResult: { data: { id: string }[] | null; error: null | { message: string } },
  insertResult: { data: { id: string }[] | null; error: null | { message: string } },
) {
  const selectChain = makeSelectChain(selectResult)
  const { insert: insertFn } = makeInsertChain(insertResult)
  return {
    from: vi.fn()
      .mockReturnValueOnce(selectChain)
      .mockReturnValueOnce({ insert: insertFn }),
    _selectChain: selectChain,
    _insertFn: insertFn,
  }
}

beforeEach(() => vi.clearAllMocks())

// ── buildSessionKey ────────────────────────────────────────────────────────────

describe('buildSessionKey()', () => {
  it('returns a 16-char lowercase hex string', () => {
    const key = buildSessionKey('client-1', 'discovery-1', 'run-1')
    expect(key).toHaveLength(16)
    expect(key).toMatch(/^[0-9a-f]{16}$/)
  })

  it('is deterministic for the same inputs', () => {
    const a = buildSessionKey('client-1', 'discovery-1', 'run-1')
    const b = buildSessionKey('client-1', 'discovery-1', 'run-1')
    expect(a).toBe(b)
  })

  it('differs when clientId changes', () => {
    const base = buildSessionKey('c', 'd', 'r')
    expect(buildSessionKey('X', 'd', 'r')).not.toBe(base)
  })

  it('differs when discoveryId changes', () => {
    const base = buildSessionKey('c', 'd', 'r')
    expect(buildSessionKey('c', 'X', 'r')).not.toBe(base)
  })

  it('differs when diagnosticRunId changes', () => {
    const base = buildSessionKey('c', 'd', 'r')
    expect(buildSessionKey('c', 'd', 'X')).not.toBe(base)
  })

  it('differs between null and a real diagnosticRunId', () => {
    const withRun = buildSessionKey('c', 'd', 'run-1')
    const withNull = buildSessionKey('c', 'd', null)
    expect(withRun).not.toBe(withNull)
  })
})

// ── persistZhugeActions ────────────────────────────────────────────────────────

describe('persistZhugeActions()', () => {
  it('inserts rows for each mappable dimension and returns count', async () => {
    const supabase = makeSupabaseMock(
      { data: [], error: null },
      { data: [{ id: 'a1' }, { id: 'a2' }], error: null },
    )
    const input: PersistZhugeActionsInput = {
      clientId: 'client-1',
      discoveryId: 'discovery-1',
      diagnosticRunId: 'run-1',
      output: makeZhugeOutput([
        makeAction('seo', 'seo.fix_meta_titles'),
        makeAction('ai_visibility', 'geo.deploy_directive'),
      ]),
    }

    const result = await persistZhugeActions(supabase as never, input)

    expect(result.inserted).toBe(2)
    expect(result.idempotent).toBe(false)
    expect(result.action_ids).toEqual(['a1', 'a2'])
    expect(result.session_key).toHaveLength(16)
  })

  it('skips reputation and competitor dimensions (no flywheel ingest)', async () => {
    const supabase = makeSupabaseMock(
      { data: [], error: null },
      { data: [{ id: 'a1' }], error: null },
    )
    const input: PersistZhugeActionsInput = {
      clientId: 'c',
      discoveryId: 'd',
      diagnosticRunId: null,
      output: makeZhugeOutput([
        makeAction('seo', 'seo.fix_titles'),
        makeAction('reputation', 'reputation.monitoring', 'external_manual'),
        makeAction('competitor', 'competitor.analysis', 'external_manual'),
      ]),
    }

    const result = await persistZhugeActions(supabase as never, input)

    // Only the seo action is inserted (reputation + competitor skipped)
    expect(result.inserted).toBe(1)
    expect(supabase.from).toHaveBeenCalledTimes(2) // select check + insert
  })

  it('returns idempotent=true when session key already exists', async () => {
    const existingRows = [{ id: 'old-1' }, { id: 'old-2' }]
    const supabase = makeSupabaseMock(
      { data: existingRows, error: null },
      { data: [], error: null },
    )
    const input: PersistZhugeActionsInput = {
      clientId: 'c',
      discoveryId: 'd',
      diagnosticRunId: 'r',
      output: makeZhugeOutput([makeAction('seo', 'seo.fix')]),
    }

    const result = await persistZhugeActions(supabase as never, input)

    expect(result.idempotent).toBe(true)
    expect(result.inserted).toBe(0)
    expect(result.action_ids).toEqual(['old-1', 'old-2'])
    // insert was never called — only one from() call for the idempotency check
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it('returns empty result when no actions are mappable (all external_manual)', async () => {
    const supabase = makeSupabaseMock(
      { data: [], error: null },
      { data: [], error: null },
    )
    const input: PersistZhugeActionsInput = {
      clientId: 'c',
      discoveryId: 'd',
      diagnosticRunId: null,
      output: makeZhugeOutput([
        makeAction('reputation', 'rep.monitoring', 'external_manual'),
        makeAction('competitor', 'comp.analysis', 'external_manual'),
      ]),
    }

    const result = await persistZhugeActions(supabase as never, input)

    expect(result.inserted).toBe(0)
    expect(result.idempotent).toBe(false)
    expect(result.action_ids).toEqual([])
    // Only the idempotency check ran — no insert
    expect(supabase.from).toHaveBeenCalledTimes(1)
  })

  it('throws on DB error during idempotency check', async () => {
    const supabase = makeSupabaseMock(
      { data: null, error: { message: 'connection refused' } },
      { data: [], error: null },
    )
    await expect(
      persistZhugeActions(supabase as never, {
        clientId: 'c',
        discoveryId: 'd',
        diagnosticRunId: null,
        output: makeZhugeOutput([makeAction('seo', 'seo.fix')]),
      }),
    ).rejects.toThrow('connection refused')
  })

  it('throws on DB error during insert', async () => {
    const supabase = makeSupabaseMock(
      { data: [], error: null },
      { data: null, error: { message: 'FK violation' } },
    )
    await expect(
      persistZhugeActions(supabase as never, {
        clientId: 'c',
        discoveryId: 'd',
        diagnosticRunId: null,
        output: makeZhugeOutput([makeAction('seo', 'seo.fix')]),
      }),
    ).rejects.toThrow('FK violation')
  })

  it('embeds zhuge_session_key in every inserted row payload', async () => {
    let capturedRows: unknown[] = []
    const selectChain = makeSelectChain({ data: [], error: null })
    const supabase = {
      from: vi.fn()
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce({
          insert: vi.fn().mockImplementation((rows: unknown[]) => {
            capturedRows = rows
            return {
              select: vi.fn().mockResolvedValue({
                data: rows.map((_, i) => ({ id: `new-${i}` })),
                error: null,
              }),
            }
          }),
        }),
    }

    await persistZhugeActions(supabase as never, {
      clientId: 'client-1',
      discoveryId: 'discovery-1',
      diagnosticRunId: 'run-1',
      output: makeZhugeOutput([
        makeAction('seo', 'seo.fix'),
        makeAction('ads', 'ads.pause_losers', 'third_party'),
      ]),
    })

    expect(capturedRows).toHaveLength(2)
    for (const row of capturedRows as Array<{ payload: { zhuge_session_key: string } }>) {
      expect(row.payload.zhuge_session_key).toHaveLength(16)
      expect(row.payload.zhuge_session_key).toMatch(/^[0-9a-f]{16}$/)
    }
    // Both rows must share the same session key
    const keys = (capturedRows as Array<{ payload: { zhuge_session_key: string } }>)
      .map((r) => r.payload.zhuge_session_key)
    expect(new Set(keys).size).toBe(1)
  })

  it('uses correct flywheel and expected_metric for each dimension', async () => {
    let capturedRows: unknown[] = []
    const selectChain = makeSelectChain({ data: [], error: null })
    const supabase = {
      from: vi.fn()
        .mockReturnValueOnce(selectChain)
        .mockReturnValueOnce({
          insert: vi.fn().mockImplementation((rows: unknown[]) => {
            capturedRows = rows
            return {
              select: vi.fn().mockResolvedValue({
                data: rows.map((_, i) => ({ id: `id-${i}` })),
                error: null,
              }),
            }
          }),
        }),
    }

    await persistZhugeActions(supabase as never, {
      clientId: 'c',
      discoveryId: 'd',
      diagnosticRunId: null,
      output: makeZhugeOutput([
        makeAction('seo', 'seo.fix'),
        makeAction('ai_visibility', 'geo.directive'),
        makeAction('ads', 'ads.pause', 'third_party'),
        makeAction('social', 'social.post'),
      ]),
    })

    type Row = { flywheel: string; expected_metric: string }
    const rows = capturedRows as Row[]
    expect(rows[0]).toMatchObject({ flywheel: 'seo',    expected_metric: 'seo.domain.organic_traffic' })
    expect(rows[1]).toMatchObject({ flywheel: 'geo',    expected_metric: 'geo.query.mention_rate' })
    expect(rows[2]).toMatchObject({ flywheel: 'ads',    expected_metric: 'ads.account.roas' })
    expect(rows[3]).toMatchObject({ flywheel: 'social', expected_metric: 'social.posts.published_count' })
  })

  it('session_key in result matches buildSessionKey independently', async () => {
    const supabase = makeSupabaseMock(
      { data: [], error: null },
      { data: [{ id: 'x' }], error: null },
    )
    const result = await persistZhugeActions(supabase as never, {
      clientId: 'client-abc',
      discoveryId: 'disc-xyz',
      diagnosticRunId: 'run-999',
      output: makeZhugeOutput([makeAction('seo', 'seo.fix')]),
    })

    const expected = buildSessionKey('client-abc', 'disc-xyz', 'run-999')
    expect(result.session_key).toBe(expected)
  })
})
