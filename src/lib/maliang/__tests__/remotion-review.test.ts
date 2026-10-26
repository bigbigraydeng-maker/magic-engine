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

  it('fail leaves the approve queue', () => {
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
    expect(maliangReviewNote({ machine_reviewed: false })).toContain('还没审完')
  })

  it('shows a pass, a reject, and a failed review differently', () => {
    expect(maliangReviewNote({ maliang_check: PASS, machine_reviewed: true })).toContain('过关')
    expect(maliangReviewNote({
      maliang_check: { ...PASS, status: 'fail', reasons: ['第 1 镜文字：错字'] },
    })).toContain('错字')
    expect(maliangReviewNote({
      maliang_check: { ...PASS, status: 'unverifiable', reasons: ['超时'], model: null },
      machine_reviewed: false,
    })).toContain('还没经过机器审')
  })

  it('stays quiet for orders that were never marked', () => {
    expect(maliangReviewNote({ video_path: 'renders/a/b/final.mp4' })).toBeNull()
    expect(maliangReviewNote(null)).toBeNull()
  })
})
