import { describe, expect, it, vi } from 'vitest'

vi.mock('@google/generative-ai', () => ({ GoogleGenerativeAI: class {} }))
vi.mock('@google/generative-ai/server', () => ({ GoogleAIFileManager: class {} }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: {} }))
vi.mock('@/lib/cron/run-logger', () => ({
  startCronRunId: async () => 'run-1',
  cronRunHandle: () => ({ finish: async () => undefined }),
}))

import { dispositionOf, notMachineReviewedCheck, runCheckWithTimeout, stampWorkOrderOutput } from '../review-disposition'
import { logoExpectedFromRemotionBrief, onScreenLines, remotionVisualNotes } from '../remotion-review-input'
import { enqueueRemotionMaliangReview, remotionPublicVideoUrl } from '../enqueue-remotion-review'
import { maliangReviewNote } from '../review-note'
import { writeWorkOrderVerdict } from '../work-order-review'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MACHINE_REVIEWED_KEY } from '../review-disposition'
import { SNAPSHOT_KEY } from '../render-check'
import { MALIANG_RENDER_READY_EVENT } from '@/lib/inngest/functions/maliang-render-check'
import type { MaliangCheck } from '../render-check'

const PASS: MaliangCheck = {
  status: 'pass',
  checked_at: '2026-10-26T00:00:00.000Z',
  video_url: 'https://example.supabase.co/v.mp4',
  reasons: [],
  frames: [],
  model: 'gemini-2.5-flash',
}

const BRIEF = {
  remotion: {
    template: 'postcard',
    props: {
      logoFile: 'logo.png',
      musicFile: 'bed.mp3',
      hook: { lines: ['开场一句', '第二行', '第三行'] },
      scenes: [{ place: '示例地点', line: '一句卖点', clip: 'clip.mp4' }],
    },
  },
}

describe('dispositionOf', () => {
  it('pass stays in the human queue and counts as machine-reviewed', () => {
    expect(dispositionOf('pass')).toEqual({ holdFromQueue: false, machineReviewed: true })
  })

  it('fail is a finished reject on the post-route queue flag', () => {
    expect(dispositionOf('fail')).toEqual({ holdFromQueue: true, machineReviewed: true })
  })

  it('unverifiable stays in the human queue and is not machine-reviewed', () => {
    expect(dispositionOf('unverifiable')).toEqual({ holdFromQueue: false, machineReviewed: false })
  })
})

describe('stampWorkOrderOutput', () => {
  it('keeps existing output keys and records the verdict next to the machine-reviewed flag', () => {
    const stamped = stampWorkOrderOutput({ caption: 'keep', video_path: 'renders/a/b/final.mp4' }, PASS)
    expect(stamped.caption).toBe('keep')
    expect(stamped.video_path).toBe('renders/a/b/final.mp4')
    expect(stamped.machine_reviewed).toBe(true)
    expect((stamped.maliang_check as MaliangCheck).status).toBe('pass')
  })
})

describe('runCheckWithTimeout', () => {
  it('turns a thrown review into an unverifiable verdict', async () => {
    const check = await runCheckWithTimeout(async () => {
      throw new Error('model down')
    }, 1000, 'https://example.supabase.co/v.mp4')
    expect(check.status).toBe('unverifiable')
    expect(check.reasons[0]).toContain('model down')
    expect(dispositionOf(check.status).machineReviewed).toBe(false)
  })

  it('times out a hung review instead of waiting forever', async () => {
    const check = await runCheckWithTimeout(
      () => new Promise<MaliangCheck>(() => {}),
      20,
      'https://example.supabase.co/v.mp4',
    )
    expect(check.status).toBe('unverifiable')
    expect(check.reasons[0]).toContain('超时')
  })

  it('notMachineReviewedCheck never reports a pass', () => {
    expect(notMachineReviewedCheck('https://x', 'boom').status).toBe('unverifiable')
  })
})

describe('remotion review input', () => {
  it('collects on-screen copy and ignores asset file names', () => {
    expect(onScreenLines(BRIEF, '成片字幕')).toEqual([
      '成片字幕',
      '开场一句',
      '第二行',
      '第三行',
      '示例地点',
      '一句卖点',
    ])
    expect(logoExpectedFromRemotionBrief(BRIEF)).toBe(true)
    expect(remotionVisualNotes(BRIEF)).toEqual([
      'template postcard',
      'scene 1 is a composed template frame',
    ])
  })

  it('does not expect a logo when the brief has none', () => {
    expect(logoExpectedFromRemotionBrief({ remotion: { template: 'list', props: {} } })).toBe(false)
    expect(logoExpectedFromRemotionBrief(null)).toBe(false)
  })
})

