/**
 * Recall contract — undo an unwanted publish.
 *
 * These tests lock the fail-closed rules and the partition helper, which is
 * where a bug would either leak an unauthorised deletion or silently no-op a
 * legitimate recall. The route glue is tested elsewhere; this file stays
 * provider-free so the guarantees can be verified without a network stub.
 */

import { describe, expect, it } from 'vitest'
import {
  CampaignDailyRecallCommandSchema,
  CampaignDailyRecalledPostSchema,
  DAILY_PLAN_POST_RECALLED_EVENT,
  partitionRecallCandidates,
} from '../daily-plan-recall'

const CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'
const CAMPAIGN_ID = 'a0000000-0000-0000-0000-000000000001'
const PLAN_ID = 'b0000000-0000-0000-0000-000000000001'
const REVIEW_REVISION = '10000000-0000-0000-0000-000000000001'
const PLAN_REVISION = '2026-09-01T15:00:04.513Z'
const PAGE_ID = '1616575215312482'

function command(overrides: Record<string, unknown> = {}) {
  return {
    client_id: CLIENT_ID,
    campaign_id: CAMPAIGN_ID,
    plan_id: PLAN_ID,
    plan_revision: PLAN_REVISION,
    review_revision: REVIEW_REVISION,
    page_id: PAGE_ID,
    approved: true,
    publish_authorization: true,
    dates: ['2026-09-04'],
    ...overrides,
  }
}

describe('recall command — fail-closed authorisation', () => {
  it('defaults to no_recall=true when the caller says nothing (dry run)', () => {
    const parsed = CampaignDailyRecallCommandSchema.parse(command())
    expect(parsed.no_recall).toBe(true)
  })

  it.each([
    ['approved', { approved: false }],
    ['approved absent', { approved: undefined }],
    ['publish_authorization=false', { publish_authorization: false }],
    ['dates empty', { dates: [] }],
    ['dates missing', { dates: undefined }],
    ['plan_revision missing', { plan_revision: undefined }],
    ['page_id missing', { page_id: undefined }],
  ])('rejects a command with %s', (_label, overrides) => {
    expect(CampaignDailyRecallCommandSchema.safeParse(command(overrides)).success).toBe(false)
  })

  it('rejects a page_id that is not a numeric Meta Page id', () => {
    expect(CampaignDailyRecallCommandSchema.safeParse(command({ page_id: 'CTSTOURS' })).success).toBe(false)
  })

  it('uses a stable event name mirroring the publish event', () => {
    expect(DAILY_PLAN_POST_RECALLED_EVENT).toBe('daily_plan.post.recalled')
  })

  it('receipt schema accepts a well-formed recalled record', () => {
    expect(
      CampaignDailyRecalledPostSchema.safeParse({
        date: '2026-09-04',
        idempotency_key: 'fbpost_abc',
        post_id: '1616575215312482_1750182373580617',
        page_id: PAGE_ID,
        recalled_at: '2026-09-03T12:00:00.000Z',
        already_gone: false,
        provider_response: { success: true },
      }).success,
    ).toBe(true)
  })
})

describe('partitionRecallCandidates — the guard against silent no-ops and misfires', () => {
  const receipt = {
    published: [
      { date: '2026-09-04', idempotency_key: 'k04', post_id: 'p04', page_id: PAGE_ID },
      { date: '2026-09-05', idempotency_key: 'k05', post_id: 'p05', page_id: PAGE_ID },
      { date: '2026-09-06', idempotency_key: 'k06', post_id: 'p06', page_id: PAGE_ID },
    ],
    recalled: [
      { date: '2026-09-03', idempotency_key: 'k03', post_id: 'p03' },
    ],
  }

  it('a date currently in published[] goes to pending — that is the recallable set', () => {
    const r = partitionRecallCandidates(['2026-09-04'], receipt)
    expect(r.pending).toEqual([
      { date: '2026-09-04', idempotency_key: 'k04', post_id: 'p04', page_id: PAGE_ID },
    ])
    expect(r.already_recalled).toEqual([])
    expect(r.not_published).toEqual([])
  })

  it('a date already in recalled[] returns as already_recalled, NOT pending — no double-delete', () => {
    const r = partitionRecallCandidates(['2026-09-03'], receipt)
    expect(r.pending).toEqual([])
    expect(r.already_recalled).toEqual([{ date: '2026-09-03', idempotency_key: 'k03' }])
  })

  it('🔴 a date the caller thinks is live but the receipt never published is surfaced, not silently skipped', () => {
    // If we silently dropped these, a typo like "2026-09-99" would look like a
    // successful no-op and the caller would think the recall covered a day it
    // actually didn't. Surfacing means the human sees the mismatch.
    const r = partitionRecallCandidates(['2026-09-99'], receipt)
    expect(r.pending).toEqual([])
    expect(r.not_published).toEqual(['2026-09-99'])
  })

  it('mixed request: three dates → three buckets, none missing', () => {
    const r = partitionRecallCandidates(
      ['2026-09-04', '2026-09-03', '2026-09-99'],
      receipt,
    )
    expect(r.pending.map((p) => p.date)).toEqual(['2026-09-04'])
    expect(r.already_recalled.map((p) => p.date)).toEqual(['2026-09-03'])
    expect(r.not_published).toEqual(['2026-09-99'])
  })

  it('receipt with no recalled[] field yet is handled without crashing', () => {
    const virginReceipt = { published: receipt.published }
    const r = partitionRecallCandidates(['2026-09-04'], virginReceipt)
    expect(r.pending).toHaveLength(1)
    expect(r.already_recalled).toEqual([])
  })
})
