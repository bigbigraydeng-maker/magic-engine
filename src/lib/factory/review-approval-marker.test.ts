// Approval marker tests for applyApprove — verifies the marker is written into
// review_ref, existing keys are preserved, stale marker keys are dropped when no
// marker is passed, and the budget gate still blocks before any update.

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyApprove, type ApprovalMarker } from './review-apply'
import { REEL_AUTO_CHECK_KEYS, REEL_HUMAN_CHECK_KEYS_V2 } from '@/lib/social/content-review'

type Resp = { data: unknown; error: unknown }

/** Thenable builder that records update payloads and consumes a response queue per await. */
function mockSupabase(queue: Resp[]): { db: SupabaseClient; updates: unknown[] } {
  let i = 0
  const updates: unknown[] = []
  const builder: Record<string, unknown> = {}
  const passthrough = ['select', 'eq', 'in', 'order', 'limit', 'maybeSingle', 'single']
  for (const m of passthrough) builder[m] = () => builder
  builder.update = (payload: unknown) => {
    updates.push(payload)
    return builder
  }
  builder.insert = () => builder
  ;(builder as { then: unknown }).then = (resolve: (r: Resp) => unknown) =>
    resolve(queue[i++] ?? { data: null, error: null })
  const db = { from: () => builder } as unknown as SupabaseClient
  return { db, updates }
}

const IN_REVIEW_WO = {
  id: 'wo-1', client_id: 'c-1', status: 'in_review', review_ref: {},
  output: { quality_checklist_auto: REEL_AUTO_CHECK_KEYS.map(key => ({ key, judge: 'AUTO', outcome: 'PASS', detail: 'measured', source_ref: null })) },
  brief: { segments: [] }, signal_id: 's-1', goal_id: 'g-1', master_brief_id: 'mb-1',
  winner_structure_id: null, order_type: 'fresh_angle', angle: 'X',
  angle_source: {}, rationale_one_liner: 'why', budget_cap_usd: 2, source_ad_id: 'ad-1',
}

const PASS_HUMAN = REEL_HUMAN_CHECK_KEYS_V2.map(key => ({
  key, judge: 'HUMAN' as const, outcome: 'PASS' as const, detail: null,
  source_ref: key.startsWith('factual_') ? 'https://example.test/source' : null,
}))

type Written = { status?: string; review_ref?: Record<string, unknown> }
const written = (updates: unknown[]): Written => (updates[0] ?? {}) as Written

describe('applyApprove — approval marker', () => {
  it('writes marker into review_ref alongside approved_by and checklist_human', async () => {
    const { db, updates } = mockSupabase([
      { data: IN_REVIEW_WO, error: null },
      { data: [{ id: 'wo-1' }], error: null },
    ])
    const marker: ApprovalMarker = { approval_source: 'me_review_route', approver_scope: 'internal_staff' }
    const r = await applyApprove(db, 'wo-1', 'me@x.com', undefined, PASS_HUMAN, marker)
    expect(r.ok).toBe(true)
    const w = written(updates)
    expect(w.status).toBe('approved')
    expect(w.review_ref?.approval_source).toBe('me_review_route')
    expect(w.review_ref?.approver_scope).toBe('internal_staff')
    expect(w.review_ref?.approved_by).toBe('me@x.com')
    expect(Array.isArray(w.review_ref?.checklist_human)).toBe(true)
  })

  it('writes scoped_admin approver_scope exactly as given', async () => {
    const { db, updates } = mockSupabase([
      { data: IN_REVIEW_WO, error: null },
      { data: [{ id: 'wo-1' }], error: null },
    ])
    const marker: ApprovalMarker = { approval_source: 'me_review_route', approver_scope: 'scoped_admin' }
    const r = await applyApprove(db, 'wo-1', 'me@x.com', undefined, PASS_HUMAN, marker)
    expect(r.ok).toBe(true)
    expect(written(updates).review_ref?.approver_scope).toBe('scoped_admin')
  })

  it('preserves existing review_ref keys', async () => {
    const wo = { ...IN_REVIEW_WO, review_ref: { publish_budget_usd: 10, note: 'keep' } }
    const { db, updates } = mockSupabase([
      { data: wo, error: null },
      { data: [{ id: 'wo-1' }], error: null },
    ])
    const marker: ApprovalMarker = { approval_source: 'me_review_route', approver_scope: 'internal_staff' }
    const r = await applyApprove(db, 'wo-1', 'me@x.com', undefined, PASS_HUMAN, marker)
    expect(r.ok).toBe(true)
    const ref = written(updates).review_ref
    expect(ref?.publish_budget_usd).toBe(10)
    expect(ref?.note).toBe('keep')
  })

  it('drops stale marker keys when no marker is passed', async () => {
    const wo = {
      ...IN_REVIEW_WO,
      review_ref: { approval_source: 'me_review_route', approver_scope: 'internal_staff' },
    }
    const { db, updates } = mockSupabase([
      { data: wo, error: null },
      { data: [{ id: 'wo-1' }], error: null },
    ])
    const r = await applyApprove(db, 'wo-1', 'me@x.com', undefined, PASS_HUMAN)
    expect(r.ok).toBe(true)
    const ref = written(updates).review_ref ?? {}
    expect('approval_source' in ref).toBe(false)
    expect('approver_scope' in ref).toBe(false)
  })

  it('budget gate refuses before any update even with a marker', async () => {
    const wo = { ...IN_REVIEW_WO, review_ref: { publish_budget_usd: 99 } }
    const { db, updates } = mockSupabase([{ data: wo, error: null }])
    const marker: ApprovalMarker = { approval_source: 'me_review_route', approver_scope: 'internal_staff' }
    const r = await applyApprove(db, 'wo-1', 'me@x.com', undefined, PASS_HUMAN, marker)
    expect(r.ok).toBe(false)
    expect(r.status).toBe(422)
    expect(updates).toHaveLength(0)
  })
})
