import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requireDashboardClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

import { POST } from '../route'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

const mockAccess = vi.mocked(requireDashboardClientAccess)
const mockFrom = vi.mocked(supabaseAdmin.from)

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const PACKAGE = 'p0000000-0000-0000-0000-000000000000'

/** Chainable + awaitable stub; one per supabaseAdmin.from() call, in order. */
function builder(result: unknown): Record<string, ReturnType<typeof vi.fn>> & { then: unknown } {
  const b: Record<string, unknown> = {}
  for (const method of ['select', 'in', 'eq', 'update', 'order']) b[method] = vi.fn(() => b)
  b.single = vi.fn(() => Promise.resolve(result))
  b.then = (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(onOk, onErr)
  return b as Record<string, ReturnType<typeof vi.fn>> & { then: unknown }
}

const flaggedSnapshot = {
  content_guard: {
    status: 'fail',
    needs_human_review: true,
    target_language: 'zh',
    language_findings: [{ kind: 'embedded_fragment', sentence: '这个 tour 很好。', fragment: 'tour' }],
    cliche_probability: 0.1,
    judge_error: null,
    cliche_threshold: 0.8,
    checked_at: '2026-09-23T00:00:00.000Z',
  },
}

function callSchedule(assignments: { post_id: string; scheduled_at: string }[]) {
  return POST(
    new NextRequest('http://localhost/schedule', { method: 'POST', body: JSON.stringify({ assignments, approve: true }) }),
    { params: { id: CLIENT, packageId: PACKAGE } },
  )
}

beforeEach(() => {
  mockFrom.mockReset()
  mockAccess.mockReset()
  mockAccess.mockResolvedValue({ ok: true } as never)
})

describe('production package bulk scheduling respects the pre-publish content guard', () => {
  it('schedules the clean post, drops the flagged one and names it back', async () => {
    const pkg = builder({ data: { id: PACKAGE, status: 'ready_for_review' }, error: null })
    const guardRead = builder({
      data: [
        { id: 'clean', title: '干净的', generation_context_snapshot: null },
        { id: 'flagged', title: '中英混杂的', generation_context_snapshot: flaggedSnapshot },
      ],
      error: null,
    })
    const postUpdate = builder({ data: [{ id: 'written' }], error: null })
    const pkgUpdate = builder({ data: { status: 'approved' }, error: null })
    mockFrom
      .mockReturnValueOnce(pkg as never)
      .mockReturnValueOnce(guardRead as never)
      .mockReturnValueOnce(postUpdate as never)
      .mockReturnValue(pkgUpdate as never)

    const response = await callSchedule([
      { post_id: 'clean', scheduled_at: '2026-09-24T02:00:00.000Z' },
      { post_id: 'flagged', scheduled_at: '2026-09-24T03:00:00.000Z' },
    ])
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.scheduled).toBe(1)
    expect(json.skipped).toEqual([{ id: 'flagged', title: '中英混杂的', reasons: ['mixed_language'] }])
    // Exactly one content_posts row was written, and it was the clean one.
    expect(postUpdate.update).toHaveBeenCalledTimes(1)
    expect(postUpdate.eq).toHaveBeenCalledWith('id', 'clean')
    // 混合批次里还有一条被标红没处理完——包不能跟着改成 approved，
    // 不然它会跟着退出待审核队列，没人再看那条标红内容（Codex 复审）。
    expect(json.packageStatus).toBe('ready_for_review')
    expect(pkgUpdate.update).not.toHaveBeenCalled()
  })

  it('refuses the whole batch (409, nothing written) when every post is flagged', async () => {
    const pkg = builder({ data: { id: PACKAGE, status: 'ready_for_review' }, error: null })
    const guardRead = builder({
      data: [{ id: 'flagged', title: '中英混杂的', generation_context_snapshot: flaggedSnapshot }],
      error: null,
    })
    const never = builder({ data: [], error: null })
    mockFrom.mockReturnValueOnce(pkg as never).mockReturnValueOnce(guardRead as never).mockReturnValue(never as never)

    const response = await callSchedule([{ post_id: 'flagged', scheduled_at: '2026-09-24T02:00:00.000Z' }])
    const json = await response.json()

    expect(response.status).toBe(409)
    expect(json.success).toBe(false)
    expect(json.scheduled).toBe(0)
    expect(json.skipped[0].id).toBe('flagged')
    expect(never.update).not.toHaveBeenCalled()
  })

  it('a post that was never checked still schedules — unchecked is not the same as flagged', async () => {
    const pkg = builder({ data: { id: PACKAGE, status: 'ready_for_review' }, error: null })
    const guardRead = builder({ data: [{ id: 'old', title: '老内容', generation_context_snapshot: { lesson_no: 2 } }], error: null })
    const postUpdate = builder({ data: [{ id: 'written' }], error: null })
    const pkgUpdate = builder({ data: { status: 'approved' }, error: null })
    mockFrom
      .mockReturnValueOnce(pkg as never)
      .mockReturnValueOnce(guardRead as never)
      .mockReturnValueOnce(postUpdate as never)
      .mockReturnValue(pkgUpdate as never)

    const json = await (await callSchedule([{ post_id: 'old', scheduled_at: '2026-09-24T02:00:00.000Z' }])).json()

    expect(json.scheduled).toBe(1)
    expect(json.skipped).toEqual([])
  })
})

