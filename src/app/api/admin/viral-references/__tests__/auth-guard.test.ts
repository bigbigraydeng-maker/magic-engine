/**
 * Every route under /api/admin/viral-references must fail closed: no session → 401,
 * signed-in non-admin → 403, admin → handler runs. The fake db models the one table the routes touch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  email: null as string | null,
  rows: [] as Array<Record<string, unknown>>,
  inserts: [] as Array<Record<string, unknown>>,
  analyze: vi.fn(),
}))

vi.mock('@/lib/auth/require-session', () => ({
  requireSession: async () =>
    h.email ? { ok: true, user: { id: 'u', email: h.email } } : { ok: false, status: 401, error: 'Unauthorized' },
}))
vi.mock('@/lib/reels/viral-analyzer', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/reels/viral-analyzer')>()
  return { ...actual, analyzeViralReference: h.analyze, analyzeUploadedReference: vi.fn().mockResolvedValue(undefined) }
})
vi.mock('@/lib/supabase', () => {
  const chain = (op: string, payload?: unknown): unknown => {
    const result = () => {
      if (op === 'insert') {
        const list = Array.isArray(payload) ? payload : [payload]
        const added = list.map((r, i) => ({ id: `id-${h.rows.length + i}`, ...(r as object) }))
        h.inserts.push(...(list as Array<Record<string, unknown>>))
        h.rows.push(...added)
        return { data: added, error: null }
      }
      return { data: h.rows, error: null, count: h.rows.length }
    }
    const proxy: unknown = new Proxy(() => undefined, {
      get: (_t, prop) => {
        if (prop === 'then') return (res: (v: unknown) => unknown) => Promise.resolve(result()).then(res)
        if (prop === 'maybeSingle' || prop === 'single')
          return () => Promise.resolve({ data: h.rows[0] ?? null, error: null })
        return () => proxy
      },
    })
    return proxy
  }
  return {
    supabaseAdmin: {
      from: (table: string) => {
        if (table !== 'viral_reference_library') throw new Error(`unexpected table ${table}`)
        return {
          select: () => chain('select'),
          insert: (p: unknown) => chain('insert', p),
          update: () => chain('update'),
        }
      },
    },
  }
})

import { GET as listGET, POST as listPOST } from '../route'
import { POST as discoverPOST } from '../discover/route'
import { POST as pendingPOST } from '../analyze-pending/route'
import { POST as retryPOST } from '../[id]/retry/route'
import { POST as uploadPOST } from '../upload/route'

const ENV = ['ADMIN_EMAILS', 'ADMIN_EMAIL_DOMAIN', 'DEMO_ADMINS', 'CLIENT_VIEWERS'] as const
const saved: Record<string, string | undefined> = {}

const json = (body: unknown) =>
  new NextRequest('http://localhost/api/admin/viral-references', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })

const ROUTES: Array<[string, () => Promise<Response>]> = [
  ['GET /', () => listGET(new NextRequest('http://localhost/api/admin/viral-references'))],
  ['POST /', () => listPOST(json({ videos: [] }))],
  ['POST /discover', () => discoverPOST(json({}))],
  ['POST /analyze-pending', () => pendingPOST()],
  ['POST /[id]/retry', () => retryPOST(json({}), { params: { id: 'x' } })],
  ['POST /upload', () => uploadPOST(new NextRequest('http://localhost/x', { method: 'POST', body: new FormData() }))],
]

beforeEach(() => {
  for (const k of ENV) { saved[k] = process.env[k]; delete process.env[k] }
  process.env.ADMIN_EMAILS = 'fde@magiclab.test'
  process.env.DEMO_ADMINS = 'demo@x.test:aaaaaaaa-0000-0000-0000-000000000001'
  h.email = null; h.rows = []; h.inserts = []; h.analyze.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  for (const k of ENV) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] }
})

describe.each(ROUTES)('%s', (_name, call) => {
  it('no session → 401 and no side effects', async () => {
    h.email = null
    expect((await call()).status).toBe(401)
    expect(h.inserts).toHaveLength(0)
    expect(h.analyze).not.toHaveBeenCalled()
  })
  it('signed-in non-admin → 403 and no side effects', async () => {
    h.email = 'stranger@customer.test'
    expect((await call()).status).toBe(403)
    expect(h.inserts).toHaveLength(0)
    expect(h.analyze).not.toHaveBeenCalled()
  })
  it('client-scoped demo admin → 403 (platform-wide library, global admins only)', async () => {
    h.email = 'demo@x.test'
    expect((await call()).status).toBe(403)
    expect(h.inserts).toHaveLength(0)
  })
  it('admin → handler runs (not 401/403)', async () => {
    h.email = 'fde@magiclab.test'
    const res = await call()
    expect([401, 403]).not.toContain(res.status)
  })
})

describe('POST / url validation', () => {
  const video = (url: string) => ({ url, industry: 'travel' })
  beforeEach(() => { h.email = 'fde@magiclab.test' })

  it.each([
    'https://example.com/v"; touch /tmp/x #',
    'https://example.com/$(id)',
    'https://example.com/`id`',
    'https://example.com/v\nid',
    'http://169.254.169.254/latest/',
    'file:///etc/passwd',
  ])('rejects %j: 400, nothing inserted, nothing analysed', async url => {
    const res = await listPOST(json({ videos: [video('https://www.youtube.com/watch?v=abc'), video(url)] }))
    expect(res.status).toBe(400)
    expect(h.inserts).toHaveLength(0)
    expect(h.analyze).not.toHaveBeenCalled()
  })

  it('accepts a legitimate batch, stores the normalised url and queues analysis', async () => {
    const res = await listPOST(json({ videos: [video('https://www.facebook.com/reel/123')] }))
    expect(res.status).toBe(200)
    expect(h.inserts[0].source_url).toBe('https://www.facebook.com/reel/123')
    expect(h.analyze).toHaveBeenCalledTimes(1)
  })

  it('skips XiaoHongShu links the downloader cannot fetch', async () => {
    const res = await listPOST(json({ videos: [
      video('https://www.xiaohongshu.com/explore/abc'),
      video('https://xhslink.com/a/abc'),
      video('https://www.youtube.com/watch?v=abc'),
    ] }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.skipped_unsupported).toBe(2)
    expect(body.queued).toBe(1)
    expect(h.inserts).toHaveLength(1)
    expect(h.inserts[0].source_url).toBe('https://www.youtube.com/watch?v=abc')
    expect(h.analyze).toHaveBeenCalledTimes(1)
  })
})
