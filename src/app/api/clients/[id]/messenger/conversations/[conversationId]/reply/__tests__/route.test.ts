/**
 * Tests for the send-reply endpoint.
 *
 * The endpoint is reachable by a client's own staff, so the tests are about
 * refusing before anything leaves the building:
 *   - an unauthenticated or non-member caller never reaches sendReply
 *   - a send is never made anonymous — no email, no send
 *   - sendReply's own refusals (wrong client, closed window) surface as their
 *     real status codes rather than a generic 500
 *
 * Also covers the draft-decision branch (Issue #1586, F3
 * `conversation.approval.emit`): approve / edit_and_approve / reject state
 * transitions on `conversation_reply_drafts`, the IDOR guard (draft_id alone
 * must not be trusted across client/conversation), the atomic
 * `WHERE verifier_status='pending'` condition on the UPDATE itself (魏征
 * complex 2026-09-15: a plain "SELECT then trust it, then UPDATE
 * unconditionally" is racy — two concurrent decisions on the same draft can
 * both pass the earlier SELECT-based check), and the fail-closed rollback
 * when notifying F2 fails after the DB already says "approved" (including
 * the rollback write itself failing, which the original implementation
 * silently ignored).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/messenger/send', () => ({ sendReply: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/messenger-agent/conversation-approval-emit', () => ({
  emitConversationApprovalEvent: vi.fn(),
}))

import { POST } from '../route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { sendReply } from '@/lib/messenger/send'
import { supabaseAdmin } from '@/lib/supabase'
import { emitConversationApprovalEvent } from '@/lib/messenger-agent/conversation-approval-emit'

const mockAccess = vi.mocked(requirePaidClientAccess)
const mockSend = vi.mocked(sendReply)
const mockFrom = vi.mocked(supabaseAdmin.from)
const mockEmit = vi.mocked(emitConversationApprovalEvent)

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZTOP = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const CONVO = 'convo-uuid'
const DRAFT_ID = 'a1111111-1111-4111-8111-111111111111'

function request(body: unknown): NextRequest {
  return new NextRequest(`http://localhost:3001/api/clients/${CTS}/messenger/x/reply`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function params(id = CTS) {
  return { params: { id, conversationId: CONVO } }
}

// `email: null` models a session with no email at all — passing `undefined`
// would silently fall back to the default parameter and test nothing.
function allow(email: string | null = 'bdm@ctstours.co.nz') {
  mockAccess.mockResolvedValue({
    ok: true,
    user: { email: email ?? undefined } as never,
    role: 'client-viewer',
    tier: 'paid_client',
    allowedClientId: CTS,
  } as never)
}

// ---------------------------------------------------------------------------
// Chainable Supabase query-builder fake, same shape as
// src/lib/messenger-agent/__tests__/tools.test.ts's makeQueryBuilder — select/
// eq/maybeSingle for the fetch, a second builder shape for update/eq.
// ---------------------------------------------------------------------------
function makeSelectBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  builder.select = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.maybeSingle = vi.fn(() => Promise.resolve(result))
  return builder
}

/**
 * Two call shapes hit this same builder in `route.ts`:
 *   - the atomic conditional updates: `.update(patch).eq('id', ...)
 *     .eq('verifier_status', 'pending').select('id')` — resolves via `.select()`
 *   - the rollback-on-emit-failure update: `.update(patch).eq('id', ...)` —
 *     awaited directly with no trailing `.select()`
 * so the builder itself must be a thenable (like
 * src/lib/messenger-agent/__tests__/tools.test.ts's makeQueryBuilder) as well
 * as exposing a real `.select()` — whichever one the code under test actually
 * calls resolves to the same `result`.
 *
 * `data` is the array of rows an atomic conditional update actually touched.
 * `data: []` (or `null`) models "0 rows matched because verifier_status was
 * no longer 'pending' by the time this UPDATE's WHERE clause was evaluated" —
 * i.e. lost a race, or the draft was never eligible in the first place.
 */
function makeUpdateBuilder(result: { data: unknown; error: unknown }) {
  const builder: Record<string, unknown> = {}
  builder.update = vi.fn(() => builder)
  builder.eq = vi.fn(() => builder)
  builder.select = vi.fn(() => Promise.resolve(result))
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject)
  return builder
}

function draftRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT_ID,
    client_id: CTS,
    conversation_id: CONVO,
    ...overrides,
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST reply — authorisation', () => {
  it('rejects an unauthenticated caller without attempting to send', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' } as never)

    const res = await POST(request({ body: 'hi' }), params())

    expect(res.status).toBe(401)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('rejects a caller who is not a member of the client in the URL', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)

    const res = await POST(request({ body: 'hi' }), params(OZTOP))

    expect(res.status).toBe(403)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('checks access against the client id in the URL, not one from the body', async () => {
    allow()
    mockSend.mockResolvedValue({ ok: true, metaMessageId: 'mid.1', window: 'standard' } as never)

    await POST(request({ body: 'hi', clientId: OZTOP }), params(CTS))

    expect(mockAccess).toHaveBeenCalledWith(CTS)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ clientId: CTS }))
  })

  it('refuses to send when the session carries no email to attribute it to', async () => {
    allow(null)

    const res = await POST(request({ body: 'hi' }), params())

    expect(res.status).toBe(403)
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('POST reply — payload', () => {
  it('rejects a non-string body', async () => {
    allow()

    const res = await POST(request({ body: 42 }), params())

    expect(res.status).toBe(400)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('passes the sender email and draft flag through to the sender', async () => {
    allow()
    mockSend.mockResolvedValue({ ok: true, metaMessageId: null, window: 'standard' } as never)

    await POST(request({ body: 'Happy to help', usedAiDraft: true }), params())

    expect(mockSend).toHaveBeenCalledWith({
      clientId: CTS,
      conversationId: CONVO,
      body: 'Happy to help',
      sentByEmail: 'bdm@ctstours.co.nz',
      usedAiDraft: true,
    })
  })

  it('defaults usedAiDraft to false so the audit never overstates AI involvement', async () => {
    allow()
    mockSend.mockResolvedValue({ ok: true, metaMessageId: null, window: 'standard' } as never)

    await POST(request({ body: 'typed by hand' }), params())

    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ usedAiDraft: false }))
  })
})

describe('POST reply — failures surface accurately', () => {
  it('returns 403 when the thread belongs to another client', async () => {
    allow()
    mockSend.mockResolvedValue({
      ok: false,
      status: 403,
      error: 'Forbidden',
      reason: 'wrong_client',
    } as never)

    const res = await POST(request({ body: 'hi' }), params())

    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ reason: 'wrong_client' })
  })

  it('returns 409 with a reason the UI can act on when the window has closed', async () => {
    allow()
    mockSend.mockResolvedValue({
      ok: false,
      status: 409,
      error: 'Messenger 回复窗口已关闭',
      reason: 'window_closed',
    } as never)

    const res = await POST(request({ body: 'hi' }), params())

    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ reason: 'window_closed' })
  })
})

