// @vitest-environment node
import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth/client-access', () => ({ requirePaidClientAccess: vi.fn() }))
vi.mock('@/lib/auth/require-admin', () => ({ requireGlobalAdmin: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn(), storage: { from: vi.fn() } } }))
vi.mock('@/lib/email/sender', () => ({ ME_MAIL_TO_ADDRESS: 'test@example.test' }))

import { GET as readAsset, POST as upload } from '@/app/api/clients/[id]/assets/video/route'
import { GET as readHandoffs, POST as attach } from '@/app/api/clients/[id]/campaign-daily-plan/video-handoff/route'
import { POST as candidate } from '@/app/api/clients/[id]/ad-strategy-config/creative-pool/video/route'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { supabaseAdmin } from '@/lib/supabase'
import { parseCreativePool } from '@/lib/ads-strategy/config'

type Row = Record<string, unknown>
const CLIENT = '11111111-1111-4111-8111-111111111111'
const CAMPAIGN = '22222222-2222-4222-8222-222222222222'
const PLAN = '33333333-3333-4333-8333-333333333333'
const ASSET = '44444444-4444-4444-8444-444444444444'
const REV = '2026-10-12T00:00:00.000Z'
const DATE = '2026-10-13'
const ctx = { params: { id: CLIENT } }
const tables: Record<string, Row[]> = {}
const writes: Array<{ table: string; patch: Row }> = []
const bytes = readFileSync(new URL('./fixtures/handoff.mp4', import.meta.url))
let conflictTable = ''
const storageUpload = vi.fn()
const storageRemove = vi.fn()

class Query {
  filters: Array<(row: Row) => boolean> = []
  patch: Row | null = null
  insertion: Row | null = null
  max = Infinity
  ordering: { field: string; ascending: boolean } | null = null
  constructor(readonly table: string) {}
  select() { return this }
  eq(field: string, value: unknown) {
    this.filters.push(row => typeof row[field] === 'object' && typeof value === 'string'
      ? JSON.stringify(row[field]) === value : row[field] === value)
    return this
  }
  is(field: string, value: unknown) { this.filters.push(row => (row[field] ?? null) === value); return this }
  contains(field: string, value: Row) {
    this.filters.push(row => Object.entries(value).every(([key, item]) => (row[field] as Row)?.[key] === item))
    return this
  }
  order(field: string, options: { ascending?: boolean } = {}) { this.ordering = { field, ascending: options.ascending !== false }; return this }
  limit(n: number) { this.max = n; return this }
  update(patch: Row) {
    this.patch = patch
    if (conflictTable === this.table) {
      for (const row of tables[this.table]) {
        if (this.table === 'client_assets') row.vision_metadata = { changed_concurrently: true }
        if (this.table === 'ad_strategy_configs') row.creative_pool = [{ kind: 'meta_video', ref: 'concurrent', status: 'approved' }]
      }
    }
    return this
  }
  insert(row: Row) { this.insertion = row; return this }
  execute() {
    let data = (tables[this.table] ?? []).filter(row => this.filters.every(filter => filter(row)))
    if (this.ordering) {
      const { field, ascending } = this.ordering
      data.sort((a, b) => String(a[field] ?? '').localeCompare(String(b[field] ?? '')) * (ascending ? 1 : -1))
    }
    data = data.slice(0, this.max)
    if (this.patch) {
      for (const row of data) Object.assign(row, structuredClone(this.patch))
      writes.push({ table: this.table, patch: this.patch })
    }
    if (this.insertion) {
      const row: Row = { id: ASSET, archived_at: null, ...structuredClone(this.insertion) }
      if (this.table === 'ad_strategy_configs' && tables[this.table].some(r => r.client_id === row.client_id)) {
        return { data: null, error: { code: '23505' } }
      }
      tables[this.table].push(row); data = [row]
      writes.push({ table: this.table, patch: this.insertion })
    }
    return { data: structuredClone(data), error: null }
  }
  async maybeSingle() { const result = this.execute(); return { ...result, data: result.data?.[0] ?? null } }
  single() { return this.maybeSingle() }
  then(resolve: (result: ReturnType<Query['execute']>) => unknown) { return Promise.resolve(this.execute()).then(resolve) }
}

