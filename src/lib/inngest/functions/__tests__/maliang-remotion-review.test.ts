/**
 * Template-render (Remotion) path of the shared 马良 review.
 * Pass, reject, and a review that throws are covered here. The nine-frame
 * model itself is covered in src/lib/maliang/__tests__/render-check.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createMaliangRenderCheckFunction, type MaliangDeps } from '../maliang-render-check'
import type { MaliangCheck } from '@/lib/maliang/render-check'

const finish = vi.fn().mockResolvedValue(undefined)
const startCronRunId = vi.fn().mockResolvedValue('run-1')

vi.mock('@/lib/cron/run-logger', () => ({
  startCronRunId: (...args: unknown[]) => startCronRunId(...args),
  cronRunHandle: () => ({ finish }),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class {} }))
vi.mock('@google/generative-ai/server', () => ({ GoogleAIFileManager: class {} }))

beforeEach(() => {
  finish.mockClear()
  startCronRunId.mockClear()
})

const CLIENT_ID = '00000000-0000-4000-8000-000000000001'
const WORK_ORDER_ID = '00000000-0000-4000-8000-000000000004'
const OUTPUT_URL = 'https://example.supabase.co/storage/v1/object/public/content-factory/renders/c/wo/final.mp4'

const PASS_CHECK: MaliangCheck = {
  status: 'pass',
  checked_at: '2026-10-26T00:00:00.000Z',
  video_url: OUTPUT_URL,
  reasons: [],
  frames: [],
  model: 'gemini-2.5-flash',
}

interface UpdateRecord {
  table: string
  patch: Record<string, unknown>
  filters: Array<[string, unknown]>
}

function makeDb(order: Record<string, unknown> | null) {
  const updates: UpdateRecord[] = []
  const client = {
    from: (table: string) => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => {
          if (table === 'content_work_orders') return { data: order, error: null }
          if (table === 'clients') return { data: { name: '示例客户' }, error: null }
          return { data: null, error: null }
        },
        update: (patch: Record<string, unknown>) => {
          const filters: Array<[string, unknown]> = []
          const upd: Record<string, unknown> = {
            eq: (key: string, value: unknown) => {
              filters.push([key, value])
              return upd
            },
            then: (resolve: (value: unknown) => unknown) => {
              updates.push({ table, patch, filters })
              return resolve({ error: null })
            },
          }
          return upd
        },
      }
      return builder
    },
  } as unknown as SupabaseClient
  return { client, updates }
}

function step() {
  return {
    run: async (_id: string, fn: () => unknown) => fn(),
  }
}

function eventData() {
  return { client_id: CLIENT_ID, work_order_id: WORK_ORDER_ID, output_url: OUTPUT_URL }
}

const ORDER = {
  id: WORK_ORDER_ID,
  client_id: CLIENT_ID,
  status: 'in_review',
  angle: '示例角度',
  brief: {
    remotion: {
      template: 'postcard',
      props: { logoFile: 'logo.png', hook: { lines: ['开场'] }, scenes: [{ line: '卖点', place: '示例地点' }] },
    },
  },
  output: { caption: '成片字幕', video_path: 'renders/c/wo/final.mp4', machine_reviewed: false },
}

function run(check: MaliangDeps['check'], order: Record<string, unknown> | null = ORDER, timeoutMs?: number) {
  const db = makeDb(order)
  const fn = createMaliangRenderCheckFunction({
    supabase: db.client,
    check,
    apiKey: () => 'test-key',
    reviewTimeoutMs: timeoutMs,
  })
  const handler = (fn as unknown as { fn: (args: unknown) => Promise<Record<string, unknown>> }).fn
  return handler({ event: { id: 'evt-remotion', data: eventData() }, step: step() }).then((result) => ({ result, db }))
}

describe('maliang review on a template-render work order', () => {
  it('pass: records the verdict on the work order and leaves it in the human queue', async () => {
    const { result, db } = await run(async () => PASS_CHECK)
    expect(result.status).toBe('pass')
    expect(result.source_record_id).toBe(WORK_ORDER_ID)
    expect(result.no_publish).toBe(true)

    const outputWrite = db.updates.find((u) => u.table === 'content_work_orders' && 'output' in u.patch)
    expect(outputWrite).toBeDefined()
    const output = outputWrite!.patch.output as Record<string, unknown>
    expect((output.maliang_check as MaliangCheck).status).toBe('pass')
    expect(output.machine_reviewed).toBe(true)
    expect(output.caption).toBe('成片字幕')
    expect(db.updates.some((u) => u.patch.status === 'review_rejected')).toBe(false)
  })

  it('reject: records the fail verdict and leaves the order in the human queue', async () => {
    const failed: MaliangCheck = { ...PASS_CHECK, status: 'fail', reasons: ['第 2 镜文字：错字'] }
    const { result, db } = await run(async () => failed)
    expect(result.status).toBe('fail')

    const outputWrite = db.updates.find((u) => 'output' in u.patch)
    const output = outputWrite!.patch.output as Record<string, unknown>
    expect((output.maliang_check as MaliangCheck).status).toBe('fail')
    expect((output.maliang_check as MaliangCheck).reasons).toEqual(['第 2 镜文字：错字'])
    expect(output.machine_reviewed).toBe(true)
    expect(output.caption).toBe('成片字幕')
    expect(outputWrite!.filters).toEqual([
      ['id', WORK_ORDER_ID],
      ['status', 'in_review'],
    ])
    expect(db.updates.some((u) => u.patch.status === 'review_rejected')).toBe(false)
    expect(db.updates.some((u) => 'status' in u.patch)).toBe(false)
  })

  it('review-error: a thrown check stays in the human queue and is not machine-reviewed', async () => {
    const { result, db } = await run(async () => {
      throw new Error('model down')
    })
    expect(result.status).toBe('unverifiable')
    expect(result.reasons).toEqual([expect.stringContaining('model down')])

    const output = db.updates.find((u) => 'output' in u.patch)!.patch.output as Record<string, unknown>
    expect((output.maliang_check as MaliangCheck).status).toBe('unverifiable')
    expect(output.machine_reviewed).toBe(false)
    expect(output.video_path).toBe('renders/c/wo/final.mp4')
    expect(db.updates.some((u) => u.patch.status === 'review_rejected')).toBe(false)
    expect(finish).toHaveBeenCalledWith(expect.objectContaining({ failed: 1 }))
  })

  it('review-error: a timeout stays in the human queue and is not machine-reviewed', async () => {
    const { result, db } = await run(() => new Promise<MaliangCheck>(() => {}), ORDER, 15)
    expect(result.status).toBe('unverifiable')
    expect(String((result.reasons as string[])[0])).toContain('超时')
    const output = db.updates.find((u) => 'output' in u.patch)!.patch.output as Record<string, unknown>
    expect(output.machine_reviewed).toBe(false)
    expect(db.updates.some((u) => 'status' in u.patch)).toBe(false)
  })
})
