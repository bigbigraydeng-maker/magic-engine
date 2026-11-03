import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const sendEvent = vi.fn(async (_event: { id: string }) => ({ event_ids: ['e1'] }))
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: (event: { id: string }) => sendEvent(event) }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class {} }))
vi.mock('@google/generative-ai/server', () => ({ GoogleAIFileManager: class {} }))

import { MALIANG_RENDER_READY_EVENT } from '@/lib/inngest/functions/maliang-render-check'
import {
  ADMIT_REVIEW_EVENT,
  admitInputFromBody,
  sendAdmitReview,
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
    storagePath: '11111111-2222-3333-4444-555555555555/external/a.mp4',
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
  select: () => Chain | Promise<{ data: unknown[]; error: null }>
  eq: () => Chain
  or: () => Chain
  not: () => Chain
  order: () => Chain
  update: (patch: Record<string, unknown>) => Chain
  limit: () => Promise<{ data: unknown[] | null; error: null }> & { maybeSingle: () => Promise<{ data: unknown; error: null }> }
  maybeSingle: () => Promise<{ data: unknown; error: null }>
}

const updates: Record<string, unknown>[] = []

function fakeDb(existing: unknown[] | null): { db: SupabaseClient; from: ReturnType<typeof vi.fn> } {
  updates.length = 0
  const from = vi.fn((table: string) => {
    let updating = false
    const chain: Chain = {
      select: () => (updating ? Promise.resolve({ data: [{ id: 'x' }], error: null }) : chain),
      eq: () => chain,
      or: () => chain,
      not: () => chain,
      order: () => chain,
      update: (patch) => {
        updating = true
        updates.push(patch)
        return chain
      },
      limit: () => Object.assign(Promise.resolve({ data: existing, error: null }), { maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
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
    expect(normalizeStoragePath('c1/external/x.mp4', 'c1')).toBe('c1/external/x.mp4')
  })

  it('strips leading slashes', () => {
    expect(normalizeStoragePath('/c1/external/x.mp4', 'c1')).toBe('c1/external/x.mp4')
  })

  it('rejects an absolute http url', () => {
    expect(normalizeStoragePath('https://evil.example/x.mp4', 'c1')).toBeNull()
  })

  it('rejects a protocol-relative url', () => {
    expect(normalizeStoragePath('//evil/x.mp4', 'c1')).toBeNull()
  })

  it('rejects a parent segment', () => {
    expect(normalizeStoragePath('c1/../x.mp4', 'c1')).toBeNull()
  })

  it('rejects an empty segment', () => {
    expect(normalizeStoragePath('c1//x.mp4', 'c1')).toBeNull()
  })

  it('rejects whitespace only', () => {
    expect(normalizeStoragePath('   ', 'c1')).toBeNull()
  })

  it('rejects a path outside <client>/external/ and encoded tricks', () => {
    expect(normalizeStoragePath('c2/external/x.mp4', 'c1')).toBeNull()
    expect(normalizeStoragePath('c1/x.mp4', 'c1')).toBeNull()
    expect(normalizeStoragePath('c1/external/%2e%2e/x.mp4', 'c1')).toBeNull()
    expect(normalizeStoragePath('c1\\external\\x.mp4', 'c1')).toBeNull()
  })

  it('rejects a data url', () => {
    expect(normalizeStoragePath('data:video/mp4;base64,AAA', 'c1')).toBeNull()
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

  it('dedupes an order that already has a v2 verdict: no new order, no new review', async () => {
    const { db } = fakeDb([{ id: 'existing-1', status: 'in_review', brief: {}, updated_at: '2026-11-04T00:00:00.000Z', output: { quality_checklist_auto: [], maliang_check: { check_version: 'v2', status: 'pass', identifiable_faces: [] } } }])
    const sendReview = vi.fn(async () => undefined)
    const result = await admitFinishedVideo(db, input(), { sendReview })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.workOrderId).toBe('existing-1')
      expect(result.deduped).toBe(true)
      expect(result.reviewQueued).toBe(false)
      expect(result.consentUpdated).toBe(false)
    }
    expect(sendReview).not.toHaveBeenCalled()
  })

  it('a re-admit of an order still waiting for 马良 asks for the review again', async () => {
    const { db } = fakeDb([{ id: 'existing-1', status: 'in_review', brief: {}, updated_at: '2026-11-04T00:00:00.000Z', output: { quality_checklist_auto: [] } }])
    const sendReview = vi.fn(async () => undefined)
    const result = await admitFinishedVideo(db, input(), { sendReview })
    expect(result.ok && result.reviewQueued).toBe(true)
    expect(sendReview).toHaveBeenCalledTimes(1)
  })

  it('a re-admit with consent records the consent on the existing order (the to-do path works)', async () => {
    const { db } = fakeDb([{ id: 'existing-1', status: 'approved', brief: { engine: 'external_upload' }, updated_at: '2026-11-04T00:00:00.000Z', output: { quality_checklist_auto: [] } }])
    const consent = { status: 'granted' as const, scope: ['facebook_organic' as const], subject: 'guest', evidence: 'PM chat' }
    const result = await admitFinishedVideo(db, input({ talentConsent: consent }), { sendReview: vi.fn(async () => undefined), now: () => new Date('2026-11-05T00:00:00.000Z') })
    expect(result.ok && result.consentUpdated).toBe(true)
    const brief = updates[0]?.brief as Record<string, unknown>
    expect(brief.engine).toBe('external_upload')
    expect(brief.talent_consent).toMatchObject({ status: 'granted', confirmed_by: 'system:pm-chat', evidence: 'PM chat' })
  })

  it('a publish_failed order is not treated as dead (it may still be retried or already be public)', async () => {
    const { db } = fakeDb([{ id: 'pf', status: 'publish_failed', brief: { engine: 'external_upload' }, updated_at: '2026-11-04T00:00:00.000Z', output: {} }])
    const plain = await admitFinishedVideo(db, input(), { sendReview: vi.fn(async () => undefined) })
    expect(plain.ok && plain.workOrderId).toBe('pf')
    const consent = { status: 'granted' as const, scope: ['tiktok_organic' as const], subject: 'guest', evidence: 'PM chat' }
    const withConsent = await admitFinishedVideo(db, input({ talentConsent: consent }), { sendReview: vi.fn(async () => undefined) })
    expect(withConsent.ok).toBe(false)
    if (!withConsent.ok) expect(withConsent.status).toBe(409)
  })

  it('re-admitting the same consent does not rewrite the order', async () => {
    const stored = { status: 'granted', scope: ['facebook_organic'], subject: 'guest', confirmed_by: 'system:pm-chat', confirmed_at: '2026-11-01T00:00:00.000Z', evidence: 'PM chat' }
    const { db } = fakeDb([{ id: 'e', status: 'approved', brief: { engine: 'external_upload', talent_consent: stored }, updated_at: '2026-11-04T00:00:00.000Z', output: {} }])
    const consent = { status: 'granted' as const, scope: ['facebook_organic' as const], subject: 'guest', evidence: 'PM chat' }
    const result = await admitFinishedVideo(db, input({ talentConsent: consent }), { sendReview: vi.fn(async () => undefined) })
    expect(result.ok && result.consentUpdated).toBe(false)
    expect(updates).toHaveLength(0)
  })

  it('a dead order (rejected) is not reused: the admit goes on to create a new one', async () => {
    const { db } = fakeDb([{ id: 'old', status: 'review_rejected', brief: {}, updated_at: 'x', output: {} }])
    const result = await admitFinishedVideo(db, input(), { sendReview: vi.fn(async () => undefined) })
    // No dedupe: it proceeds to goal lookup, which the fake leaves empty.
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(422)
  })
})

describe('admitInputFromBody', () => {
  const body = { client_id: 'c', storage_path: 'c/external/a.mp4', angle: 'A', caption: 'cap', endcard: { cta: 'x', url: 'https://e.com' } }

  it('takes confirmedBy from the caller and ignores confirmed_by / confirmed_at in the body', () => {
    const parsed = admitInputFromBody({ ...body, confirmed_by: 'attacker', talent_consent: { status: 'granted', scope: ['facebook_organic'], subject: 'g', evidence: 'e', confirmed_by: 'attacker', confirmed_at: '2000-01-01' } }, 'admin@me')
    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(parsed.input.confirmedBy).toBe('admin@me')
      expect(JSON.stringify(parsed.input.talentConsent)).not.toContain('attacker')
    }
  })

  it('a malformed consent is an error, not "no consent"', () => {
    expect(admitInputFromBody({ ...body, talent_consent: 'yes' }, 'a').ok).toBe(false)
    expect(admitInputFromBody({ ...body, talent_consent: { status: 'granted', scope: ['facebook_organic', 'instagram'], subject: 'g', evidence: 'e' } }, 'a').ok).toBe(false)
  })

  it('no consent field means no consent', () => {
    const parsed = admitInputFromBody(body, 'a')
    expect(parsed.ok && parsed.input.talentConsent).toBeUndefined()
  })
})

describe('review event', () => {
  it('uses the same event name the 马良 function listens to', () => {
    expect(ADMIT_REVIEW_EVENT).toBe(MALIANG_RENDER_READY_EVENT)
  })

  it('carries the time in the id so a deliberate re-review is not dropped', async () => {
    sendEvent.mockClear()
    await sendAdmitReview({ client_id: 'c', work_order_id: 'w', output_url: 'u' }, new Date(1000))
    await sendAdmitReview({ client_id: 'c', work_order_id: 'w', output_url: 'u' }, new Date(2000))
    const ids = sendEvent.mock.calls.map(([event]) => event.id)
    expect(ids).toEqual(['maliang-admit:w:1000', 'maliang-admit:w:2000'])
  })
})
