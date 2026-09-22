/**
 * 客户「阶段切换」确认页（issue #1648）。
 *
 * 只锁这条路由自己新增的行为——底层 `createRolloutAdvanceRequest` /
 * `consumeRolloutAdvanceRequest` 的判据已经在 `rollout.test.ts` 锁过：
 *   · GET 只读、不写，且带下一次性 nonce cookie；
 *   · POST 的两道 CSRF 闸（同源 / nonce）跟 #1646 的确认页同一套写法；
 *   · 阶段号不裸给客户看——页面只出现 `ROLLOUT_STAGE_LABELS` 的大白话名字；
 *   · `superseded`（阶段被回退超越）跟 `already_used` 渲染成不同的文案。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import type { RolloutAdvanceLinkView } from '@/lib/knowledge/rollout'

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
  loadRolloutAdvanceRequest: vi.fn(),
  consumeRolloutAdvanceRequest: vi.fn(),
}))

vi.mock('@/lib/knowledge/rollout', async () => {
  const actual = await vi.importActual<typeof import('@/lib/knowledge/rollout')>('@/lib/knowledge/rollout')
  return {
    ...actual,
    loadRolloutAdvanceRequest: mocks.loadRolloutAdvanceRequest,
    consumeRolloutAdvanceRequest: mocks.consumeRolloutAdvanceRequest,
  }
})

vi.mock('@/lib/knowledge/admin-client', () => ({
  knowledgeWriteClient: () => ({}),
}))

import { GET, POST } from '../route'

const ORIGIN = 'https://app.magicengine.com.au'
const REQUEST_ID = 'req-1'
const RAW_TOKEN = 'tok-abc'

beforeEach(() => {
  process.env.APP_URL = ORIGIN
  cookieState.store = new Map([['me-knowledge-rollout-confirm-nonce', 'n1']])
  mocks.loadRolloutAdvanceRequest.mockReset()
  mocks.consumeRolloutAdvanceRequest.mockReset()
})

function getReq(): NextRequest {
  return new NextRequest(`${ORIGIN}/knowledge-rollout-confirm/${REQUEST_ID}?token=${RAW_TOKEN}`, { method: 'GET' })
}

function postReq(fields: Record<string, string>, headers: Record<string, string> = { origin: ORIGIN }): NextRequest {
  const body = new URLSearchParams(fields)
  return new NextRequest(`${ORIGIN}/knowledge-rollout-confirm/${REQUEST_ID}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: body.toString(),
  })
}

function readNonceCookie(res: Response): string | undefined {
  const raw = res.headers.get('set-cookie') ?? ''
  return /me-knowledge-rollout-confirm-nonce=([^;]*)/.exec(raw)?.[1]
}

const VIEW: RolloutAdvanceLinkView = {
  ok: true,
  requestId: REQUEST_ID,
  clientId: 'client-1',
  clientName: 'CTS Tours NZ',
  confirmerEmail: 'owner@ctstours.co.nz',
  fromStage: 0,
  toStage: 1,
  sampleCheck: null,
  expiresAt: '2026-09-28T00:00:00.000Z',
}

describe('GET /knowledge-rollout-confirm/[requestId]', () => {
  it('renders the plain-language stage names, never a raw stage number, and sets a fresh nonce cookie without writing anything', async () => {
    mocks.loadRolloutAdvanceRequest.mockResolvedValue(VIEW)

    const res = await GET(getReq(), { params: { requestId: REQUEST_ID } })
    const html = await res.text()

    expect(html).toContain('内部整理阶段')
    expect(html).toContain('客户共测阶段')
    // 🔴 板桥："阶段号别裸给客户看"——不能出现 "stage 1" / 独立的 "阶段 1" 代号。
    expect(html).not.toMatch(/stage\s*1/i)
    expect(html).not.toContain('阶段 1')
    expect(readNonceCookie(res)).toBeTruthy()
    expect(mocks.consumeRolloutAdvanceRequest).not.toHaveBeenCalled()
  })

  it('issue #1822 regression: never sends referrer-policy: no-referrer — that value makes a real browser null out Origin on the page\'s own POST, which the CSRF gate below then always rejects', async () => {
    mocks.loadRolloutAdvanceRequest.mockResolvedValue(VIEW)
    const res = await GET(getReq(), { params: { requestId: REQUEST_ID } })
    expect(res.headers.get('referrer-policy')).toBe('same-origin')
    expect(res.headers.get('referrer-policy')).not.toBe('no-referrer')
  })

  it('shows the sample-check result when advancing out of stage 1', async () => {
    mocks.loadRolloutAdvanceRequest.mockResolvedValue({
      ...VIEW,
      fromStage: 1,
      toStage: 2,
      sampleCheck: { sampleSize: 30, priceErrors: 0, otherAccuracyPct: 95 },
    } satisfies RolloutAdvanceLinkView)

    const res = await GET(getReq(), { params: { requestId: REQUEST_ID } })
    const html = await res.text()

    expect(html).toContain('我们抽查了 30 条对话')
    expect(html).toContain('价格说错的：0 条')
    expect(html).toContain('其他说法准确率：95%')
  })

  it('a missing token is rejected before any load, no cookie set', async () => {
    const req = new NextRequest(`${ORIGIN}/knowledge-rollout-confirm/${REQUEST_ID}`, { method: 'GET' })
    const res = await GET(req, { params: { requestId: REQUEST_ID } })
    expect(res.status).toBe(400)
    expect(mocks.loadRolloutAdvanceRequest).not.toHaveBeenCalled()
    expect(readNonceCookie(res)).toBeUndefined()
  })

  it('"superseded" (rolled back out from under the link) renders distinct wording from "already_used"', async () => {
    mocks.loadRolloutAdvanceRequest.mockResolvedValue({ ok: false, problem: 'superseded' })
    const res = await GET(getReq(), { params: { requestId: REQUEST_ID } })
    const html = await res.text()
    expect(html).toContain('暂停了这次切换')
    expect(html).not.toContain('已经确认过了')
  })

  it('"already_used" renders its own wording, distinct from "superseded"', async () => {
    mocks.loadRolloutAdvanceRequest.mockResolvedValue({ ok: false, problem: 'already_used' })
    const res = await GET(getReq(), { params: { requestId: REQUEST_ID } })
    const html = await res.text()
    expect(html).toContain('已经确认过了')
    expect(html).not.toContain('暂停了这次切换')
  })
})

describe('POST /knowledge-rollout-confirm/[requestId] — CSRF discipline', () => {
  it('refuses a cross-origin submit (no Origin header trusted)', async () => {
    const res = await POST(
      postReq({ token: RAW_TOKEN, nonce: 'n1' }, { origin: 'https://evil.example.com' }),
      { params: { requestId: REQUEST_ID } },
    )
    expect(res.status).toBe(403)
    expect(mocks.consumeRolloutAdvanceRequest).not.toHaveBeenCalled()
  })

  it('refuses a submit with no Origin header at all', async () => {
    const res = await POST(postReq({ token: RAW_TOKEN, nonce: 'n1' }, {}), { params: { requestId: REQUEST_ID } })
    expect(res.status).toBe(403)
    expect(mocks.consumeRolloutAdvanceRequest).not.toHaveBeenCalled()
  })

  it('issue #1822: refuses the literal string "null" as Origin — this is what a no-referrer-policy page\'s own POST sends per the Fetch spec, so the gate must reject it exactly like any other mismatched origin, not just a missing header', async () => {
    const res = await POST(
      postReq({ token: RAW_TOKEN, nonce: 'n1' }, { origin: 'null' }),
      { params: { requestId: REQUEST_ID } },
    )
    expect(res.status).toBe(403)
    expect(mocks.consumeRolloutAdvanceRequest).not.toHaveBeenCalled()
  })

  it('refuses a submit whose nonce does not match the cookie', async () => {
    const res = await POST(
      postReq({ token: RAW_TOKEN, nonce: 'wrong-nonce' }),
      { params: { requestId: REQUEST_ID } },
    )
    expect(res.status).toBe(403)
    expect(mocks.consumeRolloutAdvanceRequest).not.toHaveBeenCalled()
  })

  it('refuses a submit with no cookie at all (page left open too long / cookie blocked)', async () => {
    cookieState.store = new Map()
    const res = await POST(postReq({ token: RAW_TOKEN, nonce: 'n1' }), { params: { requestId: REQUEST_ID } })
    expect(res.status).toBe(403)
    expect(mocks.consumeRolloutAdvanceRequest).not.toHaveBeenCalled()
  })

  it('same-origin + matching nonce + valid token calls consumeRolloutAdvanceRequest and reports the new stage in plain language', async () => {
    mocks.consumeRolloutAdvanceRequest.mockResolvedValue({
      ok: true,
      requestId: REQUEST_ID,
      clientId: 'client-1',
      newStage: 1,
      eventId: 'evt-1',
    })

    const res = await POST(postReq({ token: RAW_TOKEN, nonce: 'n1' }), { params: { requestId: REQUEST_ID } })
    const html = await res.text()

    expect(mocks.consumeRolloutAdvanceRequest).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ requestId: REQUEST_ID, rawToken: RAW_TOKEN }),
    )
    expect(html).toContain('客户共测阶段')
    expect(html).not.toMatch(/stage\s*1/i)
  })

  it('a "superseded" outcome from consume is rendered with the distinct wording, not "already_used"', async () => {
    mocks.consumeRolloutAdvanceRequest.mockResolvedValue({ ok: false, problem: 'superseded' })
    const res = await POST(postReq({ token: RAW_TOKEN, nonce: 'n1' }), { params: { requestId: REQUEST_ID } })
    const html = await res.text()
    expect(html).toContain('暂停了这次切换')
  })

  it('the nonce cookie is burned on every POST outcome (success or refusal)', async () => {
    mocks.consumeRolloutAdvanceRequest.mockResolvedValue({ ok: false, problem: 'expired' })
    const res = await POST(postReq({ token: RAW_TOKEN, nonce: 'n1' }), { params: { requestId: REQUEST_ID } })
    const setCookie = res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('me-knowledge-rollout-confirm-nonce=;')
  })
})