function jsonRequest(body: unknown) {
  return new NextRequest('https://local.test/api', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
}
function command(extra: Row = {}) {
  return { campaign_id: CAMPAIGN, plan_id: PLAN, expected_plan_revision: REV, date: DATE,
    asset_id: ASSET, platform: 'facebook_reels', title: 'Best Of China — 11 March 2027',
    caption: 'Ask our Auckland team about Best Of China.', ...extra }
}
function seedVideo(extra: Row = {}) {
  tables.client_assets.push({ id: ASSET, client_id: CLIENT, storage_url: 'https://storage.test/video.mp4',
    original_filename: 'handoff.mp4', mime_type: 'video/mp4', status: 'analyzed', archived_at: null,
    vision_metadata: { kind: 'video', rights_review: 'pending' }, ...extra })
}
async function uploadRequest(content: Uint8Array = bytes, type = 'video/mp4') {
  const form = new FormData()
  form.set('file', new Blob([new Uint8Array(content)], { type }), 'handoff.mp4')
  return upload(new NextRequest('https://local.test/api', { method: 'POST', body: form }), ctx)
}
const readRequest = () => new NextRequest(`https://local.test/api?campaign_id=${CAMPAIGN}`)

beforeEach(() => {
  vi.clearAllMocks(); conflictTable = ''; writes.length = 0
  tables.client_assets = []; tables.ad_strategy_configs = []
  tables.social_plans = [{ id: PLAN, client_id: CLIENT, campaign_id: CAMPAIGN, plan_data: {
    plan_kind: 'campaign_daily_v1', campaign_id: CAMPAIGN, command_meta: { received_at: REV },
    days: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${13 + i}`, slots: { post: 'PLANNED', story: 'PLANNED', reel: 'PLANNED' } })),
    bundles: Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${13 + i}`, post: { body: `Approved original post ${i}` }, story: { frames: [] }, reel: { script: `Existing script ${i}` } })),
    review_meta: { revision: 'original-review', posts: { [DATE]: { verdict: 'PASS' } } },
  } }]
  vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: true, user: { id: 'staff' } } as never)
  vi.mocked(requireGlobalAdmin).mockResolvedValue({ ok: true, user: { email: 'staff@example.test' } } as never)
  vi.mocked(supabaseAdmin.from).mockImplementation(((table: string) => new Query(table)) as never)
  storageUpload.mockResolvedValue({ error: null }); storageRemove.mockResolvedValue({ error: null })
  vi.mocked(supabaseAdmin.storage.from).mockReturnValue({ upload: storageUpload, remove: storageRemove,
    getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage.test/${path}` } }),
  } as never)
})

describe('finished-video handoff: real multipart file and in-memory database boundary', () => {
  it('uploads MP4 → reads it → attaches to Daily Plan → reads preview → adds one ad candidate, preserving existing approval', async () => {
    const originalPlan = structuredClone(tables.social_plans)
    const old = { kind: 'meta_video', ref: 'meta-9', status: 'approved', approved_by: 'reviewer', approved_at: REV }
    tables.ad_strategy_configs = [{ client_id: CLIENT, creative_pool: [old], daily_budget_cap_cents: 9900 }]
    const uploaded = await uploadRequest()
    expect(uploaded.status).toBe(201)
    expect(storageUpload.mock.calls[0][1]).toEqual(new Uint8Array(bytes))
    const asset = await readAsset(new NextRequest(`https://local.test/api?asset_id=${ASSET}`), ctx)
    expect(asset.status).toBe(200)
    expect((await attach(jsonRequest(command()), ctx)).status).toBe(200)
    const projection = await readHandoffs(readRequest(), ctx)
    const { videos } = await projection.json()
    expect(videos).toHaveLength(1)
    expect(videos[0]).toMatchObject({ asset_id: ASSET, platform: 'facebook_reels', title: command().title, approval: 'NOT_REVIEWED' })
    expect(videos[0].preview_url).toBe((await asset.json()).asset.storage_url)
    expect((await candidate(jsonRequest(command()), ctx)).status).toBe(201)
    expect((await candidate(jsonRequest(command()), ctx)).status).toBe(200)
    expect(tables.ad_strategy_configs[0].creative_pool).toEqual([old, expect.objectContaining({ kind: 'client_video', status: 'candidate', ref: ASSET })])
    expect(tables.ad_strategy_configs[0].daily_budget_cap_cents).toBe(9900)
    expect(tables.social_plans).toEqual(originalPlan)
    expect(writes.some(write => write.table === 'social_plans')).toBe(false)
  })

  it.each(['youtube', 'tiktok', 'facebook_reels'])('preserves platform identity for %s', async platform => {
    seedVideo(); expect((await attach(jsonRequest(command({ platform })), ctx)).status).toBe(200)
    expect((await (await readHandoffs(readRequest(), ctx)).json()).videos[0].platform).toBe(platform)
  })

  it('repeated association creates one preview and preserves metadata', async () => {
    seedVideo(); await attach(jsonRequest(command()), ctx); await attach(jsonRequest(command()), ctx)
    expect((await (await readHandoffs(readRequest(), ctx)).json()).videos).toHaveLength(1)
    expect(tables.client_assets[0].vision_metadata).toMatchObject({ rights_review: 'pending' })
  })

  it('blocks anonymous requests before reads or uploads', async () => {
    vi.mocked(requirePaidClientAccess).mockResolvedValue({ ok: false, status: 401, error: 'Unauthorised' } as never)
    expect((await uploadRequest()).status).toBe(401)
    expect((await attach(jsonRequest(command()), ctx)).status).toBe(401)
    expect((await candidate(jsonRequest(command()), ctx)).status).toBe(401)
    expect(supabaseAdmin.from).not.toHaveBeenCalled(); expect(storageUpload).not.toHaveBeenCalled()
  })

  it('blocks non-staff writes', async () => {
    vi.mocked(requireGlobalAdmin).mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' } as never)
    expect((await uploadRequest()).status).toBe(403)
    expect((await attach(jsonRequest(command()), ctx)).status).toBe(403)
    expect((await candidate(jsonRequest(command()), ctx)).status).toBe(403)
    expect(writes).toHaveLength(0)
  })

  it.each([{ client_id: 'another-client' }, { archived_at: REV }, { mime_type: 'image/png' },
    { status: 'pending' }, { storage_url: 'javascript:alert(1)' }])('rejects unusable/cross-client videos: %j', async extra => {
    seedVideo(extra)
    expect((await attach(jsonRequest(command()), ctx)).status).toBe(404)
    expect((await readAsset(new NextRequest(`https://local.test/api?asset_id=${ASSET}`), ctx)).status).toBe(404)
    expect(writes).toHaveLength(0)
  })

  it('rejects superseded plan, old revision and absent date', async () => {
    seedVideo()
    expect((await attach(jsonRequest(command({ expected_plan_revision: '2026-10-11T00:00:00.000Z' })), ctx)).status).toBe(409)
    expect((await attach(jsonRequest(command({ plan_id: CAMPAIGN })), ctx)).status).toBe(409)
    expect((await attach(jsonRequest(command({ date: '2026-10-20' })), ctx)).status).toBe(400)
    expect(writes).toHaveLength(0)
  })

  it('rejects the old plan when a newer plan supersedes it', async () => {
    seedVideo()
    tables.social_plans[0].created_at = '2026-10-11T00:00:00.000Z'
    tables.social_plans.push({ ...structuredClone(tables.social_plans[0]), id: CAMPAIGN, created_at: REV })
    expect((await attach(jsonRequest(command()), ctx)).status).toBe(409)
    expect(writes).toHaveLength(0)
  })

  it('never displays a stale plan revision or archived output as a current video', async () => {
    seedVideo(); await attach(jsonRequest(command()), ctx)
    ;(tables.social_plans[0].plan_data as Row).command_meta = { received_at: '2026-10-12T01:00:00.000Z' }
    expect((await (await readHandoffs(readRequest(), ctx)).json()).videos).toEqual([])
    ;(tables.social_plans[0].plan_data as Row).command_meta = { received_at: REV }
    tables.client_assets[0].archived_at = REV
    expect((await (await readHandoffs(readRequest(), ctx)).json()).videos).toEqual([])
  })

  it('rejects self-approval, arbitrary URL and invalid identity fields', async () => {
    for (const extra of [{ status: 'approved' }, { preview_url: 'https://other.test/video.mp4' }, { asset_id: 'not-an-id' }]) {
      expect((await attach(jsonRequest(command(extra)), ctx)).status).toBe(400)
      expect((await candidate(jsonRequest(command(extra)), ctx)).status).toBe(400)
    }
    expect(writes).toHaveLength(0)
  })

  it('requires a matching Daily Plan association before advertising nomination', async () => {
    seedVideo(); expect((await candidate(jsonRequest(command()), ctx)).status).toBe(409)
    expect(tables.ad_strategy_configs).toEqual([])
  })

  it('reports asset and pool compare-and-set conflicts without losing existing data', async () => {
    seedVideo(); conflictTable = 'client_assets'
    expect((await attach(jsonRequest(command()), ctx)).status).toBe(409)
    conflictTable = ''; await attach(jsonRequest(command()), ctx)
    tables.ad_strategy_configs = [{ client_id: CLIENT, creative_pool: [] }]
    conflictTable = 'ad_strategy_configs'
    expect((await candidate(jsonRequest(command()), ctx)).status).toBe(409)
    expect(tables.ad_strategy_configs[0].creative_pool).toEqual([{ kind: 'meta_video', ref: 'concurrent', status: 'approved' }])
  })

  it('creates only a non-executable candidate with observe settings when no ad config exists', async () => {
    seedVideo(); await attach(jsonRequest(command()), ctx)
    expect((await candidate(jsonRequest(command()), ctx)).status).toBe(201)
    expect(tables.ad_strategy_configs[0]).toMatchObject({ autonomy_mode: 'observe', autopilot_enabled: false, autopilot_dry_run: true })
    expect(parseCreativePool([{ kind: 'client_video', ref: ASSET, status: 'approved' }])).toEqual([])
  })

  it('rejects wrong MIME and a forged MP4 before storage writes', async () => {
    expect((await uploadRequest(bytes, 'image/png')).status).toBe(400)
    expect((await uploadRequest(new Uint8Array(32))).status).toBe(400)
    expect(storageUpload).not.toHaveBeenCalled()
  })
})
