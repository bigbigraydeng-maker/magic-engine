import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { AGENT_ADS_DENY_TOOL, AGENT_ADS_DRAFT_TOOL, AGENT_ADS_SCOPE, AGENT_ADS_SEED_TOOL } from '@/lib/auth/agent-ads-scope'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))

const h = vi.hoisted(() => ({
  read: vi.fn(),
  insertPlan: vi.fn(async (_row: unknown) => 'plan-new'),
  events: [] as string[],
}))

vi.mock('@/lib/ads-strategy/plan-seed/read-for-client', () => ({
  readPlanSeedForClient: (...args: unknown[]) => h.read(...args),
}))

vi.mock('@/lib/marketing-plan/agent-draft-store', () => ({
  productionAgentDraftDeps: () => ({
    now: () => new Date('2026-10-27T00:00:00.000Z'),
    readSeed: h.read,
    loadGoal: async () => ({
      status: 'active',
      target_value: null,
      baseline_value: null,
      period_start: '2026-11-01',
      period_end: '2026-11-14',
      current_value: null,
      current_value_fetched_at: null,
    }),
    loadBudget: async () => ({
      accounts: [{ ad_account_id: 'act_1', currency: 'AUD', daily_cap_cents: 10000, owned_by_client: true }],
      clientCapCents: 20000,
    }),
    loadPlan: async () => null,
    insertPlan: (row: unknown) => {
      h.events.push('write')
      return h.insertPlan(row)
    },
    updatePlan: async () => true,
  }),
}))

import { supabaseAdmin } from '@/lib/supabase'
import { GET as readSeed } from '@/app/api/agent/ads/clients/[id]/prescriptions/[pId]/plan-seed/route'
import { PUT as saveDraft } from '@/app/api/agent/ads/clients/[id]/plan-drafts/route'

const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const RX = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const KEY = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const RAW = 'me_live_fixturekey'
const from = vi.mocked(supabaseAdmin.from)

const inserts: Record<string, unknown>[] = []
const updates: Record<string, unknown>[] = []

function install(opts: { count?: number; countError?: boolean; insertError?: boolean; finishError?: boolean } = {}) {
  inserts.length = 0
  updates.length = 0
  h.events = []
  from.mockImplementation((table: string) => {
    if (table === 'mcp_access_log') {
      return {
        insert: (row: Record<string, unknown>) => {
          inserts.push(row)
          h.events.push('audit')
          return Promise.resolve({ error: opts.insertError ? { message: 'down' } : null })
        },
        select: () => ({
          eq: () => ({
            gte: async () => ({ count: opts.count ?? 0, error: opts.countError ? { message: 'down' } : null }),
          }),
        }),
        update: (patch: Record<string, unknown>) => ({
          eq: (_col: string, id: string) => ({
            select: async () => {
              updates.push(patch)
              return { data: opts.finishError ? [] : [{ id }], error: opts.finishError ? { message: 'down' } : null }
            },
          }),
        }),
      } as unknown as ReturnType<typeof supabaseAdmin.from>
    }
    return {
      select: () => ({
        eq: () => ({
          is: () => ({
            maybeSingle: async () => ({
              data: {
                id: KEY,
                client_id: CLIENT,
                scopes: [AGENT_ADS_SCOPE],
                expires_at: '2099-01-01T00:00:00.000Z',
              },
              error: null,
            }),
          }),
        }),
      }),
      update: () => ({ eq: async () => ({ error: null }) }),
    } as unknown as ReturnType<typeof supabaseAdmin.from>
  })
}

