import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  LAUNCH_ACCOUNT_UNREAD,
  LAUNCH_BUDGET_UNREAD,
  LAUNCH_DRAFT_UNREAD,
  LAUNCH_MANY_PLANS,
  LAUNCH_NO_ACCOUNT,
  LAUNCH_NO_CAP,
  LAUNCH_NO_PLAN,
  LAUNCH_OVER,
  LAUNCH_PARENT_OFF,
  LAUNCH_PLAN_UNREAD,
  LAUNCH_SNAP_BAD,
  LAUNCH_SNAP_MISSING,
  LAUNCH_SNAP_STALE,
  LAUNCH_SNAP_UNREAD,
  LAUNCH_SUM_UNREAD,
  assertLaunchAllowed,
  bindDraftLaunch,
  bindLaunchToApprovedPlan,
  type LaunchSpend,
} from '../plan-gate'

const NOW = new Date('2026-11-09T12:00:00.000Z')
const AT = '2026-11-09T08:00:00.000Z'
const CLIENT = 'client-1'

type Row = Record<string, unknown>
type Tables = Record<string, Row[]>

function plan(cap: number | null = 2000, id = 'plan-1'): Row {
  const promo = cap == null ? {} : { daily_total_cap_cents: cap }
  return { id, client_id: CLIENT, status: 'approved', plan_data: { promo } }
}

function captures(campaign: Row = {}, adset: Row = {}): Row[] {
  const base = { client_id: CLIENT, ad_account_id: 'act-1', captured_at: AT, complete: true, error: null, skipped_shared: false }
  return [{ ...base, level: 'campaign', ...campaign }, { ...base, level: 'adset', ...adset }]
}

function snap(over: Row): Row {
  return { client_id: CLIENT, ad_account_id: 'act-1', captured_at: AT, effective_status: 'ACTIVE', budget_level: 'abo', daily_budget_minor: 1000, ...over }
}

function world(over: Partial<Tables> = {}): Tables {
  return { marketing_plans: [plan()], client_meta_ad_accounts: [{ client_id: CLIENT, ad_account_id: 'act-1' }], clients: [], ad_snapshot_captures: captures(), ad_entity_snapshots: [], ...over }
}

function fake(tables: Tables, errors: string[] = []): SupabaseClient {
  return {
    from(table: string) {
      const eqs: Array<[string, unknown]> = []
      const ins: Array<[string, unknown[]]> = []
      const gtes: Array<[string, unknown]> = []
      const ltes: Array<[string, unknown]> = []
      let sortKey: string | null = null
      let ascending = true
      let cap: number | null = null
      const api = {
        select: () => api,
        eq(key: string, value: unknown) { eqs.push([key, value]); return api },
        in(key: string, values: unknown[]) { ins.push([key, values]); return api },
        gte(key: string, value: unknown) { gtes.push([key, value]); return api },
        lte(key: string, value: unknown) { ltes.push([key, value]); return api },
        order(key: string, opts?: { ascending?: boolean }) {
          sortKey = key
          ascending = opts?.ascending !== false
          return api
        },
        limit(n: number) { cap = n; return api },
        maybeSingle: () => Promise.resolve(single()),
        then: (resolve: (value: { data: unknown; error: { message: string } | null }) => unknown) => Promise.resolve(many()).then(resolve),
      }
      function matched(): Row[] {
        let rows = (tables[table] ?? []).filter((row) => (
          eqs.every(([key, value]) => row[key] === value)
          && ins.every(([key, values]) => values.includes(row[key]))
          && gtes.every(([key, value]) => String(row[key] ?? '') >= String(value))
          && ltes.every(([key, value]) => String(row[key] ?? '') <= String(value))
        ))
        if (sortKey) {
          const key = sortKey
          rows = [...rows].sort((a, b) => {
            const cmp = String(a[key] ?? '') < String(b[key] ?? '') ? -1 : String(a[key] ?? '') > String(b[key] ?? '') ? 1 : 0
            return ascending ? cmp : -cmp
          })
        }
        return cap == null ? rows : rows.slice(0, cap)
      }
      function many() {
        if (errors.includes(table)) return { data: null, error: { message: 'down' } }
        return { data: matched(), error: null }
      }
      function single() {
        if (errors.includes(table)) return { data: null, error: { message: 'down' } }
        return { data: matched()[0] ?? null, error: null }
      }
      return api
    },
  } as unknown as SupabaseClient
}

