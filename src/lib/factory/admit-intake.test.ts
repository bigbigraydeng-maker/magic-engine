import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  admitFinishedVideo,
  applyMaliangToAdmitChecklist,
  buildAdmitAutoChecklist,
  normalizeStoragePath,
  type AdmitInput,
} from './admit-finished'
import { externalVideoUrlMatches, settleAdmitChecklist } from '@/lib/maliang/work-order-review'
import type { MaliangCheck, NineGridFrame } from '@/lib/maliang/render-check'

function frame(t: number, over: Partial<NineGridFrame> = {}): NineGridFrame {
  return {
    t_pct: t,
    image_ok: true,
    image_note: '',
    text_seen: '',
    text_ok: true,
    text_note: '',
    logo_seen: false,
    logo_ok: true,
    logo_note: '',
    ...over,
  }
}

function check(status: MaliangCheck['status'], frames: NineGridFrame[]): MaliangCheck {
  return {
    status,
    checked_at: '2026-11-04T00:00:00.000Z',
    video_url: 'v',
    reasons: [],
    frames,
    model: 'm',
  }
}

const NINE = [0, 10, 20, 30, 40, 50, 60, 70, 80].map((t) => frame(t))

function items() {
  return buildAdmitAutoChecklist(
    { width: 1080, height: 1920, durationSeconds: 30, hasAudio: true },
    {
      workOrderId: '11111111-2222-3333-4444-555555555555',
      caption: 'x',
      endcard: { cta: 'See it', url: 'https://example.com/t' },
    },
  )
}

function input(over: Partial<AdmitInput> = {}): AdmitInput {
  return {
    clientId: '11111111-2222-3333-4444-555555555555',
    storagePath: 'c1/external/a.mp4',
    angle: 'A',
    rationale: 'A',
    caption: 'cap',
    endcard: { cta: 'See it', url: 'https://example.com/t' },
    confirmedBy: 'system:pm-chat',
    ...over,
  }
}

function asDb(v: object): SupabaseClient {
  return v as SupabaseClient
}

interface Chain {
  select: () => Chain
  eq: () => Chain
  or: () => Chain
  order: () => Chain
  limit: () => Promise<{ data: unknown[] | null; error: null }>
  maybeSingle: () => Promise<{ data: unknown; error: null }>
}

function fakeDb(existing: unknown[] | null): { db: SupabaseClient; from: ReturnType<typeof vi.fn> } {
  const from = vi.fn((table: string) => {
    const chain: Chain = {
      select: () => chain,
      eq: () => chain,
      or: () => chain,
      order: () => chain,
      limit: () => Promise.resolve({ data: existing, error: null }),
      maybeSingle: () =>
        Promise.resolve({
          data:
            table === 'clients'
              ? { id: 'c', name: 'n', factory_config: {} }
              : null,
          error: null,
        }),
    }
    return chain
  })
  return { db: asDb({ from }), from }
}

describe('normalizeStoragePath', () => {
  it('accepts a relative path', () => {
    expect(normalizeStoragePath('c1/x.mp4')).toBe('c1/x.mp4')
  })

  it('strips leading slashes', () => {
    expect(normalizeStoragePath('/c1/x.mp4')).toBe('c1/x.mp4')
  })

  it('rejects an absolute http url', () => {
    expect(normalizeStoragePath('https://evil.example/x.mp4')).toBeNull()
  })

  it('rejects a protocol-relative url', () => {
    expect(normalizeStoragePath('//evil/x.mp4')).toBeNull()
  })

  it('rejects a parent segment', () => {
    expect(normalizeStoragePath('c1/../x.mp4')).toBeNull()
  })

  it('rejects an empty segment', () => {
    expect(normalizeStoragePath('c1//x.mp4')).toBeNull()
  })

  it('rejects whitespace only', () => {
    expect(normalizeStoragePath('   ')).toBeNull()
  })

  it('rejects a data url', () => {
    expect(normalizeStoragePath('data:video/mp4;base64,AAA')).toBeNull()
  })
})