describe('enqueueRemotionMaliangReview', () => {
  const supabaseUrl = 'https://example.supabase.co'

  it('sends the shared ready event for a template brief', async () => {
    const sent: unknown[] = []
    const result = await enqueueRemotionMaliangReview({
      brief: BRIEF,
      clientId: '00000000-0000-4000-8000-000000000001',
      workOrderId: '00000000-0000-4000-8000-000000000002',
      videoPath: 'renders/c/wo/final.mp4',
      supabaseUrl,
      send: async (event) => { sent.push(event) },
    })
    expect(result).toEqual({ sent: true })
    expect(sent).toEqual([{
      name: MALIANG_RENDER_READY_EVENT,
      data: {
        client_id: '00000000-0000-4000-8000-000000000001',
        work_order_id: '00000000-0000-4000-8000-000000000002',
        output_url: remotionPublicVideoUrl('renders/c/wo/final.mp4', supabaseUrl),
      },
    }])
  })

  it('does not send for a non-template brief', async () => {
    const send = vi.fn()
    const result = await enqueueRemotionMaliangReview({
      brief: { segments: [] },
      clientId: 'c',
      workOrderId: 'w',
      videoPath: 'renders/c/wo/final.mp4',
      supabaseUrl,
      send,
    })
    expect(result.sent).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('swallows a send failure so delivery can still finish', async () => {
    const result = await enqueueRemotionMaliangReview({
      brief: BRIEF,
      clientId: 'c',
      workOrderId: 'w',
      videoPath: 'renders/c/wo/final.mp4',
      supabaseUrl,
      send: async () => { throw new Error('inngest down') },
    })
    expect(result).toEqual({ sent: false, reason: 'inngest down' })
  })

  it('refuses to queue when there is no public video host', async () => {
    const send = vi.fn()
    const result = await enqueueRemotionMaliangReview({
      brief: BRIEF,
      clientId: 'c',
      workOrderId: 'w',
      videoPath: 'renders/c/wo/final.mp4',
      supabaseUrl: undefined,
      send,
    })
    expect(result).toEqual({ sent: false, reason: 'no_public_url' })
    expect(send).not.toHaveBeenCalled()
  })
})

describe('maliangReviewNote', () => {
  it('uses the same keys the server writes', () => {
    expect(SNAPSHOT_KEY).toBe('maliang_check')
    expect(MACHINE_REVIEWED_KEY).toBe('machine_reviewed')
  })

  it('says the order is not machine-reviewed before a verdict exists', () => {
    expect(maliangReviewNote({ machine_reviewed: false })?.text).toContain('还没审完')
  })

  it('shows a pass, a reject, and a failed review differently', () => {
    expect(maliangReviewNote({ maliang_check: PASS, machine_reviewed: true })?.text).toContain('过关')
    const fail = maliangReviewNote({
      maliang_check: { ...PASS, status: 'fail', reasons: ['第 1 镜文字：错字'] },
    })
    expect(fail?.tone).toBe('fail')
    expect(fail?.text.startsWith('马良没过')).toBe(true)
    expect(fail?.text).toContain('错字')
    expect(maliangReviewNote({
      maliang_check: { ...PASS, status: 'unverifiable', reasons: ['超时'], model: null },
      machine_reviewed: false,
    })?.text).toContain('还没经过机器审')
  })

  it('stays quiet for orders that were never marked', () => {
    expect(maliangReviewNote({ video_path: 'renders/a/b/final.mp4' })).toBeNull()
    expect(maliangReviewNote(null)).toBeNull()
  })
})

function orderDb(row: { status: string; output: Record<string, unknown> } | null) {
  const updates: Array<{ patch: Record<string, unknown>; filters: Array<[string, unknown]> }> = []
  const client = {
    from: () => {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({ data: row, error: null }),
        update: (patch: Record<string, unknown>) => {
          const filters: Array<[string, unknown]> = []
          const upd: Record<string, unknown> = {
            eq: (key: string, value: unknown) => {
              filters.push([key, value])
              return upd
            },
            then: (resolve: (value: unknown) => unknown) => {
              updates.push({ patch, filters })
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

describe('writeWorkOrderVerdict', () => {
  const fail: MaliangCheck = { ...PASS, status: 'fail', reasons: ['第 2 镜文字：错字'] }

  it('merges a fail onto the latest output and does not reject the order', async () => {
    const db = orderDb({
      status: 'in_review',
      output: { caption: '成片字幕', reviewer_mark: '保留' },
    })
    await writeWorkOrderVerdict(db.client, 'wo-1', fail)
    expect(db.updates).toHaveLength(1)
    const output = db.updates[0].patch.output as Record<string, unknown>
    expect(output.reviewer_mark).toBe('保留')
    expect(output.caption).toBe('成片字幕')
    expect(output.machine_reviewed).toBe(true)
    expect((output.maliang_check as MaliangCheck).status).toBe('fail')
    expect(db.updates[0].patch.status).toBeUndefined()
    expect(db.updates[0].filters).toEqual([
      ['id', 'wo-1'],
      ['status', 'in_review'],
    ])
  })

  it('skips the write after a person has already moved the order', async () => {
    const db = orderDb({ status: 'approved', output: { caption: '成片字幕' } })
    await writeWorkOrderVerdict(db.client, 'wo-1', fail)
    expect(db.updates).toHaveLength(0)
  })
})
