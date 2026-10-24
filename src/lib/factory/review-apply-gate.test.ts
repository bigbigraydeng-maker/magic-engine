// P21.J — server approval gate hardening tests.
// Proves the $50 / checklist gate enforced inside applyApprove cannot be weakened by UI changes:
// every rejection path must return ok=false with the exact status AND must not touch the DB.

import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { applyApprove } from './review-apply'
import { REEL_AUTO_CHECK_KEYS, REEL_HUMAN_CHECK_KEYS_V2 } from '@/lib/social/content-review'

type Resp = { data: unknown; error: unknown }

/** 每个 await 的查询链消费队列里下一个响应(按调用顺序)。 */
function mockSupabase(queue: Resp[]): { db: SupabaseClient; inserts: unknown[]; updates: unknown[] } {
  let i = 0
  const inserts: unknown[] = []
  const updates: unknown[] = []
  const builder: Record<string, unknown> = {}
  const passthrough = ['select', 'eq', 'in', 'order', 'limit', 'maybeSingle', 'single']
  for (const m of passthrough) builder[m] = () => builder
  builder.insert = (rows: unknown) => { inserts.push(rows); return builder }
  builder.update = (rows: unknown) => { updates.push(rows); return builder }
  ;(builder as { then: unknown }).then = (resolve: (r: Resp) => unknown) =>
    resolve(queue[i++] ?? { data: null, error: null })
  const db = { from: () => builder } as unknown as SupabaseClient
  return { db, inserts, updates }
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

const approve = (db: SupabaseClient, checklist: unknown = PASS_HUMAN) =>
  applyApprove(db, 'wo-1', 'me@x.com', undefined, checklist, null)

describe('applyApprove server gate stays strict', () => {
  it('baseline: all 9 human items PASS -> approve succeeds', async () => {
    const { db, updates } = mockSupabase([
      { data: IN_REVIEW_WO, error: null },
      { data: [{ id: 'wo-1' }], error: null },
    ])
    const res = await approve(db)
    expect(res.ok).toBe(true)
    expect(res.status).toBe(200)
    expect(updates.length).toBe(1)
  })

  it('exactly one human item FAIL -> 422, no update', async () => {
    const checklist = PASS_HUMAN.map((item, index) =>
      index === 0 ? { ...item, outcome: 'FAIL' as const, detail: 'nope' } : item,
    )
    const { db, updates } = mockSupabase([{ data: IN_REVIEW_WO, error: null }])
    const res = await approve(db, checklist)
    expect(res.ok).toBe(false)
    expect(res.status).toBe(422)
    expect(updates.length).toBe(0)
  })

  it('exactly one human item NOT_MEASURED -> 422, no update', async () => {
    const checklist = PASS_HUMAN.map((item, index) =>
      index === 0 ? { ...item, outcome: 'NOT_MEASURED' as const, detail: null } : item,
    )
    const { db, updates } = mockSupabase([{ data: IN_REVIEW_WO, error: null }])
    const res = await approve(db, checklist)
    expect(res.ok).toBe(false)
    expect(res.status).toBe(422)
    expect(updates.length).toBe(0)
  })

  it('only 8 of 9 human items submitted -> 400, no update', async () => {
    const checklist = PASS_HUMAN.slice(0, PASS_HUMAN.length - 1)
    const { db, updates } = mockSupabase([{ data: IN_REVIEW_WO, error: null }])
    const res = await approve(db, checklist)
    expect(res.ok).toBe(false)
    expect(res.status).toBe(400)
    expect(updates.length).toBe(0)
  })

  it('human item submitted with judge AUTO -> 400, no update', async () => {
    const checklist = PASS_HUMAN.map((item, index) =>
      index === 0 ? { ...item, judge: 'AUTO' as const } : item,
    )
    const { db, updates } = mockSupabase([{ data: IN_REVIEW_WO, error: null }])
    const res = await approve(db, checklist)
    expect(res.ok).toBe(false)
    expect(res.status).toBe(400)
    expect(updates.length).toBe(0)
  })

  it('stored AUTO checklist has one FAIL -> 422 with automatic checklist error, no update', async () => {
    const wo = {
      ...IN_REVIEW_WO,
      output: {
        quality_checklist_auto: IN_REVIEW_WO.output.quality_checklist_auto.map((item, index) =>
          index === 0 ? { ...item, outcome: 'FAIL' } : item,
        ),
      },
    }
    const { db, updates } = mockSupabase([{ data: wo, error: null }])
    const res = await approve(db)
    expect(res.ok).toBe(false)
    expect(res.status).toBe(422)
    expect(res.error ?? '').toContain('automatic checklist')
    expect(updates.length).toBe(0)
  })

  it('stored AUTO checklist missing entirely -> 422, no update', async () => {
    const wo = { ...IN_REVIEW_WO, output: {} }
    const { db, updates } = mockSupabase([{ data: wo, error: null }])
    const res = await approve(db)
    expect(res.ok).toBe(false)
    expect(res.status).toBe(422)
    expect(updates.length).toBe(0)
  })

  it('redline and quality flags are informational on the server; the UI must not offer one-click', async () => {
    const wo = {
      ...IN_REVIEW_WO,
      output: {
        quality_checklist_auto: IN_REVIEW_WO.output.quality_checklist_auto,
        redline_hits: ['no_medical_claims'],
        quality_flags: [{ category: 'competitor_brand', detail: 'first 3s static' }],
      },
    }
    const { db, updates } = mockSupabase([
      { data: wo, error: null },
      { data: [{ id: 'wo-1' }], error: null },
    ])
    const res = await approve(db)
    expect(res.ok).toBe(true)
    expect(res.status).toBe(200)
    expect(updates.length).toBe(1)
  })
})
