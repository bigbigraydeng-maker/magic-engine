/**
 * Tests for writeExecutionItems — P24.A.3
 *
 * Covers deduplication, supersede, skip, and insert paths.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writeExecutionItems, executionModeToFixType, actionTypeToTitle, executionItemDedupKey } from '../action-persister'
import type { PriorityAction, DiagnosticDimension } from '../types'
import type { ExecutionMode } from '@/lib/flywheel/adapters/types'

// ── Fixtures ───────────────────────────────────────────────────────────────────

function makeAction(
  dimension: DiagnosticDimension,
  action_type: string,
  rank = 1,
  execution_mode: ExecutionMode = 'in_house',
  metadata?: Record<string, unknown>,
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
    ...(metadata ? { metadata } : {}),
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
  steps_json?: Record<string, unknown> | null
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
    expect(actionTypeToTitle('seo.publish_blog')).toBe('Publish Blog')
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

// ── executionItemDedupKey ──────────────────────────────────────────────────────

describe('executionItemDedupKey()', () => {
  it('treats two spellings of the same page as one key', () => {
    expect(
      executionItemDedupKey('seo.optimize_page_seo', null, 'https://www.example.com/a/'),
    ).toBe(executionItemDedupKey('seo.optimize_page_seo', null, 'http://example.com/a'))
  })

  it('gives different pages different keys', () => {
    expect(
      executionItemDedupKey('seo.optimize_page_seo', null, 'https://example.com/a'),
    ).not.toBe(executionItemDedupKey('seo.optimize_page_seo', null, 'https://example.com/b'))
  })

  it('falls back to the old key format when no URL is present', () => {
    expect(executionItemDedupKey('seo.refresh_blog', 'Keyword')).toBe('seo.refresh_blog::keyword')
  })

  it('falls back to the old key format when the URL is unparseable', () => {
    expect(executionItemDedupKey('seo.refresh_blog', 'Keyword', 'not a url')).toBe(
      'seo.refresh_blog::keyword',
    )
  })
})

// ── writeExecutionItems ────────────────────────────────────────────────────────

describe('writeExecutionItems()', () => {
  it('inserts new items when no existing pending rows', async () => {
    const supabase = makeSupabase([])
    const actions = [
      makeAction('seo',          'seo.publish_blog', 1),
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
    expect(rows[0].action_type).toBe('seo.publish_blog')
    expect(rows[0].source).toBe('zhuge')
    expect(rows[0].status).toBe('pending')
    expect(rows[0].zhuge_session_id).toBe('session-uuid-1')
  })

  it('supersedes old zhuge pending row when re-running', async () => {
    const existing: ExistingRow[] = [
      { id: 'old-item-1', action_type: 'seo.publish_blog', source: 'zhuge', zhuge_session_id: 'old-session' },
    ]
    const supabase = makeSupabase(existing)
    const actions  = [makeAction('seo', 'seo.publish_blog', 1)]

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
      { id: 'fde-item-1', action_type: 'seo.publish_blog', source: 'fde', zhuge_session_id: null },
    ]
    const supabase = makeSupabase(existing)
    const actions  = [makeAction('seo', 'seo.publish_blog', 1)]

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
      { id: 'zhuge-old', action_type: 'seo.refresh_blog',  source: 'zhuge', zhuge_session_id: 'prev-session' },
      { id: 'fde-item',  action_type: 'geo.compose_directive',  source: 'fde',   zhuge_session_id: null },
    ]
    const supabase = makeSupabase(existing)
    const actions  = [
      makeAction('seo',          'seo.refresh_blog', 1),  // supersede old zhuge
      makeAction('ai_visibility','geo.compose_directive', 2),  // skip (fde owns it)
      makeAction('ads',          'ads.pause_campaign', 3),  // new insert
    ]

    const result = await writeExecutionItems(
      supabase as never,
      'client-1',
      'current-session',
      actions,
    )

    expect(result.superseded).toBe(1)
    // seo.refresh_blog (after supersede) + ads.pause_campaign = 2 inserted
    expect(result.inserted).toBe(2)
  })

  it('throws on insert DB error', async () => {
    const supabase = makeSupabase([], { message: 'FK violation' })
    const actions  = [makeAction('seo', 'seo.publish_blog', 1)]

    await expect(
      writeExecutionItems(supabase as never, 'client-1', null, actions),
    ).rejects.toThrow('FK violation')
  })

  it('maps all action dimensions and fix_types correctly', async () => {
    const supabase = makeSupabase([])
    const actions  = [
      makeAction('seo',           'seo.publish_blog',    1, 'in_house'),
      makeAction('ai_visibility', 'geo.deploy_directive', 2, 'in_house'),
      makeAction('ads',           'ads.pause_campaign',   3, 'third_party'),
      makeAction('social',        'social.publish_post',  4, 'in_house'),
    ]

    const result = await writeExecutionItems(supabase as never, 'client-1', null, actions)

    expect(result.inserted).toBe(4)
    expect(result.manualReview).toBe(0)
    const rows = supabase._insertFn.mock.calls[0][0] as Array<{
      dimension: string
      fix_type: string
      status: string
    }>
    expect(rows[0]).toMatchObject({ dimension: 'seo',           fix_type: 'me_auto', status: 'pending' })
    expect(rows[1]).toMatchObject({ dimension: 'ai_visibility', fix_type: 'me_auto', status: 'pending' })
    expect(rows[2]).toMatchObject({ dimension: 'ads',           fix_type: 'third_party', status: 'pending' })
    expect(rows[3]).toMatchObject({ dimension: 'social',        fix_type: 'me_auto', status: 'pending' })
  })

  it('parks an invented action type as manual review instead of pending', async () => {
    const supabase = makeSupabase([])
    const actions = [
      makeAction('ads', 'launch_google_search_ads_3pl', 1, 'in_house'),
      makeAction('seo', 'configure_target_keywords', 2, 'external_manual'),
    ]

    const result = await writeExecutionItems(supabase as never, 'client-1', 'session-1', actions)

    expect(result.inserted).toBe(0)
    expect(result.manualReview).toBe(2)
    const rows = supabase._insertFn.mock.calls[0][0] as Array<{
      action_type: string
      status: string
      steps_json: { invented_action_type: string; disposition: string }
    }>
    expect(rows.every((row) => row.status === 'skipped')).toBe(true)
    expect(rows.every((row) => row.action_type === 'manual_review')).toBe(true)
    expect(rows.map((row) => row.steps_json.invented_action_type)).toEqual([
      'launch_google_search_ads_3pl',
      'configure_target_keywords',
    ])
  })

  it('passes null zhuge_session_id when no session id available', async () => {
    const supabase = makeSupabase([])
    const actions  = [makeAction('seo', 'seo.publish_blog', 1)]

    await writeExecutionItems(supabase as never, 'client-1', null, actions)

    const rows = supabase._insertFn.mock.calls[0][0] as Array<{ zhuge_session_id: null }>
    expect(rows[0].zhuge_session_id).toBeNull()
  })

  // ── Keyed dedup (2026-08-01 Sungenix duplicate-cards incident) ───────────────

  it('supersedes only the row with the matching keyword, not siblings of the same action_type', async () => {
    // Patrol emits 2 cards of one action_type for 2 keywords. Old bug: the
    // Map keyed by action_type kept ONE existing row, so re-runs superseded
    // one keyword's card while the other accumulated +1 per day.
    const existing: ExistingRow[] = [
      { id: 'old-sunscreen', action_type: 'seo.refresh_blog', source: 'zhuge', zhuge_session_id: 's1', steps_json: { keyword: 'how often apply sunscreen' } },
      { id: 'old-phoenix',   action_type: 'seo.refresh_blog', source: 'zhuge', zhuge_session_id: 's1', steps_json: { keyword: 'phoenix beauty eastwood' } },
    ]
    const supabase = makeSupabase(existing)
    const actions = [
      makeAction('seo', 'seo.refresh_blog', 1, 'in_house', { keyword: 'how often apply sunscreen' }),
      makeAction('seo', 'seo.refresh_blog', 2, 'in_house', { keyword: 'phoenix beauty eastwood' }),
    ]

    const result = await writeExecutionItems(supabase as never, 'client-1', 's2', actions)

    expect(result.superseded).toBe(2)
    expect(result.inserted).toBe(2)
    expect(supabase._updateInFn).toHaveBeenCalledWith('id', ['old-sunscreen', 'old-phoenix'])
  })

  it('supersedes ALL accumulated duplicate rows sharing one key', async () => {
    const existing: ExistingRow[] = [
      { id: 'dup-1', action_type: 'seo.refresh_blog', source: 'zhuge', zhuge_session_id: 's1', steps_json: { keyword: 'kw-a' } },
      { id: 'dup-2', action_type: 'seo.refresh_blog', source: 'zhuge', zhuge_session_id: 's2', steps_json: { keyword: 'kw-a' } },
      { id: 'dup-3', action_type: 'seo.refresh_blog', source: 'zhuge', zhuge_session_id: 's3', steps_json: { keyword: 'kw-a' } },
    ]
    const supabase = makeSupabase(existing)
    const actions  = [makeAction('seo', 'seo.refresh_blog', 1, 'in_house', { keyword: 'kw-a' })]

    const result = await writeExecutionItems(supabase as never, 'client-1', 's4', actions)

    expect(result.superseded).toBe(3)
    expect(result.inserted).toBe(1)
    expect(supabase._updateInFn).toHaveBeenCalledWith('id', ['dup-1', 'dup-2', 'dup-3'])
  })

  it('inserts only one card when the same (action_type, keyword) appears twice in a batch', async () => {
    const supabase = makeSupabase([])
    const actions = [
      makeAction('seo', 'seo.refresh_blog', 1, 'in_house', { keyword: 'kw-a' }),
      makeAction('seo', 'seo.refresh_blog', 2, 'in_house', { keyword: 'kw-a' }),
      makeAction('seo', 'seo.refresh_blog', 3, 'in_house', { keyword: 'kw-b' }),
    ]

    const result = await writeExecutionItems(supabase as never, 'client-1', 's1', actions)

    expect(result.inserted).toBe(2)
    const rows = supabase._insertFn.mock.calls[0][0] as Array<{ steps_json: { keyword: string } }>
    expect(rows.map((r) => r.steps_json.keyword)).toEqual(['kw-a', 'kw-b'])
  })

  it('does not supersede a keyworded card when a keywordless action of the same type arrives', async () => {
    const existing: ExistingRow[] = [
      { id: 'patrol-card', action_type: 'seo.refresh_blog', source: 'zhuge', zhuge_session_id: 's1', steps_json: { keyword: 'kw-a' } },
    ]
    const supabase = makeSupabase(existing)
    const actions  = [makeAction('seo', 'seo.refresh_blog', 1)] // conduct-style, no metadata

    const result = await writeExecutionItems(supabase as never, 'client-1', 's2', actions)

    expect(result.superseded).toBe(0)
    expect(result.inserted).toBe(1)
  })

  it('skips insert when an fde row owns the same (action_type, keyword)', async () => {
    const existing: ExistingRow[] = [
      { id: 'fde-card', action_type: 'seo.refresh_blog', source: 'fde', zhuge_session_id: null, steps_json: { keyword: 'kw-a' } },
    ]
    const supabase = makeSupabase(existing)
    const actions  = [makeAction('seo', 'seo.refresh_blog', 1, 'in_house', { keyword: 'kw-a' })]

    const result = await writeExecutionItems(supabase as never, 'client-1', 's1', actions)

    expect(result.inserted).toBe(0)
    expect(result.superseded).toBe(0)
  })

  // ── URL-keyed dedup (not-indexed / missing-internal-link cards) ─────────────

  it('inserts both cards when two same-type actions carry different page URLs', async () => {
    const supabase = makeSupabase([])
    const actions = [
      makeAction('seo', 'seo.optimize_page_seo', 1, 'in_house', { keyword: null, url: 'https://example.com/a' }),
      makeAction('seo', 'seo.optimize_page_seo', 2, 'in_house', { keyword: null, url: 'https://example.com/b' }),
    ]

    const result = await writeExecutionItems(supabase as never, 'client-1', 's1', actions)

    expect(result.inserted).toBe(2)
    expect(result.superseded).toBe(0)
    expect(supabase._updateFn).not.toHaveBeenCalled()
  })

  it('does not supersede a pending card for a different page', async () => {
    const existing: ExistingRow[] = [
      { id: 'page-a-card', action_type: 'seo.optimize_page_seo', source: 'zhuge', zhuge_session_id: 's1', steps_json: { keyword: null, url: 'https://example.com/a' } },
    ]
    const supabase = makeSupabase(existing)
    const actions  = [
      makeAction('seo', 'seo.optimize_page_seo', 1, 'in_house', { keyword: null, url: 'https://example.com/b' }),
    ]

    const result = await writeExecutionItems(supabase as never, 'client-1', 's2', actions)

    expect(result.superseded).toBe(0)
    expect(result.inserted).toBe(1)
    expect(supabase._updateFn).not.toHaveBeenCalled()
  })

  it('supersedes a pending card for the same page written with a different URL spelling', async () => {
    const existing: ExistingRow[] = [
      { id: 'page-a-card', action_type: 'seo.optimize_page_seo', source: 'zhuge', zhuge_session_id: 's1', steps_json: { keyword: null, url: 'https://www.example.com/a/' } },
    ]
    const supabase = makeSupabase(existing)
    const actions  = [
      makeAction('seo', 'seo.optimize_page_seo', 1, 'in_house', { keyword: null, url: 'http://example.com/a' }),
    ]

    const result = await writeExecutionItems(supabase as never, 'client-1', 's2', actions)

    expect(result.superseded).toBe(1)
    expect(result.inserted).toBe(1)
    expect(supabase._updateInFn).toHaveBeenCalledWith('id', ['page-a-card'])
  })

  it('matches a row carrying page_url against an action carrying url', async () => {
    const existing: ExistingRow[] = [
      { id: 'page-a-card', action_type: 'seo.optimize_page_seo', source: 'zhuge', zhuge_session_id: 's1', steps_json: { page_url: 'https://example.com/a' } },
    ]
    const supabase = makeSupabase(existing)
    const actions  = [
      makeAction('seo', 'seo.optimize_page_seo', 1, 'in_house', { url: 'https://example.com/a' }),
    ]

    const result = await writeExecutionItems(supabase as never, 'client-1', 's2', actions)

    expect(result.superseded).toBe(1)
    expect(result.inserted).toBe(1)
    expect(supabase._updateInFn).toHaveBeenCalledWith('id', ['page-a-card'])
  })
})