function bearer(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers: { authorization: `Bearer ${RAW}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function suggestion(cents: number) {
  const basis = [{ label: 'label', value: 'value', source: 'source', as_of: null }]
  const text = (value: string) => ({ ok: true, value, basis, notes: [] })
  return {
    schema_version: 1,
    produced_by: 'ads-agent',
    facts_as_of: '2026-10-27T00:00:00.000Z',
    currency: 'AUD',
    period: null,
    captured_at: {},
    ad_steps: [{
      step_key: 's1',
      play: 'thruplay_pool_build',
      page_id: text('page'),
      ad_account_id: text('act_1'),
      daily_budget_cents: { ok: true, value: cents, basis, notes: [] },
    }],
    skipped: [],
    notes: [],
  }
}

const promo = {
  schema: 'promo_v1',
  goal_id: 'goal-1',
  phases: [{
    id: 'p1',
    name: '阶段',
    start_date: '2026-11-01',
    end_date: '2026-11-14',
    steps: [{
      id: 's1',
      kind: 'ads_campaign',
      settings: {
        ad_account_id: 'act_1',
        daily_budget_cents: 5000,
        audience_ref: 'aud',
        creative_refs: [],
        placements: [],
        paused_ranges: [],
      },
    }],
  }],
}

beforeEach(() => {
  vi.clearAllMocks()
  install()
  h.read.mockImplementation(async () => {
    h.events.push('read')
    return { status: 200, body: { success: true, seed: null, reason: '这份处方没有填广告打法（ad_plays）' } }
  })
})

describe('agent plan-seed route', () => {
  it('writes the audit row before the read, including a failed read', async () => {
    const ok = await readSeed(bearer('http://localhost/seed', 'GET'), { params: { id: CLIENT, pId: RX } })
    expect(ok.status).toBe(200)
    expect(h.events).toEqual(['audit', 'read'])
    expect(inserts[0]).toMatchObject({ tool: AGENT_ADS_SEED_TOOL, ok: false, error_code: 'in_progress', client_key_id: KEY })
    expect(updates[0]).toEqual({ ok: true, error_code: null })
    expect(JSON.stringify(inserts[0])).not.toContain(RAW)

    install()
    h.read.mockResolvedValue({ status: 404, body: { success: false, error: '处方不存在' } })
    const missing = await readSeed(bearer('http://localhost/seed', 'GET'), { params: { id: CLIENT, pId: RX } })
    expect(missing.status).toBe(404)
    expect(updates[0]).toEqual({ ok: false, error_code: 'prescription_missing' })
  })

  it('returns 503 and does not read when the audit row cannot be written', async () => {
    install({ insertError: true })
    const res = await readSeed(bearer('http://localhost/seed', 'GET'), { params: { id: CLIENT, pId: RX } })
    expect(res.status).toBe(503)
    expect(h.read).not.toHaveBeenCalled()
  })

  it('rate limits before the read and still leaves a row', async () => {
    install({ count: 30 })
    const res = await readSeed(bearer('http://localhost/seed', 'GET'), { params: { id: CLIENT, pId: RX } })
    expect(res.status).toBe(429)
    expect((await res.json()).code).toBe('rate_limited')
    expect(inserts[0]).toMatchObject({ tool: AGENT_ADS_SEED_TOOL, error_code: 'rate_limited', ok: false })
    expect(h.read).not.toHaveBeenCalled()
  })
})

describe('agent plan-draft route', () => {
  it('rejects an approval field, writes the failure, and does not save', async () => {
    const res = await saveDraft(
      bearer('http://localhost/draft', 'PUT', { status: 'approved', prescription_id: RX, title: '草稿', promo }),
      { params: { id: CLIENT } },
    )
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('forbidden_field')
    expect(h.insertPlan).not.toHaveBeenCalled()
    expect(inserts[0]).toMatchObject({ tool: AGENT_ADS_DRAFT_TOOL, error_code: 'in_progress' })
    expect(updates[0]).toEqual({ ok: false, error_code: 'forbidden_field' })
  })

  it('writes the audit row before saving an unapproved draft', async () => {
    h.read.mockImplementation(async () => {
      h.events.push('read')
      return { status: 200, body: { success: true, seed: suggestion(5000) } }
    })
    const res = await saveDraft(
      bearer('http://localhost/draft', 'PUT', { prescription_id: RX, title: '草稿', promo }),
      { params: { id: CLIENT } },
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true, plan_id: 'plan-new', status: 'draft' })
    expect(h.events[0]).toBe('audit')
    expect(h.events.indexOf('audit')).toBeLessThan(h.events.indexOf('write'))
    const row = h.insertPlan.mock.calls[0]?.[0] as {
      status: string
      approved_at: null
      generation_meta: { agent_draft: { key_id: string } }
    }
    expect(row.status).toBe('draft')
    expect(row.approved_at).toBeNull()
    expect(row.generation_meta.agent_draft.key_id).toBe(KEY)
    expect(updates[0]).toEqual({ ok: true, error_code: null })
    expect(JSON.stringify(inserts[0])).not.toContain(RAW)
  })

  it('returns 403 and a denial row for another client', async () => {
    const res = await readSeed(bearer('http://localhost/seed', 'GET'), { params: { id: OTHER, pId: RX } })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('client_mismatch')
    expect(inserts[0]).toMatchObject({ tool: AGENT_ADS_DENY_TOOL, ok: false, error_code: 'client_mismatch' })
    expect(h.read).not.toHaveBeenCalled()
  })
})
