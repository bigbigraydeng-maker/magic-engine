import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkOrderPrechecks } from './guards'
import type { PromoteOrder, TrafficRow } from './types'
import type { PublishTarget } from '../../types'

vi.mock('@/lib/social/content-review', () => ({
  REEL_AUTO_CHECK_KEYS: ['a', 'b'],
  humanKeysForReviewRef: () => ['h1', 'h2'],
  validateContentChecklist: vi.fn(() => ({ ok: true, items: [] })),
  checklistPasses: vi.fn(() => true),
}))

import {
  validateContentChecklist,
  checklistPasses,
} from '@/lib/social/content-review'

// ── 测试夹具 ──────────────────────────────────────────────────────────────────

function makeTarget(overrides: Partial<PublishTarget> = {}): PublishTarget {
  return {
    platform: 'facebook',
    page_id: 'page-1',
    expect_brand: 'Acme',
    client_id: 'client-1',
    ...overrides,
  } as PublishTarget
}

function makeOrder(overrides: Partial<PromoteOrder> = {}): PromoteOrder {
  return {
    id: 'wo-1',
    client_id: 'client-1',
    status: 'published',
    master_brief_id: 'mb-1',
    brief: {},
    output: { quality_checklist_auto: { a: true, b: true } },
    review_ref: {
      checklist_human: { h1: true, h2: true },
      approved_at: '2026-10-18T00:00:00.000Z',
    },
    published_ref: {
      video_state: 'DRAFT',
      video_id: 'vid-1',
      page_id: 'page-1',
    },
    updated_at: '2026-10-18T00:00:00.000Z',
    ...overrides,
  }
}

function makeRow(overrides: Partial<TrafficRow> = {}): TrafficRow {
  return {
    id: 'row-1',
    client_id: 'client-1',
    payload: { video_id: 'vid-1', page_id: 'page-1' },
    ...overrides,
  }
}

beforeEach(() => {
  vi.mocked(validateContentChecklist).mockReturnValue({ ok: true, items: [] })
  vi.mocked(checklistPasses).mockReturnValue(true)
})

// ── checkOrderPrechecks · on-camera consent ──────────────────────────────────

describe('checkOrderPrechecks · on-camera consent', () => {
  it('factory order with no maliang check passes', () => {
    const res = checkOrderPrechecks({
      order: makeOrder(),
      rows: [makeRow()],
      target: makeTarget(),
    })
    expect(res.ok).toBe(true)
  })

  it('external upload with no talent_consent is rejected with 409', () => {
    const res = checkOrderPrechecks({
      order: makeOrder({ brief: { engine: 'external_upload' } }),
      rows: [makeRow()],
      target: makeTarget(),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(409)
      expect(res.error).toContain('出镜授权')
    }
  })

  it('external upload with granted consent and passing v2 maliang check passes', () => {
    const res = checkOrderPrechecks({
      order: makeOrder({
        brief: {
          engine: 'external_upload',
          talent_consent: {
            status: 'granted',
            scope: ['facebook_organic'],
            subject: 'guest',
            confirmed_by: 'system:pm-chat',
            confirmed_at: '2026-11-04T00:00:00.000Z',
            evidence: 'PM chat',
          },
        },
        output: {
          quality_checklist_auto: { a: true, b: true },
          maliang_check: {
            check_version: 'v2',
            status: 'pass',
            identifiable_faces: [{ t_start: 0, t_end: 2, count: 1 }],
          },
        },
      }),
      rows: [makeRow()],
      target: makeTarget(),
    })
    expect(res.ok).toBe(true)
  })

  it('external upload with unverifiable maliang check is rejected with 409', () => {
    const res = checkOrderPrechecks({
      order: makeOrder({
        brief: {
          engine: 'external_upload',
          talent_consent: {
            status: 'granted',
            scope: ['facebook_organic'],
            subject: 'guest',
            confirmed_by: 'system:pm-chat',
            confirmed_at: '2026-11-04T00:00:00.000Z',
            evidence: 'PM chat',
          },
        },
        output: {
          quality_checklist_auto: { a: true, b: true },
          maliang_check: {
            check_version: 'v2',
            status: 'unverifiable',
            identifiable_faces: [{ t_start: 0, t_end: 2, count: 1 }],
          },
        },
      }),
      rows: [makeRow()],
      target: makeTarget(),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(409)
  })

  it('factory order with v2 maliang showing a face and no consent is not gated yet (known gap)', () => {
    const res = checkOrderPrechecks({
      order: makeOrder({
        output: {
          quality_checklist_auto: { a: true, b: true },
          maliang_check: {
            check_version: 'v2',
            status: 'pass',
            identifiable_faces: [{ t_start: 0, t_end: 2, count: 1 }],
          },
        },
      }),
      rows: [makeRow()],
      target: makeTarget(),
    })
    expect(res.ok).toBe(true)
  })
})