describe('applyMaliangToAdmitChecklist', () => {
  it('leaves subtitle and cover NOT_MEASURED when unverifiable', () => {
    const result = applyMaliangToAdmitChecklist(items(), check('unverifiable', []))
    const subtitle = result.find((i) => i.key === 'subtitle_timing_aligned')
    const cover = result.find((i) => i.key === 'cover_frame_not_blank_or_placeholder')
    expect(subtitle?.outcome).toBe('NOT_MEASURED')
    expect(cover?.outcome).toBe('NOT_MEASURED')
  })

  it('marks subtitle and cover PASS when all frames are ok', () => {
    const result = applyMaliangToAdmitChecklist(items(), check('pass', NINE))
    const subtitle = result.find((i) => i.key === 'subtitle_timing_aligned')
    const cover = result.find((i) => i.key === 'cover_frame_not_blank_or_placeholder')
    expect(subtitle?.outcome).toBe('PASS')
    expect(cover?.outcome).toBe('PASS')
  })

  it('marks subtitle FAIL and names the failing frame when text is not ok', () => {
    const frames = NINE.map((f) => (f.t_pct === 30 ? frame(30, { text_ok: false }) : f))
    const result = applyMaliangToAdmitChecklist(items(), check('pass', frames))
    const subtitle = result.find((i) => i.key === 'subtitle_timing_aligned')
    expect(subtitle?.outcome).toBe('FAIL')
    expect(subtitle?.detail).toContain('30%')
  })

  it('marks cover FAIL when the first frame image is not ok', () => {
    const frames = NINE.map((f) => (f.t_pct === 0 ? frame(0, { image_ok: false }) : f))
    const result = applyMaliangToAdmitChecklist(items(), check('pass', frames))
    const cover = result.find((i) => i.key === 'cover_frame_not_blank_or_placeholder')
    expect(cover?.outcome).toBe('FAIL')
  })

  it('does not mutate the input array', () => {
    const original = items()
    applyMaliangToAdmitChecklist(original, check('pass', NINE))
    const subtitle = original.find((i) => i.key === 'subtitle_timing_aligned')
    expect(subtitle?.outcome).toBe('NOT_MEASURED')
  })
})

describe('externalVideoUrlMatches', () => {
  const url = 'https://x.supabase.co/storage/v1/object/public/content-factory/c1/a.mp4'

  it('matches when the url ends with the video path', () => {
    expect(externalVideoUrlMatches(url, { video_path: 'c1/a.mp4' })).toBe(true)
  })

  it('does not match a different path', () => {
    expect(externalVideoUrlMatches(url, { video_path: 'c1/b.mp4' })).toBe(false)
  })

  it('does not match output without video_path', () => {
    expect(externalVideoUrlMatches(url, {})).toBe(false)
  })

  it('does not match null output', () => {
    expect(externalVideoUrlMatches(url, null)).toBe(false)
  })
})

describe('settleAdmitChecklist', () => {
  it('returns the same object for a non-external brief', () => {
    const stamped = { foo: 'bar' }
    expect(settleAdmitChecklist(stamped, {}, check('pass', NINE))).toBe(stamped)
  })

  it('settles subtitle and cover for an external brief', () => {
    const stamped = { quality_checklist_auto: items() }
    const result = settleAdmitChecklist(stamped, { engine: 'external_upload' }, check('pass', NINE))
    const checklist = result.quality_checklist_auto as ReturnType<typeof items>
    const subtitle = checklist.find((i) => i.key === 'subtitle_timing_aligned')
    const cover = checklist.find((i) => i.key === 'cover_frame_not_blank_or_placeholder')
    expect(subtitle?.outcome).toBe('PASS')
    expect(cover?.outcome).toBe('PASS')
  })

  it('returns the same object when the checklist is garbage', () => {
    const stamped = { quality_checklist_auto: 'garbage' }
    expect(settleAdmitChecklist(stamped, { engine: 'external_upload' }, check('pass', NINE))).toBe(stamped)
  })
})

describe('admitFinishedVideo', () => {
  it('rejects an http url before touching the database', async () => {
    const { db, from } = fakeDb(null)
    const result = await admitFinishedVideo(db, input({ storagePath: 'https://evil.example/x.mp4' }))
    expect(from).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('rejects invalid consent with 400 and does not touch the database', async () => {
    const { db, from } = fakeDb(null)
    const result = await admitFinishedVideo(
      db,
      input({
        talentConsent: {
          status: 'granted',
          scope: ['facebook_organic'],
          subject: 'talent',
          evidence: '   ',
        },
      }),
    )
    expect(from).not.toHaveBeenCalled()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('dedupes an existing work order and does not queue review', async () => {
    const { db } = fakeDb([{ id: 'existing-1', output: { quality_checklist_auto: [] } }])
    const sendReview = vi.fn()
    const result = await admitFinishedVideo(db, input(), { sendReview })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.workOrderId).toBe('existing-1')
      expect(result.deduped).toBe(true)
      expect(result.reviewQueued).toBe(false)
    }
    expect(sendReview).not.toHaveBeenCalled()
  })
})
