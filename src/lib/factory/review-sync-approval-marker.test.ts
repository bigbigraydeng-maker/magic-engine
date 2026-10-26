// The legacy Airtable approve path must stamp an approval marker onto review_ref,
// overwriting any stale route marker, and fall back to 'unknown' when no reviewer email is present.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from } }))

import { applyApprove } from './review-sync'
import { REEL_AUTO_CHECK_KEYS, REEL_HUMAN_CHECK_KEYS_V3 } from '@/lib/social/content-review'

type Written = { status?: string; review_ref?: Record<string, unknown> }

const humanItems = REEL_HUMAN_CHECK_KEYS_V3.map(key => ({
  key,
  judge: 'HUMAN' as const,
  outcome: 'PASS' as const,
  detail: null,
  source_ref: key.startsWith('factual_') ? 'https://example.test/source' : null,
}))

const autoItems = REEL_AUTO_CHECK_KEYS.map(key => ({
  key,
  judge: 'AUTO' as const,
  outcome: 'PASS' as const,
  detail: 'measured',
  source_ref: null,
}))

const baseWo = {
  id: 'wo-1',
  status: 'in_review',
  brief: { segments: [] },
  review_ref: { checklist_human: humanItems },
  output: { quality_checklist_auto: autoItems },
}

const record = { id: 'rec-1', fields: { '审核人': { email: 'rev@example.test' } } }

describe('review-sync applyApprove — approval marker', () => {
  let updates: unknown[]
  let builder: Record<string, unknown>

  beforeEach(() => {
    updates = []
    builder = {}
    const passthrough = ['eq', 'select']
    for (const m of passthrough) builder[m] = () => builder
    builder.update = (payload: unknown) => {
      updates.push(payload)
      return builder
    }
    ;(builder as { then: unknown }).then = (resolve: (r: { data: unknown; error: unknown }) => unknown) =>
      resolve({ data: [{ id: 'wo-1' }], error: null })
    from.mockReturnValue(builder)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('stamps airtable_sync / unverified marker and keeps checklist_human', async () => {
    const ok = await applyApprove(baseWo, record as never)
    expect(ok).toBe(true)

    const written = (updates[0] ?? {}) as Written
    expect(written.status).toBe('approved')
    const reviewRef = written.review_ref ?? {}
    expect(reviewRef.approval_source).toBe('airtable_sync')
    expect(reviewRef.approver_scope).toBe('unverified')
    expect(reviewRef.approved_by).toBe('rev@example.test')
    expect('checklist_human' in reviewRef).toBe(true)
  })

  it('overwrites a stale route marker', async () => {
    const wo = {
      ...baseWo,
      review_ref: {
        ...baseWo.review_ref,
        approval_source: 'me_review_route',
        approver_scope: 'internal_staff',
      },
    }
    const ok = await applyApprove(wo, record as never)
    expect(ok).toBe(true)

    const written = (updates[0] ?? {}) as Written
    const reviewRef = written.review_ref ?? {}
    expect(reviewRef.approval_source).toBe('airtable_sync')
    expect(reviewRef.approver_scope).toBe('unverified')
    expect(JSON.stringify(reviewRef)).not.toContain('me_review_route')
  })

  it('falls back to unknown when reviewer email is missing', async () => {
    const ok = await applyApprove(baseWo, { id: 'rec-1', fields: {} } as never)
    expect(ok).toBe(true)

    const written = (updates[0] ?? {}) as Written
    const reviewRef = written.review_ref ?? {}
    expect(reviewRef.approved_by).toBe('unknown')
    expect(reviewRef.approval_source).toBe('airtable_sync')
    expect(reviewRef.approver_scope).toBe('unverified')
  })
})