function gate(tables: Tables, spend: LaunchSpend = { mode: 'add', cents: 500 }, errors: string[] = []) {
  return bindLaunchToApprovedPlan(fake(tables, errors), CLIENT, spend, NOW)
}

describe('bindLaunchToApprovedPlan', () => {
  it('opens when the one approved plan can hold the new daily budget', async () => {
    const result = await gate(world({
      ad_entity_snapshots: [snap({ level: 'adset', entity_id: 'set-1', campaign_id: 'camp-1', daily_budget_minor: 1000 })],
    }))
    expect(result).toEqual({ ok: true, planId: 'plan-1' })
  })

  it('refuses when there is no approved ads plan', async () => {
    expect(await gate(world({ marketing_plans: [] }))).toEqual({ ok: false, reason: LAUNCH_NO_PLAN })
    const other = world({ marketing_plans: [{ id: 'plan-x', client_id: CLIENT, status: 'approved', plan_data: { note: true } }] })
    expect(await gate(other)).toEqual({ ok: false, reason: LAUNCH_NO_PLAN })
  })

  it('refuses when more than one approved ads plan is current', async () => {
    const tables = world({ marketing_plans: [plan(2000, 'plan-1'), plan(2000, 'plan-2')] })
    expect(await gate(tables)).toEqual({ ok: false, reason: LAUNCH_MANY_PLANS })
  })

  it('refuses when the approved plan has no daily total cap', async () => {
    expect(await gate(world({ marketing_plans: [plan(null)] }))).toEqual({ ok: false, reason: LAUNCH_NO_CAP })
  })

  it('refuses when the plan or the account list cannot be read', async () => {
    expect(await gate(world(), { mode: 'add', cents: 500 }, ['marketing_plans'])).toEqual({ ok: false, reason: LAUNCH_PLAN_UNREAD })
    expect(await gate(world(), { mode: 'add', cents: 500 }, ['client_meta_ad_accounts'])).toEqual({ ok: false, reason: LAUNCH_ACCOUNT_UNREAD })
    expect(await gate(world({ client_meta_ad_accounts: [] }))).toEqual({ ok: false, reason: LAUNCH_NO_ACCOUNT })
  })

  it('uses the client account when no account row is registered', async () => {
    const tables = world({
      client_meta_ad_accounts: [],
      clients: [{ id: CLIENT, meta_ad_account_id: 'act-1' }],
    })
    expect(await gate(tables)).toEqual({ ok: true, planId: 'plan-1' })
  })

  it('refuses a missing, stale, unread, or incomplete capture and does not use an older complete one', async () => {
    expect(await gate(world({ ad_snapshot_captures: [] }))).toEqual({ ok: false, reason: LAUNCH_SNAP_MISSING })
    const stale = captures({ captured_at: '2026-11-07T08:00:00.000Z' }, { captured_at: '2026-11-07T08:00:00.000Z' })
    expect(await gate(world({ ad_snapshot_captures: stale }))).toEqual({ ok: false, reason: LAUNCH_SNAP_STALE })
    expect(await gate(world(), { mode: 'add', cents: 500 }, ['ad_snapshot_captures'])).toEqual({ ok: false, reason: LAUNCH_SNAP_UNREAD })
    const older = { captured_at: '2026-11-09T01:00:00.000Z', complete: true }
    const newer = { captured_at: AT, complete: false }
    expect(await gate(world({ ad_snapshot_captures: [...captures(older, older), ...captures(newer, newer)] }))).toEqual({ ok: false, reason: LAUNCH_SNAP_BAD })
    expect(await gate(world({ ad_snapshot_captures: captures({ error: 'timeout' }) }))).toEqual({ ok: false, reason: LAUNCH_SNAP_BAD })
    expect(await gate(world({ ad_snapshot_captures: captures({ skipped_shared: true }) }))).toEqual({ ok: false, reason: LAUNCH_SNAP_BAD })
    const drifted = captures({}, { captured_at: '2026-11-09T08:00:01.000Z' })
    expect(await gate(world({ ad_snapshot_captures: drifted }))).toEqual({ ok: false, reason: LAUNCH_SNAP_BAD })
  })

  it('blocks when live daily plus the new budget would pass the cap, and allows an equal total', async () => {
    const live = [snap({ level: 'adset', entity_id: 'set-1', campaign_id: 'camp-1', daily_budget_minor: 1500 })]
    expect(await gate(world({ ad_entity_snapshots: live }), { mode: 'add', cents: 600 })).toEqual({ ok: false, reason: LAUNCH_OVER })
    expect(await gate(world({ ad_entity_snapshots: live }), { mode: 'add', cents: 500 })).toEqual({ ok: true, planId: 'plan-1' })
    expect(await gate(world({ ad_entity_snapshots: live }), { mode: 'ad_only' })).toEqual({ ok: true, planId: 'plan-1' })
    const over = [snap({ level: 'adset', entity_id: 'set-1', campaign_id: 'camp-1', daily_budget_minor: 2001 })]
    expect(await gate(world({ ad_entity_snapshots: over }), { mode: 'ad_only' })).toEqual({ ok: false, reason: LAUNCH_OVER })
  })

  it('prices budgets at the capture time and ignores a newer entity row', async () => {
    const rows = [
      snap({ level: 'adset', entity_id: 'set-1', campaign_id: 'camp-1', daily_budget_minor: 1000, captured_at: AT }),
      snap({ level: 'adset', entity_id: 'set-1', campaign_id: 'camp-1', daily_budget_minor: 9000, captured_at: '2026-11-09T11:00:00.000Z' }),
    ]
    expect(await gate(world({ ad_entity_snapshots: rows }), { mode: 'add', cents: 500 })).toEqual({ ok: true, planId: 'plan-1' })
  })

  it('uses the newest budget row inside the capture window', async () => {
    const rows = [
      snap({ level: 'adset', entity_id: 'set-1', campaign_id: 'camp-1', daily_budget_minor: 1500, captured_at: '2026-11-09T02:00:00.000Z' }),
      snap({ level: 'adset', entity_id: 'set-1', campaign_id: 'camp-1', daily_budget_minor: 400, captured_at: AT }),
    ]
    expect(await gate(world({ marketing_plans: [plan(500)], ad_entity_snapshots: rows }), { mode: 'ad_only' })).toEqual({ ok: true, planId: 'plan-1' })
  })

  it('adds nothing for a new ad set under a delivering campaign budget, and adds the ad set under an ad set budget', async () => {
    const cbo = [snap({ level: 'campaign', entity_id: 'camp-1', budget_level: 'cbo', daily_budget_minor: 2000 })]
    expect(await gate(world({ ad_entity_snapshots: cbo }), { mode: 'under_campaign', campaignId: 'camp-1', cents: 800 })).toEqual({ ok: true, planId: 'plan-1' })
    const abo = [
      snap({ level: 'campaign', entity_id: 'camp-1', budget_level: 'abo', daily_budget_minor: null }),
      snap({ level: 'adset', entity_id: 'set-1', campaign_id: 'camp-1', daily_budget_minor: 1500 }),
    ]
    expect(await gate(world({ ad_entity_snapshots: abo }), { mode: 'under_campaign', campaignId: 'camp-1', cents: 600 })).toEqual({ ok: false, reason: LAUNCH_OVER })
    expect(await gate(world({ ad_entity_snapshots: abo }), { mode: 'under_campaign', campaignId: 'camp-1', cents: 400 })).toEqual({ ok: true, planId: 'plan-1' })
  })

  it('refuses a new ad set when the snapshot campaign is not delivering', async () => {
    const paused = [snap({ level: 'campaign', entity_id: 'camp-1', effective_status: 'PAUSED', budget_level: 'cbo', daily_budget_minor: 800 })]
    expect(await gate(world({ ad_entity_snapshots: paused }), { mode: 'under_campaign', campaignId: 'camp-1', cents: 100 })).toEqual({ ok: false, reason: LAUNCH_PARENT_OFF })
    expect(await gate(world(), { mode: 'under_campaign', campaignId: 'camp-1', cents: 100 })).toEqual({ ok: false, reason: LAUNCH_PARENT_OFF })
  })

  it('counts a paused campaign budget on resume, including ad sets that were paused with it', async () => {
    const cbo = [
      snap({ level: 'campaign', entity_id: 'camp-1', effective_status: 'PAUSED', budget_level: 'cbo', daily_budget_minor: 800 }),
      snap({ level: 'adset', entity_id: 'set-live', campaign_id: 'camp-2', daily_budget_minor: 1000 }),
      snap({ level: 'campaign', entity_id: 'camp-2', budget_level: 'abo', daily_budget_minor: null }),
    ]
    expect(await gate(world({ ad_entity_snapshots: cbo }), { mode: 'resume', campaignId: 'camp-1' })).toEqual({ ok: true, planId: 'plan-1' })
    const already = [snap({ level: 'campaign', entity_id: 'camp-1', budget_level: 'cbo', daily_budget_minor: 2000 })]
    expect(await gate(world({ ad_entity_snapshots: already }), { mode: 'resume', campaignId: 'camp-1' })).toEqual({ ok: true, planId: 'plan-1' })
    expect(await gate(world({ marketing_plans: [plan(1500)], ad_entity_snapshots: cbo }), { mode: 'resume', campaignId: 'camp-1' })).toEqual({ ok: false, reason: LAUNCH_OVER })
    const abo = [
      snap({ level: 'campaign', entity_id: 'camp-1', effective_status: 'PAUSED', budget_level: 'abo', daily_budget_minor: null }),
      snap({ level: 'adset', entity_id: 'set-held', campaign_id: 'camp-1', effective_status: 'CAMPAIGN_PAUSED', daily_budget_minor: 700 }),
      snap({ level: 'adset', entity_id: 'set-off', campaign_id: 'camp-1', effective_status: 'PAUSED', daily_budget_minor: 900 }),
    ]
    expect(await gate(world({ marketing_plans: [plan(700)], ad_entity_snapshots: abo }), { mode: 'resume', campaignId: 'camp-1' })).toEqual({ ok: true, planId: 'plan-1' })
    expect(await gate(world(), { mode: 'resume', campaignId: 'missing' })).toEqual({ ok: false, reason: LAUNCH_SUM_UNREAD })
  })

  it('refuses when a live daily budget cannot be read, or the row cap is hit', async () => {
    const blank = [snap({ level: 'adset', entity_id: 'set-1', campaign_id: 'camp-1', daily_budget_minor: null })]
    expect(await gate(world({ ad_entity_snapshots: blank }))).toEqual({ ok: false, reason: LAUNCH_SUM_UNREAD })
    const many = Array.from({ length: 2000 }, (_, i) => snap({
      level: 'adset', entity_id: `set-${i}`, campaign_id: 'camp-1', effective_status: 'PAUSED', daily_budget_minor: 1,
    }))
    expect(await gate(world({ ad_entity_snapshots: many }))).toEqual({ ok: false, reason: LAUNCH_SUM_UNREAD })
  })

  it('refuses a draft with no usable daily budget before it reads a plan', async () => {
    expect(await bindDraftLaunch(fake(world()), CLIENT, { dailyBudget: 0 }, NOW)).toEqual({ ok: false, reason: LAUNCH_BUDGET_UNREAD })
    expect(await bindDraftLaunch(fake(world()), CLIENT, { existingAdSetId: 'set-1' }, NOW)).toEqual({ ok: true, planId: 'plan-1' })
  })

  it('reads a paused draft the same way, and stops when the draft has no ids', async () => {
    const payload = {
      status: 'awaiting_approval',
      campaignId: 'camp-1',
      adSetId: 'set-1',
      adIds: ['ad-1'],
      draft: { dailyBudget: 5 },
    }
    expect(await assertLaunchAllowed(fake(world()), CLIENT, payload, NOW)).toEqual({ ok: true, planId: 'plan-1' })
    expect(await assertLaunchAllowed(fake(world()), CLIENT, { status: 'awaiting_approval' }, NOW)).toEqual({ ok: false, reason: LAUNCH_DRAFT_UNREAD })
  })
})
