/**
 * External (uploaded) finished videos on the shared 马良 work-order path:
 * they get the v2 check, the event's video url must be the order's own file,
 * and the subtitle / cover items that waited at upload are settled from the frames.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createMaliangRenderCheckFunction, type MaliangDeps } from '../maliang-render-check'
import type { MaliangCheck, NineGridFrame } from '@/lib/maliang/render-check'
import type { MaliangCheckV2 } from '@/lib/maliang/render-check-v2'
import { buildAdmitAutoChecklist } from '@/lib/factory/admit-finished'

const finish = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/cron/run-logger', () => ({
  startCronRunId: vi.fn().mockResolvedValue('run-1'),
  cronRunHandle: () => ({ finish }),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class {} }))
vi.mock('@google/generative-ai/server', () => ({ GoogleAIFileManager: class {} }))

beforeEach(() => finish.mockClear())

const CLIENT_ID = '00000000-0000-4000-8000-000000000001'
const WORK_ORDER_ID = '00000000-0000-4000-8000-000000000004'
const VIDEO_PATH = 'c1/external/2026-11-04-testimonial.mp4'
const OWN_URL = `https://example.supabase.co/storage/v1/object/public/content-factory/${VIDEO_PATH}`

function frame(t: number): NineGridFrame {
  return { t_pct: t, image_ok: true, image_note: '', text_seen: '', text_ok: true, text_note: '', logo_seen: false, logo_ok: true, logo_note: '' }
}
const FRAMES = [0, 10, 20, 30, 40, 50, 60, 70, 80].map(frame)

const V1_PASS: MaliangCheck = { status: 'pass', checked_at: '2026-11-04T00:00:00.000Z', video_url: OWN_URL, reasons: [], frames: FRAMES, model: 'm' }
const V2_PASS: MaliangCheckV2 = {
  ...V1_PASS,
  check_version: 'v2',
  shots: [],
  audio: { speech_present: true, transcript: 'we loved it', music_present: true, problems: [] },
  identifiable_faces: [{ t_start: 0, t_end: 3, count: 1 }],
  questions: ['可辨认人脸 @ 0s，需人确认授权'],
}

function externalOrder(): Record<string, unknown> {
  return {
    id: WORK_ORDER_ID,
    client_id: CLIENT_ID,
    status: 'in_review',
    angle: 'Guest testimonial',
    brief: { engine: 'external_upload', copy: { caption: 'post' } },
    output: {
      video_path: VIDEO_PATH,
      quality_checklist_auto: buildAdmitAutoChecklist(
        { width: 1080, height: 1920, durationSeconds: 30, hasAudio: true },
        { workOrderId: WORK_ORDER_ID, caption: 'post', endcard: { cta: 'See it', url: 'https://example.com/t?utm_source=a' } },
      ),
    },
  }
}

function asDb(v: object): SupabaseClient {
  return v as SupabaseClient
}

function makeDb(order: Record<string, unknown>) {
  const patches: Record<string, unknown>[] = []
  const client = asDb({
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => {
          if (table === 'content_work_orders') return { data: order, error: null }
          if (table === 'clients') return { data: { name: 'Client' }, error: null }
          return { data: null, error: null }
        },
        update: (patch: Record<string, unknown>) => {
          const upd: Record<string, unknown> = {
            eq: () => upd,
            then: (resolve: (value: unknown) => unknown) => {
              patches.push(patch)
              return resolve({ error: null })
            },
          }
          return upd
        },
      }
      return builder
    },
  })
  return { client, patches }
}

async function run(deps: Partial<MaliangDeps>, outputUrl = OWN_URL) {
  const db = makeDb(externalOrder())
  const fn = createMaliangRenderCheckFunction({
    supabase: db.client,
    check: vi.fn(async () => V1_PASS),
    apiKey: () => 'test-key',
    ...deps,
  })
  const handler = Reflect.get(fn, 'fn') as (args: unknown) => Promise<Record<string, unknown>>
  const step = { run: async (_id: string, f: () => unknown) => f() }
  const result = await handler({
    event: { id: 'evt-ext', data: { client_id: CLIENT_ID, work_order_id: WORK_ORDER_ID, output_url: outputUrl } },
    step,
  })
  return { result, db }
}

function savedOutput(patches: Record<string, unknown>[]): Record<string, unknown> {
  const last = patches.at(-1)
  const output = last?.output
  return output !== null && typeof output === 'object' && !Array.isArray(output) ? (output as Record<string, unknown>) : {}
}

describe('马良 on an externally uploaded finished video', () => {
  it('uses the v2 check, stores it, and settles subtitle and cover from the frames', async () => {
    const check = vi.fn(async () => V1_PASS)
    const checkV2 = vi.fn(async () => V2_PASS)
    const { db } = await run({ check, checkV2 })

    expect(checkV2).toHaveBeenCalledTimes(1)
    expect(check).not.toHaveBeenCalled()
    const output = savedOutput(db.patches)
    expect(output.maliang_check).toMatchObject({ check_version: 'v2', status: 'pass' })
    const items = output.quality_checklist_auto as Array<{ key: string; outcome: string }>
    expect(items.find((i) => i.key === 'subtitle_timing_aligned')?.outcome).toBe('PASS')
    expect(items.find((i) => i.key === 'cover_frame_not_blank_or_placeholder')?.outcome).toBe('PASS')
  })

  it('refuses a video url that is not the order own file (no model call, nothing written)', async () => {
    const checkV2 = vi.fn(async () => V2_PASS)
    const { result, db } = await run({ checkV2 }, 'https://example.supabase.co/storage/v1/object/public/content-factory/other/file.mp4')

    expect(checkV2).not.toHaveBeenCalled()
    expect(db.patches).toHaveLength(0)
    expect(JSON.stringify(result)).toContain('video_url_mismatch')
  })

  it('an unverifiable v2 leaves subtitle and cover NOT_MEASURED (approval stays blocked)', async () => {
    const checkV2 = vi.fn(async (): Promise<MaliangCheckV2> => ({ ...V2_PASS, status: 'unverifiable', frames: [], identifiable_faces: [] }))
    const { db } = await run({ checkV2 })

    const items = savedOutput(db.patches).quality_checklist_auto as Array<{ key: string; outcome: string }>
    expect(items.find((i) => i.key === 'subtitle_timing_aligned')?.outcome).toBe('NOT_MEASURED')
    expect(items.find((i) => i.key === 'cover_frame_not_blank_or_placeholder')?.outcome).toBe('NOT_MEASURED')
  })
})
