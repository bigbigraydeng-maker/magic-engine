/**
 * 客户确认页（issue #1646），复审修复回归测试。
 *
 * 只锁三份复审（子牙/魏征/板桥）实际找到、已经修好的行为，不重测已经在
 * `confirmation-requests.test.ts` / `knowledge-confirmation.test.ts` 锁过的
 * 底层逻辑：
 *   · 板桥 1：已经用过的链接仍能按到「停止 AI 回复」
 *   · 板桥 3：同一个冲突组的几条不会被批次切开
 *   · 板桥 4：一条都没确认时不说"你确认了 0 条"
 *   · 板桥 2：§9.10 对客一句话真的出现在确认页上
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { ConfirmationLinkView, ConsumeResult } from '@/lib/knowledge/confirmation-requests'

const cookieState: { store: Map<string, string> } = { store: new Map() }

vi.mock('next/headers', () => ({
  cookies: () => ({
    get: (name: string) => {
      const v = cookieState.store.get(name)
      return v ? { name, value: v } : undefined
    },
  }),
}))

const mocks = vi.hoisted(() => ({
  loadConfirmationRequest: vi.fn(),
  consumeConfirmationRequest: vi.fn(),
}))

vi.mock('@/lib/knowledge/confirmation-requests', async () => {
  const actual = await vi.importActual<typeof import('@/lib/knowledge/confirmation-requests')>(
    '@/lib/knowledge/confirmation-requests',
  )
  return {
    ...actual,
    loadConfirmationRequest: mocks.loadConfirmationRequest,
    consumeConfirmationRequest: mocks.consumeConfirmationRequest,
  }
})

vi.mock('@/lib/knowledge/admin-client', () => ({
  knowledgeWriteClient: () => ({}),
}))

// `sendReceipt` (a POST-success side effect) reads through supabaseAdmin.
// None of these tests assert on the receipt email itself, so a minimal
// thenable stub that resolves empty is enough to keep it from throwing.
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from() {
      const builder = {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        maybeSingle: async () => ({ data: null, error: null }),
        then: (resolve: (v: { data: unknown; error: null }) => void) => resolve({ data: [], error: null }),
      }
      return builder
    },
  },
}))

import { GET, POST } from '../route'

const ORIGIN = 'https://app.magicengine.com.au'
const REQUEST_ID = 'req-1'
const RAW_TOKEN = 'tok-abc'

beforeEach(() => {
  process.env.APP_URL = ORIGIN
  cookieState.store = new Map([['me-knowledge-confirm-nonce', 'n1']])
  mocks.loadConfirmationRequest.mockReset()
  mocks.consumeConfirmationRequest.mockReset()
})

function getReq(): NextRequest {
  return new NextRequest(`${ORIGIN}/knowledge-confirm/${REQUEST_ID}?token=${RAW_TOKEN}`, { method: 'GET' })
}

function postReq(fields: Record<string, string>, headers: Record<string, string> = { origin: ORIGIN }): NextRequest {
  const body = new URLSearchParams(fields)
  return new NextRequest(`${ORIGIN}/knowledge-confirm/${REQUEST_ID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: body.toString(),
  })
}

function readNonceCookie(res: Response): string | undefined {
  const raw = res.headers.get('set-cookie') ?? ''
  return /me-knowledge-confirm-nonce=([^;]*)/.exec(raw)?.[1]
}

describe('GET /knowledge-confirm/[requestId]', () => {
  it('issue #1822 回归：不能再发 referrer-policy: no-referrer——Fetch 规范下真实浏览器对同页表单自己发出的 POST 会因此把 Origin 置成 "null"，导致 POST 那道同源 CSRF 闸对真人点击必然判定失败（knowledge-rollout-confirm 复现过，两条路由共享同一段 htmlResponse 写法）', async () => {
    mocks.loadConfirmationRequest.mockResolvedValue({ ok: false, problem: 'expired' })
    const res = await GET(getReq(), { params: { requestId: REQUEST_ID } })
    expect(res.headers.get('referrer-policy')).toBe('same-origin')
    expect(res.headers.get('referrer-policy')).not.toBe('no-referrer')
  })

  it('🔴 板桥 1：链接已经用过时，页面仍然带着「停止 AI 回复」的表单和 nonce cookie', async () => {
    mocks.loadConfirmationRequest.mockResolvedValue({ ok: false, problem: 'already_used' })

    const res = await GET(getReq(), { params: { requestId: REQUEST_ID } })
    const html = await res.text()

    expect(html).toContain('name="intent" value="stop_ai"')
    expect(html).toContain('这批内容已经确认过了')
    expect(readNonceCookie(res)).toBeTruthy()
  })

  it('过期/令牌不对等其它问题不给停止表单（没有可信身份可用）', async () => {
    mocks.loadConfirmationRequest.mockResolvedValue({ ok: false, problem: 'expired' })

    const res = await GET(getReq(), { params: { requestId: REQUEST_ID } })
    const html = await res.text()

    expect(html).not.toContain('name="intent" value="stop_ai"')
    expect(readNonceCookie(res)).toBeUndefined()
  })

  it('🔴 板桥 3：同一个冲突组的两条不会被 5 条一批的边界切开', async () => {
    const facts: ConfirmationLinkView['facts'] = [
      ...Array.from({ length: 4 }, (_, i) => ({
        factId: `single-${i}`,
        statement: `无关条目 ${i}`,
        sensitivity: 'general' as const,
        validUntil: null,
        conflictGroupId: null,
        changedSinceSent: false,
      })),
      {
        factId: 'conflict-a',
        statement: '空运每公斤 NZD 7',
        sensitivity: 'price',
        validUntil: null,
        conflictGroupId: 'group-1',
        changedSinceSent: false,
      },
      {
        factId: 'conflict-b',
        statement: '空运每公斤 NZD 5（旧价）',
        sensitivity: 'price',
        validUntil: null,
        conflictGroupId: 'group-1',
        changedSinceSent: false,
      },
    ]
    mocks.loadConfirmationRequest.mockResolvedValue({
      ok: true,
      requestId: REQUEST_ID,
      clientId: 'client-1',
      clientName: 'CTS Tours NZ',
      confirmerEmail: 'owner@ctstours.co.nz',
      expiresAt: '2026-09-28T00:00:00.000Z',
      facts,
    } satisfies ConfirmationLinkView)

    const res = await GET(getReq(), { params: { requestId: REQUEST_ID } })
    const html = await res.text()

    // naive chunk(items, 5) would put conflict-a in block 1 (items 5 of 5)
    // and conflict-b alone in block 2 — split, defeating the "compare them"
    // UX. Assert both statements land inside the SAME <div class="block">.
    const blocks = html.split('<div class="block">')
    const blockWithConflictA = blocks.find((b) => b.includes('NZD 7'))
    expect(blockWithConflictA).toContain('NZD 5（旧价）')
    expect(html).toContain('这一组里有同一件事的几种不同说法')
  })

  it('🔴 板桥 2：§9.10 对客一句话出现在确认页上', async () => {
    mocks.loadConfirmationRequest.mockResolvedValue({
      ok: true,
      requestId: REQUEST_ID,
      clientId: 'client-1',
      clientName: 'CTS Tours NZ',
      confirmerEmail: 'owner@ctstours.co.nz',
      expiresAt: '2026-09-28T00:00:00.000Z',
      facts: [
        {
          factId: 'f1',
          statement: '20 公斤以下每公斤 NZD 4',
          sensitivity: 'price',
          validUntil: null,
          conflictGroupId: null,
          changedSinceSent: false,
        },
      ],
    } satisfies ConfirmationLinkView)

    const res = await GET(getReq(), { params: { requestId: REQUEST_ID } })
    const html = await res.text()

    expect(html).toContain('AI 客服报的价跟你们最好的员工一样准，每个价格都经过你点头')
  })
})

describe('POST /knowledge-confirm/[requestId]', () => {
  function successResult(overrides: {
    confirmedFactIds?: string[]
    rejectedFactIds?: string[]
    staleFactIds?: string[]
  } = {}): ConsumeResult {
    return {
      ok: true,
      requestId: REQUEST_ID,
      clientId: 'client-1',
      confirmerEmail: 'owner@ctstours.co.nz',
      confirmedFactIds: [],
      rejectedFactIds: [],
      staleFactIds: [],
      ...overrides,
    }
  }

  it('issue #1822：POST 的 Origin 是字面字符串 "null" 时必须仍然拒绝（403）——这正是 no-referrer 页面上真实浏览器点击会发出的值，同源闸不能只挡"没有 Origin 头"这一种情况', async () => {
    const res = await POST(
      postReq({ token: RAW_TOKEN, nonce: 'n1' }, { origin: 'null' }),
      { params: { requestId: REQUEST_ID } },
    )
    expect(res.status).toBe(403)
    expect(mocks.consumeConfirmationRequest).not.toHaveBeenCalled()
  })

  it('🔴 板桥 4：一条都没确认时不说"你确认了 0 条"', async () => {
    mocks.consumeConfirmationRequest.mockResolvedValue(
      successResult({ rejectedFactIds: ['f1'] }),
    )

    const res = await POST(
      postReq({ token: RAW_TOKEN, nonce: 'n1', 'choice:f1': 'reject' }),
      { params: { requestId: REQUEST_ID } },
    )
    const html = await res.text()

    expect(html).not.toContain('你确认了 0 条')
    expect(html).toContain('这次你没有确认任何一条')
  })

  it('确认了 ≥1 条时用原来的措辞', async () => {
    mocks.consumeConfirmationRequest.mockResolvedValue(successResult({ confirmedFactIds: ['f1'] }))

    const res = await POST(
      postReq({ token: RAW_TOKEN, nonce: 'n1', 'choice:f1': 'confirm' }),
      { params: { requestId: REQUEST_ID } },
    )
    const html = await res.text()

    expect(html).toContain('你确认了 1 条')
  })
})
