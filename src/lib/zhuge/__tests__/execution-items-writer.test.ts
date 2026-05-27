/**
 * Tests for writeExecutionItems — P24.A.3
 *
 * Covers deduplication, supersede, skip, and insert paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writeExecutionItems, executionModeToFixType, actionTypeToTitle } from '../action-persister'
import type { PriorityAction, DiagnosticDimension } from '../types'
import type { ExecutionMode } from '@/lib/flywheel/adapters/types'

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeAction(
  dimension: DiagnosticDimension,
  action_type: string,
  rank = 1,
  execution_mode: ExecutionMode = 'in_house',
): PriorityAction {
  return {
    rank,
    dimension,
    action_type,
    why_now: `Why now for ${action_type}`,
    evidence_refs: [],
    expected_impact: 'medium',
    effort: 'low',
    execution_mode,
    executable_by: null,
  }
}

// ── Mock builder ───────────────────────────────────────────────────────────────
//
// execution_items call sequence in writeExecutionItems:
//   call 1: select().eq().eq().in()  — dedup check
//   call 2: update({ status }).in()  — supersede (only if toSupersede.length > 0)
//   call 2/3: insert(rows)           — new items (only if toInsert.length > 0)
//
// The mock exposes a single "mutation chain" for calls 2+ that supports both
// update (→ .in()) and insert so tests covering either path work correctly.

interface ExistingRow {
  id: string
  action_type: string
  source: string
  zhuge_session_id: string | null
}

function makeSupabase(
  existingRows: ExistingRow[],
  insertError: { message: string } | null = null,
) {
  const updateInFn = vi.fn().mockResolvedValue({ error: null })
  const updateFn   = vi.fn().mockReturnValue({ in: updateInFn })
  const insertFn   = vi.fn().mockResolvedValue({ error: insertError })

  // First call: select chain for dedup lookup
  const selectChain = {
    select: vi.fn().mockReturnThis(),
    eq:     vi.fn().mockReturnThis(),
    in:     vi.fn().mockResolvedValue({ data: existingRows, error: null }),
  }

  // Subsequent calls: mutation chain (supports both update and insert)
  const mutationChain = { update: updateFn, insert: insertFn }

  let executionCallCount = 0

  const supabase = {
    from: vi.fn((table: string) => {
      if (table !== 'execution_items') {
        return { insert: vi.fn().mockResolvedValue({ error: null }) }
      }
      executionCallCount++
      return executionCallCount === 1 ? selectChain : mutationChain
    }),
    // Exposed for assertion
    _selectChain:  selectChain,
    _updateFn:     updateFn,
    _updateInFn:   updateInFn,
    _insertFn:     insertFn,
  }
  return supabase
}

beforeEach(() => vi.clearAllMocks())

// ── actionTypeToTitle ──────────────────────────────────────────────────────────

describe('actionTypeToTitle()', () => {
  it('converts dotted slug to title case', () => {
    expect(actionTypeToTitle('seo.fix_meta_titles')).toBe('Fix Meta Titles')
  })

  it('handles single-segment slug', () => {
    expect(actionTypeToTitle('publish_content')).toBe('Publish Content')
  })

  it('handles multi-segment slug taking last part', () => {
    expect(actionTypeToTitle('geo.deploy_directive')).toBe('Deploy Directive')
  })
})

// ── executionModeToFixType ─────────────────────────────────────────────────────

describe('executionModeToFixType()', () => {
  it('maps in_house → me_auto', () => {
    expect(executionModeToFixType('in_house')).toBe('me_auto')
  })

  it('maps third_party → third_party', () => {
    expect(executionModeToFixType('third_party')).toBe('third_party')
  })

  it('maps external_manual → fde_manual', () => {
    expect(executionModeToFixType('external_manual')).toBe('fde_manual')
  })
})

// ── writeExecutionItems ────────────────────────────────────────────────────────

describe('writeExecutionItems()', () => {
  it('inserts new items when no existing pending rows', async () => {
    const supabase = makeSupabase([])
    const actions = [
      makeAction('seo',          'seo.fix_meta_titles', 1),
      makeAction('ai_visibility','geo.deploy_directive', 2),
    ]

    const result = await writeExecutionItems(
      supabase as never,
      'client-1',
      'session-uuid-1',
      actions,
    )

    expect(result.inserted).toBe(2)
    expect(result.superseded).toBe(0)
    expect(supabase._insertFn).toHaveBeenCalledTimes(1)

    const rows = supabase._insertFn.mock.calls[0][0] as Array<{
      action_type: string; source: string; status: string; zhuge_session_id: string
    }>
    expect(rows).toHaveLength(2)
    expect(rows[0].action_type).toBe('seo.fix_meta_titles')
    expect(rows[0].source).toBe('zhuge')
    expect(rows[0].status).toBe('pending')
    expect(rows[0].zhuge_session_id).toBe('session-uuid-1')
  })

  it('supersedes old zhuge pending row when re-running', async () => {
    const existing: ExistingRow[] = [
      { id: 'old-item-1', action_type: 'seo.fix_meta_titles', source: 'zhuge', zhuge_session_id: 'old-session' },
    ]
    const supabase = makeSupabase(existing)
    const actions  = [makeAction('seo', 'seo.fix_meta_titles', 1)]

    const result = await writeExecutionItems(
      supabase as never,
      'client-1',
      'new-session-uuid',
      actions,
    )

    expect(result.superseded).toBe(1)
    expect(result.inserted).toBe(1)
    // Should have called update with superseded status
    expect(supabase._updateFn).toHaveBeenCalledWith({ status: 'superseded' })
    expect(supabase._updateInFn).toHaveBeenCalledWith('id', ['old-item-1'])
    // Should have inserted the new item
    expect(supabase._insertFn).toHaveBeenCalledTimes(1)
  })

  it('skips action when a non-zhuge pending row already exists', async () => {
    const existing: ExistingRow[] = [
      { id: 'fde-item-1', action_type: 'seo.fix_meta_titles', source: 'fde', zhuge_session_id: null },
    ]
    const supabase = makeSupabase(existing)
    const actions  = [makeAction('seo', 'seo.fix_meta_titles', 1)]

    const result = await writeExecutionItems(
      supabase as never,
      'client-1',
      'session-uuid',
      actions,
    )

    expect(result.inserted).toBe(0)
    expect(result.superseded).toBe(0)
    expect(supabase._updateFn).not.toHaveBeenCalled()
    expect(supabase._insertFn).not.toHaveBeenCalled()
  })

  it('returns early with zeros when actions list is empty', async () => {
    const supabase = makeSupabase([])

    const result = await writeExecutionItems(supabase as never, 'client-1', null, [])

    expect(result.inserted).toBe(0)
    expect(result.superseded).toBe(0)
    expect(supabase.from).not.toHaveBeenCalled()
  })

  it('handles mixed: one new, one skip (fde), one supersede', async () => {
    const existing: ExistingRow[] = [
      { id: 'zhuge-old', action_type: 'seo.old_action',  source: 'zhuge', zhuge_session_id: 'prev-session' },
      { id: 'fde-item',  action_type: 'geo.fde_action',  source: 'fde',   zhuge_session_id: null },
    ]
    const supabase = makeSupabase(existing)
    const actions  = [
      makeAction('seo',          'seo.old_action', 1),  // supersede old zhuge
      makeAction('ai_visibility','geo.fde_action', 2),  // skip (fde owns it)
      makeAction('ads',          'ads.new_action', 3),  // new insert
    ]

    const result = await writeExecutionItems(
      supabase as never,
      'client-1',
      'current-session',
      actions,
    )

    expect(result.superseded).toBe(1)
    // seo.old_action (after supersede) + ads.new_action = 2 inserted
    expect(result.inserted).toBe(2)
  })

  it('throws on insert DB error', async () => {
    const supabase = makeSupabase([], { message: 'FK violation' })
    const actions  = [makeAction('seo', 'seo.fix', 1)]

    await expect(
      writeExecutionItems(supabase as never, 'client-1', null, actions),
    ).rejects.toThrow('FK violation')
  })

  it('maps all action dimensions and fix_types correctly', async () => {
    const supabase = makeSupabase([])
    const actions  = [
      makeAction('seo',           'seo.fix',       1, 'in_house'),
      makeAction('ai_visibility', 'geo.deploy',    2, 'in_house'),
      makeAction('ads',           'ads.pause',     3, 'third_party'),
      makeAction('social',        'social.post',   4, 'in_house'),
      makeAction('reputation',    'rep.monitor',   5, 'external_manual'),
      makeAction('competitor',    'comp.analysis', 6, 'external_manual'),
    ]

    const result = await writeExecutionItems(supabase as never, 'client-1', null, actions)

    expect(result.inserted).toBe(6)
    const rows = supabase._insertFn.mock.calls[0][0] as Array<{
      dimension: string
      fix_type: string
    }>
    expect(rows[0]).toMatchObject({ dimension: 'seo',           fix_type: 'me_auto' })
    expect(rows[1]).toMatchObject({ dimension: 'ai_visibility', fix_type: 'me_auto' })
    expect(rows[2]).toMatchObject({ dimension: 'ads',           fix_type: 'third_party' })
    expect(rows[3]).toMatchObject({ dimension: 'social',        fix_type: 'me_auto' })
    expect(rows[4]).toMatchObject({ dimension: 'reputation',    fix_type: 'fde_manual' })
    expect(rows[5]).toMatchObject({ dimension: 'competitor',    fix_type: 'fde_manual' })
  })

  it('passes null zhuge_session_id when no session id available', async () => {
    const supabase = makeSupabase([])
    const actions  = [makeAction('seo', 'seo.fix', 1)]

    await writeExecutionItems(supabase as never, 'client-1', null, actions)

    const rows = supabase._insertFn.mock.calls[0][0] as Array<{ zhuge_session_id: null }>
    expect(rows[0].zhuge_session_id).toBeNull()
  })
})