describe('production package bulk scheduling — 回执不许说谎（魏征复审）', () => {
  it('writing zero rows counts as failed, not "✅ scheduled"', async () => {
    const pkg = builder({ data: { id: PACKAGE, status: 'ready_for_review' }, error: null })
    const guardRead = builder({ data: [{ id: 'gone', title: '刚被删掉的', generation_context_snapshot: null }], error: null })
    const postUpdate = builder({ data: [], error: null }) // update 命中 0 行，Supabase 不报错
    mockFrom.mockReturnValueOnce(pkg as never).mockReturnValueOnce(guardRead as never).mockReturnValue(postUpdate as never)

    const json = await (await callSchedule([{ post_id: 'gone', scheduled_at: '2026-09-24T02:00:00.000Z' }])).json()

    expect(json.scheduled).toBe(0)
    expect(json.failed).toBe(1)
  })

  it('refuses the batch when the guard read comes back short — unread is not unflagged', async () => {
    const pkg = builder({ data: { id: PACKAGE, status: 'ready_for_review' }, error: null })
    // 传两条，只读回一条（另一条不属于这个客户 / 刚被删 / 查询被截断）
    const guardRead = builder({ data: [{ id: 'a', title: 'A', generation_context_snapshot: null }], error: null })
    const never = builder({ data: [], error: null })
    mockFrom.mockReturnValueOnce(pkg as never).mockReturnValueOnce(guardRead as never).mockReturnValue(never as never)

    const response = await callSchedule([
      { post_id: 'a', scheduled_at: '2026-09-24T02:00:00.000Z' },
      { post_id: 'b', scheduled_at: '2026-09-24T03:00:00.000Z' },
    ])

    expect(response.status).toBe(409)
    expect(never.update).not.toHaveBeenCalled()
  })

  it('counts a post sent twice once', async () => {
    const pkg = builder({ data: { id: PACKAGE, status: 'ready_for_review' }, error: null })
    const guardRead = builder({ data: [{ id: 'dup', title: '重复的', generation_context_snapshot: null }], error: null })
    const postUpdate = builder({ data: [{ id: 'dup' }], error: null })
    const pkgUpdate = builder({ data: { status: 'approved' }, error: null })
    mockFrom
      .mockReturnValueOnce(pkg as never)
      .mockReturnValueOnce(guardRead as never)
      .mockReturnValueOnce(postUpdate as never)
      .mockReturnValue(pkgUpdate as never)

    const json = await (await callSchedule([
      { post_id: 'dup', scheduled_at: '2026-09-24T02:00:00.000Z' },
      { post_id: 'dup', scheduled_at: '2026-09-24T05:00:00.000Z' },
    ])).json()

    expect(json.scheduled).toBe(1)
    expect(postUpdate.update).toHaveBeenCalledTimes(1)
  })
})
