import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { tag: 'admin-db' } }))
vi.mock('@/lib/messaging/letters/load', () => ({ loadAutoLettersList: vi.fn(), loadAutoLetterDetail: vi.fn() }))

import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { loadAutoLetterDetail, loadAutoLettersList } from '@/lib/messaging/letters/load'
import { buildLetterKey } from '@/lib/messaging/letters/keys'
import { GET } from './route'
import { GET as GET_DETAIL } from './[letterKey]/route'

const request = new NextRequest('http://x/api')
const LIST_CTX = { params: { id: 'client-a' } }
const KEY = buildLetterKey({ sendDate: '2026-12-02', tourId: 'tour-1', departOn: '2027-03-11', monthsLeft: 3 }) as string
const detailCtx = (letterKey: string) => ({ params: { id: 'client-a', letterKey } })

const EMPTY_LIST = {
  generatedAt: 'now',
  nextBatch: null,
  depositLetters: [],
  scheduledLetters: [],
  pastLetters: [],
  tourGroups: [],
  totalDistinctLetters: 0,
  cadence: null,
}
const DETAIL = { letter: { letterKey: KEY }, tiles: {}, mailchimpSummary: null, recipients: [] }

beforeEach(() => {
  vi.resetAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: true, role: 'client', tier: 'paid_client', allowedClientId: null, user: { email: 'a@b.c' } } as never)
})

describe.each([
  ['list', () => GET(request, LIST_CTX), loadAutoLettersList],
  ['detail', () => GET_DETAIL(request, detailCtx(KEY)), loadAutoLetterDetail],
] as const)('access check (%s)', (_name, call, loader) => {
  it('checks the access for this client before reading anything', async () => {
    vi.mocked(loader).mockResolvedValue(EMPTY_LIST as never)
    await call()
    expect(requirePaidClientAccess).toHaveBeenCalledWith('client-a')
  })

  it.each([
    [401, 401, '请先登录。'],
    [402, 403, '你的账号没有查看这一页的权限。'],
    [403, 403, '你的账号没有查看这一页的权限。'],
    [500, 503, '自动发信的情况暂时读不到，请稍后再试；如果一直这样，请告诉 Magic Lab 团队。'],
  ])('access failure %i → %i with a plain Chinese message, and nothing is read', async (from, to, text) => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: false, status: from, error: 'This feature requires a paid plan.', reason: 'paid_only' } as never)
    const res = await call()
    expect(res.status).toBe(to)
    expect(await res.json()).toEqual({ error: text })
    expect(loader).not.toHaveBeenCalled()
  })

  it('a read failure is 暂时读不到 (503); the real error stays in the server log only', async () => {
    vi.mocked(loader).mockRejectedValue(new Error('relation "secret_table" does not exist'))
    const res = await call()
    expect(res.status).toBe(503)
    const body = JSON.stringify(await res.json())
    expect(body).toContain('暂时读不到')
    expect(body).not.toContain('secret_table')
    expect(console.error).toHaveBeenCalled()
  })
})

describe('GET auto-letters (list)', () => {
  it('returns what the loader built, for this client, using the server database', async () => {
    vi.mocked(loadAutoLettersList).mockResolvedValue(EMPTY_LIST as never)
    const res = await GET(request, LIST_CTX)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(EMPTY_LIST)
    expect(loadAutoLettersList).toHaveBeenCalledWith({ tag: 'admin-db' }, 'client-a')
  })
})

describe('GET auto-letters/[letterKey] (detail)', () => {
  it('returns the letter detail for a valid key', async () => {
    vi.mocked(loadAutoLetterDetail).mockResolvedValue(DETAIL as never)
    const res = await GET_DETAIL(request, detailCtx(KEY))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(DETAIL)
    expect(loadAutoLetterDetail).toHaveBeenCalledWith({ tag: 'admin-db' }, 'client-a', KEY)
  })

  it('accepts the key whether or not the framework already decoded it', async () => {
    vi.mocked(loadAutoLetterDetail).mockResolvedValue(DETAIL as never)
    const odd = buildLetterKey({ sendDate: '2026-12-02', tourId: 'a:b c/d', departOn: '2027-03-11', monthsLeft: 'weekly' }) as string
    for (const key of [KEY, odd]) {
      vi.mocked(loadAutoLetterDetail).mockClear()
      expect((await GET_DETAIL(request, detailCtx(key))).status).toBe(200) // decoded once by the framework
      expect(loadAutoLetterDetail).toHaveBeenLastCalledWith({ tag: 'admin-db' }, 'client-a', key)
      vi.mocked(loadAutoLetterDetail).mockClear()
      expect((await GET_DETAIL(request, detailCtx(encodeURIComponent(key)))).status).toBe(200) // still encoded
      expect(loadAutoLetterDetail).toHaveBeenLastCalledWith({ tag: 'admin-db' }, 'client-a', key)
    }
  })

  it.each(['garbage', '', 'plan:2026-02-30:t:2027-03-11:3', 'me:countdown_20270106_A_2', '%E0%A4%A'])(
    'a key it does not recognise (%j) is 404 and nothing is read',
    async (bad) => {
      const res = await GET_DETAIL(request, detailCtx(bad))
      expect(res.status).toBe(404)
      expect(await res.json()).toEqual({ error: '没有找到这封信。' })
      expect(loadAutoLetterDetail).not.toHaveBeenCalled()
    },
  )

  it('a well-formed key that is not in the plan is 404', async () => {
    vi.mocked(loadAutoLetterDetail).mockResolvedValue(null)
    const res = await GET_DETAIL(request, detailCtx(KEY))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: '没有找到这封信。' })
  })
})
