import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

// All three content routes must run guardContentGeneration before ANY downstream work.
const m = vi.hoisted(() => ({
  access: vi.fn(), brief: vi.fn(), campaign: vi.fn(), openai: vi.fn(),
  visualBrief: vi.fn(), audit: vi.fn(), transcript: vi.fn(), analyze: vi.fn(), rewrite: vi.fn(),
  fake: null as unknown, tables: [] as string[],
}))

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: m.access }))
vi.mock('@/lib/content/brief-injector', () => ({ getActiveBrief: m.brief, formatBriefForPrompt: () => 'B' }))
vi.mock('@/lib/content/campaign-injector', () => ({ getCampaignById: m.campaign, formatCampaignForPrompt: () => 'C' }))
vi.mock('@/lib/ai/openai-client', () => ({ getOpenAIClient: m.openai }))
vi.mock('@/lib/content/visual-brief-generator', () => ({ generateVisualBrief: m.visualBrief }))
vi.mock('@/lib/content/social-quality-audit', () => ({ auditSocialPost: m.audit }))
vi.mock('@/lib/supadata/client', () => ({ getVideoTranscript: m.transcript }))
vi.mock('@/lib/content/video-analyzer', () => ({ analyzeViralVideo: m.analyze }))
vi.mock('@/lib/content/route-b-rewriter', () => ({ rewriteForBrand: m.rewrite }))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      m.tables.push(table)
      if (table === 'execution_items' || table === 'production_packages') {
        return (m.fake as { from: (t: string) => unknown }).from(table)
      }
      const chain: Record<string, unknown> = {}
      for (const k of ['select', 'eq', 'order', 'limit', 'in', 'not', 'update']) chain[k] = () => chain
      chain.maybeSingle = chain.single = async () => ({ data: null, error: null })
      chain.insert = () => ({ select: async () => ({ data: [{ id: 'row-1' }, { id: 'row-2' }], error: null }) })
      return chain
    },
  },
}))

import { POST as POSTA } from '@/app/api/content/route-a/route'
import { POST as POSTB } from '@/app/api/content/route-b/route'
import { POST as POSTC } from '@/app/api/content/route-c/route'
import { createFakeTables } from '@/lib/content/__tests__/fake-tables'

const CLIENT_A = 'a0000000-0000-4000-8000-000000000001'
const CLIENT_B = 'b0000000-0000-4000-8000-000000000002'
const ITEM_A = 'e0000000-0000-4000-8000-0000000000a1'
const ITEM_B = 'e0000000-0000-4000-8000-0000000000b1'
const PKG_B = 'f0000000-0000-4000-8000-0000000000b1'
const SEED = {
  execution_items: [{ id: ITEM_A, client_id: CLIENT_A }, { id: ITEM_B, client_id: CLIENT_B }],
  production_packages: [{ id: PKG_B, client_id: CLIENT_B }],
}
const OUT = { title: 'T', script: 'S', caption: 'C', hashtags: ['h'], visual_brief: 'vb' }

const ROUTES = [
  { name: 'route-a', POST: POSTA, field: 'keyword', value: 'best coffee' },
  { name: 'route-b', POST: POSTB, field: 'video_url', value: 'https://example.test/v.mp4' },
  { name: 'route-c', POST: POSTC, field: 'topic', value: 'x' },
]

function expectNothingDownstream() {
  for (const fn of [m.brief, m.campaign, m.openai, m.visualBrief, m.audit, m.transcript, m.analyze, m.rewrite]) {
    expect(fn).not.toHaveBeenCalled()
  }
  for (const t of ['content_posts', 'production_items', 'keyword_snapshots']) expect(m.tables).not.toContain(t)
}

beforeEach(() => {
  m.fake = createFakeTables(SEED)
  m.tables = []
  m.access.mockResolvedValue({ ok: true })
  m.brief.mockResolvedValue({ id: 'brief-1', brand_name: 'Brand' })
  m.campaign.mockResolvedValue(null)
  m.openai.mockReturnValue({ chat: { completions: { create: async () => ({ choices: [{ message: { content: JSON.stringify(OUT) } }] }) } } })
  m.visualBrief.mockResolvedValue('vb')
  m.audit.mockResolvedValue(null)
  m.transcript.mockResolvedValue({ transcript: 'x'.repeat(100), metadata: { platform: 'tiktok', title: 't' } })
  m.analyze.mockResolvedValue({})
  m.rewrite.mockResolvedValue(OUT)
})

afterEach(() => vi.clearAllMocks())

describe.each(ROUTES)('POST /api/content/$name', ({ name, POST, field, value }) => {
  const post = (body: Record<string, unknown>) =>
    new NextRequest(`http://localhost/api/content/${name}`, {
      method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
    })
  const valid = (extra: Record<string, unknown> = {}) => ({ client_id: CLIENT_A, [field]: value, platforms: ['facebook'], ...extra })

  it.each([[401, 'unauthorized'], [403, 'forbidden'], [403, 'paid_only'], [500, 'lookup_failed']])(
    'auth denial %i %s passes through before any downstream work', async (status, reason) => {
      m.access.mockResolvedValue({ ok: false, status, error: 'denied', reason })
      expect((await POST(post(valid()))).status).toBe(status)
      expectNothingDownstream()
    })

  it('authorises the client named in the request, not a fixed one', async () => {
    await POST(post({ ...valid(), client_id: CLIENT_B }))
    expect(m.access).toHaveBeenCalledTimes(1)
    expect(m.access).toHaveBeenCalledWith(CLIENT_B)
  })

  it('returns 400 for a missing required field without authenticating', async () => {
    const body: Record<string, unknown> = valid()
    delete body[field]
    expect((await POST(post(body))).status).toBe(400)
    expect(m.access).not.toHaveBeenCalled()
  })

  const rejected: Array<[string, Record<string, unknown>, number, string]> = [
    ['another client item', { execution_item_id: ITEM_B }, 403, 'Forbidden'],
    ['invalid item id', { execution_item_id: 'not-a-uuid' }, 400, 'execution_item_id'],
  ]
  if (name !== 'route-b') rejected.push(['another client package', { production_package_id: PKG_B }, 403, 'Forbidden'])

  it.each(rejected)('rejects %s before downstream work', async (_label, extra, status, text) => {
    const res = await POST(post(valid(extra)))
    expect(res.status).toBe(status)
    expect(((await res.json()) as { error: string }).error).toContain(text)
    expectNothingDownstream()
  })

  it('succeeds for an owned item and authenticates before loading the brief', async () => {
    const res = await POST(post(valid({ execution_item_id: ITEM_A })))
    expect(res.status).toBe(200)
    expect(((await res.json()) as { success: boolean }).success).toBe(true)
    expect(m.access.mock.invocationCallOrder[0]).toBeLessThan(m.brief.mock.invocationCallOrder[0])
  })
})
