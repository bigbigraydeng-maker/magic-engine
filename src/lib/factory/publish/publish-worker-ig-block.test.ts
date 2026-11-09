/**
 * ig_crosspost_blocked 与工单侧其他写手(设计稿第 6 节:实现必须核「会不会清除标记」)。
 *
 * 真跑 publish-worker 里的补发任务(reconcileMissingReelEvents → emitReelPublishedEvent 写回),
 * 断言标记写回后仍在;并核对 recordPublished 的可达性:它会整体覆盖 published_ref(标记会丢),
 * 但只有 claimOne 领到的 approved / publish_failed 工单才会走到它,promote 过的 published 工单领不到。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/workflows/inngest-event', () => ({ sendInngestEvent: vi.fn(async () => ({ event_ids: ['evt-1'] })) }))

import { supabaseAdmin } from '@/lib/supabase'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { reconcileMissingReelEvents, runPublishWorker } from './publish-worker'

const mockFrom = vi.mocked(supabaseAdmin.from)
const WO = '11111111-1111-4111-8111-111111111111'
const CLIENT = 'c0000000-0000-4000-8000-000000000001'

interface Rec { updates: Array<Record<string, unknown>>; orArgs: string[] }

function install(rows: Array<Record<string, unknown>>): Rec {
  const rec: Rec = { updates: [], orArgs: [] }
  mockFrom.mockImplementation(() => {
    const b: Record<string, unknown> = {}
    let isUpdate = false
    for (const m of ['select', 'eq', 'order', 'limit']) b[m] = () => b
    b.or = (arg: string) => { rec.orArgs.push(arg); return b }
    b.update = (payload: Record<string, unknown>) => { isUpdate = true; rec.updates.push(payload); return b }
    b.maybeSingle = () => Promise.resolve({ data: null, error: null })
    b.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: isUpdate ? null : rows, error: null }).then(resolve)
    return b as never
  })
  return rec
}

beforeEach(() => { vi.mocked(sendInngestEvent).mockClear() })

describe('补发任务写回 published_ref', () => {
  it('promote 过的工单(PUBLISHED、无 event_ids、带 ig_crosspost_blocked)被补发后,标记仍在', async () => {
    const ref = {
      platform: 'facebook', page_id: '1111111111', video_id: '2222222222', post_id: '2222222222',
      video_state: 'PUBLISHED', published_at: '2026-10-20T00:00:00.000Z', ig_crosspost_blocked: true, promote_request_id: 'req-1',
    }
    const rec = install([{ id: WO, client_id: CLIENT, published_ref: ref }])
    await reconcileMissingReelEvents()
    expect(sendInngestEvent).toHaveBeenCalledTimes(1)
    const written = rec.updates.find((u) => u.published_ref !== undefined)?.published_ref as Record<string, unknown>
    expect(written.ig_crosspost_blocked).toBe(true)
    expect(written.promote_request_id).toBe('req-1')
    expect(written.event_ids).toEqual(['evt-1'])
  })

  it('已有 event_ids 的不重复补发', async () => {
    install([{ id: WO, client_id: CLIENT, published_ref: { platform: 'facebook', video_state: 'PUBLISHED', page_id: '1111111111', video_id: '2222222222', published_at: '2026-10-20T00:00:00.000Z', event_ids: ['x'] } }])
    await reconcileMissingReelEvents()
    expect(sendInngestEvent).not.toHaveBeenCalled()
  })
})

describe('recordPublished 的可达性', () => {
  it('发布任务只领 approved / publish_failed 工单,领不到 status=published 的(标记不会被它整体覆盖)', async () => {
    const rec = install([])
    const out = await runPublishWorker({ draft: true, workerId: 'w' })
    expect(out.result).toBe('no_candidate')
    expect(rec.orArgs).toHaveLength(1)
    expect(rec.orArgs[0]).toContain('status.eq.approved')
    expect(rec.orArgs[0]).not.toContain('status.eq.published')
  })
})