describe('POST reply — draft decision (Issue #1586, F3)', () => {
  it('rejects an unauthenticated caller before touching the drafts table', async () => {
    mockAccess.mockResolvedValue({ ok: false, status: 401, error: 'Unauthorized' } as never)

    const res = await POST(request({ draft_id: DRAFT_ID, action: 'approve' }), params())

    expect(res.status).toBe(401)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects a draft_id that is not a valid UUID before touching the database', async () => {
    allow()
    const res = await POST(request({ draft_id: 'not-a-uuid', action: 'approve' }), params())
    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects an unknown action', async () => {
    allow()
    const res = await POST(request({ draft_id: DRAFT_ID, action: 'do_something_else' }), params())
    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects edit_and_approve without a non-empty edited_body', async () => {
    allow()
    const res1 = await POST(request({ draft_id: DRAFT_ID, action: 'edit_and_approve' }), params())
    expect(res1.status).toBe(400)

    const res2 = await POST(
      request({ draft_id: DRAFT_ID, action: 'edit_and_approve', edited_body: '   ' }),
      params(),
    )
    expect(res2.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it('rejects edit_and_approve when edited_body exceeds the 1800-char hard cap', async () => {
    allow()
    const res = await POST(
      request({ draft_id: DRAFT_ID, action: 'edit_and_approve', edited_body: 'a'.repeat(1801) }),
      params(),
    )
    expect(res.status).toBe(400)
    expect(mockFrom).not.toHaveBeenCalled()
  })

  it(
    '🔴 IDOR guard: a draft_id that exists but belongs to a different client/conversation is treated ' +
    'as not found — the fetch query scopes by client_id AND conversation_id, not draft_id alone',
    async () => {
      allow()
      const selectBuilder = makeSelectBuilder({ data: null, error: null })
      mockFrom.mockReturnValue(selectBuilder as never)

      const res = await POST(request({ draft_id: DRAFT_ID, action: 'approve' }), params(OZTOP))

      expect(res.status).toBe(404)
      // 🔴 变异守卫：fetch 必须同时按 client_id 和 conversation_id 过滤，不能只按 id。
      expect(selectBuilder.eq).toHaveBeenCalledWith('id', DRAFT_ID)
      expect(selectBuilder.eq).toHaveBeenCalledWith('client_id', OZTOP)
      expect(selectBuilder.eq).toHaveBeenCalledWith('conversation_id', CONVO)
      expect(mockEmit).not.toHaveBeenCalled()
    },
  )

  it(
    '🔴 并发穿透守卫：approve 的原子条件更新影响 0 行(状态已经不是 pending)时返回 409，' +
    '不信任早前 SELECT 读到的状态',
    async () => {
      allow()
      const selectBuilder = makeSelectBuilder({ data: draftRow(), error: null })
      // 0 行受影响 = 这次 UPDATE 的 WHERE verifier_status='pending' 没有命中——
      // 无论是已经被并发请求决定过，还是从一开始就是 blocked，行为都一样。
      const updateBuilder = makeUpdateBuilder({ data: [], error: null })
      mockFrom.mockReturnValueOnce(selectBuilder as never).mockReturnValueOnce(updateBuilder as never)

      const res = await POST(request({ draft_id: DRAFT_ID, action: 'approve' }), params())

      expect(res.status).toBe(409)
      expect(await res.json()).toMatchObject({ reason: 'not_pending' })
      // 🔴 变异守卫：这次 UPDATE 必须真的带上 verifier_status='pending' 这个条件，
      // 不能只在应用代码里判断一次就无条件写库。
      expect(updateBuilder.eq).toHaveBeenCalledWith('verifier_status', 'pending')
      expect(mockEmit).not.toHaveBeenCalled()
    },
  )

  it('同样的并发穿透守卫也适用于 reject（0 行受影响 → 409，不是 500 或误报成功）', async () => {
    allow()
    const selectBuilder = makeSelectBuilder({ data: draftRow(), error: null })
    const updateBuilder = makeUpdateBuilder({ data: null, error: null })
    mockFrom.mockReturnValueOnce(selectBuilder as never).mockReturnValueOnce(updateBuilder as never)

    const res = await POST(request({ draft_id: DRAFT_ID, action: 'reject' }), params())

    expect(res.status).toBe(409)
    expect(updateBuilder.eq).toHaveBeenCalledWith('verifier_status', 'pending')
  })

  it('approve: marks the draft approved, records who decided, and emits the F2 wakeup event', async () => {
    allow('fde@ctstours.co.nz')
    const selectBuilder = makeSelectBuilder({ data: draftRow(), error: null })
    const updateBuilder = makeUpdateBuilder({ data: [{ id: DRAFT_ID }], error: null })
    mockFrom.mockReturnValueOnce(selectBuilder as never).mockReturnValueOnce(updateBuilder as never)
    mockEmit.mockResolvedValue(undefined)

    const res = await POST(request({ draft_id: DRAFT_ID, action: 'approve' }), params())

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, verifier_status: 'approved' })
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ verifier_status: 'approved', decided_by_email: 'fde@ctstours.co.nz' }),
    )
    // 原子条件——不是只在应用代码里判断一次就无条件写库。
    expect(updateBuilder.eq).toHaveBeenCalledWith('id', DRAFT_ID)
    expect(updateBuilder.eq).toHaveBeenCalledWith('verifier_status', 'pending')
    // approve 本身不改草稿正文
    expect(updateBuilder.update).not.toHaveBeenCalledWith(expect.objectContaining({ draft_body: expect.anything() }))
    expect(mockEmit).toHaveBeenCalledWith({
      draftId: DRAFT_ID,
      clientId: CTS,
      conversationId: CONVO,
      decidedByEmail: 'fde@ctstours.co.nz',
    })
  })

  it('edit_and_approve: overwrites draft_body with the edited text before marking approved', async () => {
    allow()
    const selectBuilder = makeSelectBuilder({ data: draftRow(), error: null })
    const updateBuilder = makeUpdateBuilder({ data: [{ id: DRAFT_ID }], error: null })
    mockFrom.mockReturnValueOnce(selectBuilder as never).mockReturnValueOnce(updateBuilder as never)
    mockEmit.mockResolvedValue(undefined)

    const res = await POST(
      request({ draft_id: DRAFT_ID, action: 'edit_and_approve', edited_body: '改过的回复文案' }),
      params(),
    )

    expect(res.status).toBe(200)
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ verifier_status: 'approved', draft_body: '改过的回复文案' }),
    )
    expect(mockEmit).toHaveBeenCalled()
  })

  it('reject: marks the draft rejected and does NOT notify F2 (human takes over manually)', async () => {
    allow('fde@ctstours.co.nz')
    const selectBuilder = makeSelectBuilder({ data: draftRow(), error: null })
    const updateBuilder = makeUpdateBuilder({ data: [{ id: DRAFT_ID }], error: null })
    mockFrom.mockReturnValueOnce(selectBuilder as never).mockReturnValueOnce(updateBuilder as never)

    const res = await POST(request({ draft_id: DRAFT_ID, action: 'reject' }), params())

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, verifier_status: 'rejected' })
    expect(updateBuilder.update).toHaveBeenCalledWith(
      expect.objectContaining({ verifier_status: 'rejected', decided_by_email: 'fde@ctstours.co.nz' }),
    )
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it(
    '🔴 fail-closed: if notifying F2 fails after the DB already says approved, the draft is rolled ' +
    'back to pending and the caller gets an explicit error — never a silent "approved, nobody told F2"',
    async () => {
      allow()
      const selectBuilder = makeSelectBuilder({ data: draftRow(), error: null })
      const approveBuilder = makeUpdateBuilder({ data: [{ id: DRAFT_ID }], error: null })
      const rollbackBuilder = makeUpdateBuilder({ data: [{ id: DRAFT_ID }], error: null })
      mockFrom
        .mockReturnValueOnce(selectBuilder as never)
        .mockReturnValueOnce(approveBuilder as never)
        .mockReturnValueOnce(rollbackBuilder as never)
      mockEmit.mockRejectedValue(new Error('INNGEST_EVENT_SEND_FAILED:500'))

      const res = await POST(request({ draft_id: DRAFT_ID, action: 'approve' }), params())

      expect(res.status).toBe(502)
      expect(await res.json()).toMatchObject({ error: expect.stringContaining('已回退为待批准状态') })
      expect(rollbackBuilder.update).toHaveBeenCalledWith(
        expect.objectContaining({ verifier_status: 'pending' }),
      )
    },
  )

  it(
    '🔴 子牙+魏征复审 blocker: if the ROLLBACK write itself also fails, the response must not claim ' +
    '"rolled back to pending" — it must say the draft is in an inconsistent state needing a human',
    async () => {
      allow()
      const selectBuilder = makeSelectBuilder({ data: draftRow(), error: null })
      const approveBuilder = makeUpdateBuilder({ data: [{ id: DRAFT_ID }], error: null })
      const rollbackBuilder = makeUpdateBuilder({ data: null, error: { message: 'connection reset' } })
      mockFrom
        .mockReturnValueOnce(selectBuilder as never)
        .mockReturnValueOnce(approveBuilder as never)
        .mockReturnValueOnce(rollbackBuilder as never)
      mockEmit.mockRejectedValue(new Error('INNGEST_EVENT_SEND_FAILED:500'))

      const res = await POST(request({ draft_id: DRAFT_ID, action: 'approve' }), params())

      expect(res.status).toBe(502)
      const body = await res.json()
      expect(body.error).not.toContain('已回退为待批准状态，请重试')
      expect(body.error).toContain('不一致')
    },
  )

  it('surfaces a DB fetch error as 500 rather than treating it as "not found"', async () => {
    allow()
    const selectBuilder = makeSelectBuilder({ data: null, error: { message: 'connection reset' } })
    mockFrom.mockReturnValue(selectBuilder as never)

    const res = await POST(request({ draft_id: DRAFT_ID, action: 'approve' }), params())

    expect(res.status).toBe(500)
    expect(mockEmit).not.toHaveBeenCalled()
  })
})
