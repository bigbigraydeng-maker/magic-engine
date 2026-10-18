import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  stripInvisible,
  normalizeForCompare,
  redlineSurface,
  computeFingerprint,
  hashToken,
  hashesEqual,
  emailSlot,
  asRecord,
  checkOrderPrechecks,
} from './guards'
import type { PromoteOrder, TrafficRow } from './types'
import type { PublishTarget } from '../../types'

vi.mock('@/lib/social/content-review', () => ({
  REEL_AUTO_CHECK_KEYS: ['a', 'b'],
  humanKeysForStored: () => ['h1', 'h2'],
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

// ── stripInvisible ────────────────────────────────────────────────────────────

describe('stripInvisible', () => {
  it('removes zero-width and invisible characters', () => {
    const s = 'a\u200Bb\u200Fc\u2060d\uFEFFe\u00ADf\u2066g\u2069h'
    expect(stripInvisible(s)).toBe('abcdefgh')
  })

  it('leaves normal text untouched', () => {
    expect(stripInvisible('hello world')).toBe('hello world')
  })
})

// ── normalizeForCompare ───────────────────────────────────────────────────────

describe('normalizeForCompare', () => {
  it('strips invisible chars, NFKC-normalizes, collapses whitespace, trims', () => {
    const s = '  Ａ\u200Bcme   \t\n  Brand  '
    expect(normalizeForCompare(s)).toBe('Acme Brand')
  })

  it('folds fullwidth letters to ASCII', () => {
    expect(normalizeForCompare('ＡＢＣ')).toBe('ABC')
  })
})

// ── redlineSurface ────────────────────────────────────────────────────────────

describe('redlineSurface', () => {
  it('returns normalized text plus a punctuation/whitespace-stripped skeleton', () => {
    const out = redlineSurface('Acme Brand')
    const [a, b] = out.split('\n')
    expect(a).toBe('Acme Brand')
    expect(b).toBe('AcmeBrand')
  })

  it('defeats zero-width, fullwidth, and punctuation bypasses', () => {
    const out = redlineSurface('Ａ\u200Bc·m e')
    const [a, b] = out.split('\n')
    expect(a).toBe('Ac·m e')
    expect(b).toContain('Acme')
  })
})

// ── computeFingerprint ────────────────────────────────────────────────────────

describe('computeFingerprint', () => {
  const base = {
    videoId: 'vid-1',
    description: 'hello',
    firstComment: 'first',
    approvedAt: '2026-10-18T00:00:00.000Z',
  }

  it('is stable for identical input', () => {
    expect(computeFingerprint(base)).toBe(computeFingerprint({ ...base }))
  })

  it('is stable across invisible-char / whitespace differences in text fields', () => {
    const a = computeFingerprint(base)
    const b = computeFingerprint({
      ...base,
      description: '  hello\u200B  ',
      firstComment: 'first ',
    })
    expect(a).toBe(b)
  })

  it('changes when videoId changes', () => {
    expect(computeFingerprint(base)).not.toBe(computeFingerprint({ ...base, videoId: 'vid-2' }))
  })

  it('changes when description changes', () => {
    expect(computeFingerprint(base)).not.toBe(computeFingerprint({ ...base, description: 'other' }))
  })

  it('changes when firstComment changes', () => {
    expect(computeFingerprint(base)).not.toBe(computeFingerprint({ ...base, firstComment: 'other' }))
  })

  it('changes when approvedAt changes', () => {
    expect(computeFingerprint(base)).not.toBe(
      computeFingerprint({ ...base, approvedAt: '2026-10-19T00:00:00.000Z' }),
    )
  })
})

// ── hashToken / hashesEqual ───────────────────────────────────────────────────

describe('hashToken', () => {
  it('returns a 64-char hex sha256', () => {
    const h = hashToken('abc')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'))
  })
})

describe('hashesEqual', () => {
  it('returns true for equal hashes', () => {
    const h = hashToken('abc')
    expect(hashesEqual(h, h)).toBe(true)
  })

  it('returns false for different hashes of same length', () => {
    expect(hashesEqual(hashToken('abc'), hashToken('abd'))).toBe(false)
  })

  it('returns false for different lengths', () => {
    expect(hashesEqual('abc', 'abcd')).toBe(false)
  })
})

// ── emailSlot ─────────────────────────────────────────────────────────────────

describe('emailSlot', () => {
  it('is case- and whitespace-insensitive', () => {
    expect(emailSlot('  Foo@Bar.com ')).toBe(emailSlot('foo@bar.com'))
  })

  it('returns 16 hex chars', () => {
    expect(emailSlot('a@b.com')).toMatch(/^[0-9a-f]{16}$/)
  })

  it('differs for different emails', () => {
    expect(emailSlot('a@b.com')).not.toBe(emailSlot('c@d.com'))
  })
})

// ── asRecord ──────────────────────────────────────────────────────────────────

describe('asRecord', () => {
  it('returns the object for plain objects', () => {
    const o = { a: 1 }
    expect(asRecord(o)).toBe(o)
  })

  it('returns {} for null, arrays, and primitives', () => {
    expect(asRecord(null)).toEqual({})
    expect(asRecord([1, 2])).toEqual({})
    expect(asRecord('x')).toEqual({})
    expect(asRecord(42)).toEqual({})
    expect(asRecord(undefined)).toEqual({})
  })
})

// ── checkOrderPrechecks ───────────────────────────────────────────────────────

describe('checkOrderPrechecks', () => {
  it('happy path returns ok with row, videoId, pageId, approvedAt', () => {
    const row = makeRow()
    const res = checkOrderPrechecks({
      order: makeOrder(),
      rows: [row],
      target: makeTarget(),
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.row).toBe(row)
      expect(res.videoId).toBe('vid-1')
      expect(res.pageId).toBe('page-1')
      expect(res.approvedAt).toBe('2026-10-18T00:00:00.000Z')
    }
  })

  it('rejects null target with 422', () => {
    const res = checkOrderPrechecks({ order: makeOrder(), rows: [makeRow()], target: null })
    expect(res).toEqual({ ok: false, status: 422, error: expect.any(String) })
  })

  it('rejects non-facebook target with 422', () => {
    const res = checkOrderPrechecks({
      order: makeOrder(),
      rows: [makeRow()],
      target: makeTarget({ platform: 'publer' }),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(422)
  })

  it('rejects empty expect_brand with 422 mentioning 防误发品牌名缺失', () => {
    const res = checkOrderPrechecks({
      order: makeOrder(),
      rows: [makeRow()],
      target: makeTarget({ expect_brand: '   ' }),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(422)
      expect(res.error).toContain('防误发品牌名缺失')
    }
  })

  it('rejects superseded status with 409', () => {
    const res = checkOrderPrechecks({
      order: makeOrder({ status: 'superseded' }),
      rows: [makeRow()],
      target: makeTarget(),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(409)
  })

  it('rejects video_state PUBLISHED with 409', () => {
    const res = checkOrderPrechecks({
      order: makeOrder({
        published_ref: { video_state: 'PUBLISHED', video_id: 'vid-1', page_id: 'page-1' },
      }),
      rows: [makeRow()],
      target: makeTarget(),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(409)
  })

  it('rejects missing master_brief_id with 422', () => {
    const res = checkOrderPrechecks({
      order: makeOrder({ master_brief_id: '' }),
      rows: [makeRow()],
      target: makeTarget(),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(422)
  })

  it('rejects failing human checklist with 409', () => {
    vi.mocked(validateContentChecklist).mockImplementation((_v, _k, kind) =>
      kind === 'HUMAN' ? { ok: false, error: 'x' } : { ok: true, items: [] },
    )
    const res = checkOrderPrechecks({
      order: makeOrder(),
      rows: [makeRow()],
      target: makeTarget(),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(409)
  })

  it('rejects failing auto checklist with 409', () => {
    vi.mocked(validateContentChecklist).mockImplementation((_v, _k, kind) =>
      kind === 'AUTO' ? { ok: false, error: 'x' } : { ok: true, items: [] },
    )
    const res = checkOrderPrechecks({
      order: makeOrder(),
      rows: [makeRow()],
      target: makeTarget(),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(409)
  })

  it('rejects checklist that validates but does not pass with 409', () => {
    vi.mocked(checklistPasses).mockReturnValue(false)
    const res = checkOrderPrechecks({
      order: makeOrder(),
      rows: [makeRow()],
      target: makeTarget(),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(409)
  })

  it('rejects 0 rows with 409', () => {
    const res = checkOrderPrechecks({ order: makeOrder(), rows: [], target: makeTarget() })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(409)
  })

  it('rejects 2 rows with 409', () => {
    const res = checkOrderPrechecks({
      order: makeOrder(),
      rows: [makeRow(), makeRow({ id: 'row-2' })],
      target: makeTarget(),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(409)
  })

  it('rejects video id mismatch between order and row with 409', () => {
    const res = checkOrderPrechecks({
      order: makeOrder(),
      rows: [makeRow({ payload: { video_id: 'vid-2', page_id: 'page-1' } })],
      target: makeTarget(),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(409)
  })

  it('rejects page id mismatch between order and target with 409', () => {
    const res = checkOrderPrechecks({
      order: makeOrder({
        published_ref: { video_state: 'DRAFT', video_id: 'vid-1', page_id: 'page-2' },
      }),
      rows: [makeRow()],
      target: makeTarget(),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(409)
  })

  it('rejects page id mismatch between row and target with 409', () => {
    const res = checkOrderPrechecks({
      order: makeOrder(),
      rows: [makeRow({ payload: { video_id: 'vid-1', page_id: 'page-2' } })],
      target: makeTarget(),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(409)
  })

  it('rejects missing approved_at with 409', () => {
    const res = checkOrderPrechecks({
      order: makeOrder({
        review_ref: { checklist_human: { h1: true, h2: true } },
      }),
      rows: [makeRow()],
      target: makeTarget(),
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(409)
  })
})
