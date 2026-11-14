import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApplyDeps } from '../apply'
import { DATA_UNREAD, RULE_CLEARED, SAMPLE_STALE, recheckBreakerPause } from '@/lib/ads-strategy/daily-card-guard'
import { defaultBreakerSettings } from '../settings'
import type { BreakerFacts } from '../rules'
import {
  applyIntradayCpl,
  judgeIntradayCpl,
  type IntradayCplInput,
  type IntradaySampleRow,
} from '../intraday'
import { loadIntradayCplInput } from '../intraday-run'

const NOW = new Date('2026-11-13T04:00:00.000Z')
const DAY = '2026-11-13'
const CLIENT = 'client-1'

function sample(over: Partial<IntradaySampleRow> = {}): IntradaySampleRow {
  return {
    accountId: 'act-demo',
    accountDay: DAY,
    sampledAt: NOW.toISOString(),
    localMinute: 1020,
    entityId: 'camp-a',
    spendMinor: 250,
    currency: 'NZD',
    name: '合成系列',
    ...over,
  }
}

function input(over: Partial<IntradayCplInput> = {}): IntradayCplInput {
  return {
    now: NOW,
    nzDay: DAY,
    settings: { ...defaultBreakerSettings(), targetCplCents: 100 },
    primaryResult: 'lead',
    samples: [sample()],
    leads: [],
    ...over,
  }
}

function memory(): ApplyDeps & { issued: () => number } {
  const open = new Set<string>()
  let issued = 0
  return {
    issued: () => issued,
    issuePause: async () => {
      issued += 1
      return { ok: true, runId: 'run-1' }
    },
    alreadyOpen: async (key) => open.has(key),
    record: async (event) => {
      open.add(event.subjectKey)
      return true
    },
  }
}

describe('intraday CPL pause cards', () => {
  it('issues one card when today CPL is over twice the client target', async () => {
    const deps = memory()
    const facts = input({
      samples: [sample({ spendMinor: 201 })],
      leads: [{ campaignId: 'camp-a', createdAt: NOW.toISOString() }],
    })
    const judged = judgeIntradayCpl(facts)
    expect(judged.kind).toBe('judged')
    if (judged.kind === 'judged') expect(judged.judgement.pauses[0]?.rules).toEqual(['cpl_over_target'])
    const first = await applyIntradayCpl(facts, deps)
    expect(first).toMatchObject({ cards: 1, kind: 'judged' })
    expect(deps.issued()).toBe(1)
  })

  it('issues one card when spend is over twice the target and there are no leads', async () => {
    const deps = memory()
    const facts = input({ samples: [sample({ spendMinor: 201 })], leads: [] })
    const judged = judgeIntradayCpl(facts)
    expect(judged.kind).toBe('judged')
    if (judged.kind === 'judged') expect(judged.judgement.pauses[0]?.rules).toEqual(['cpl_zero_leads'])
    expect(await applyIntradayCpl(facts, deps)).toMatchObject({ cards: 1 })
    expect(deps.issued()).toBe(1)
  })

  it('does not issue a second card for the same campaign on the same NZ day', async () => {
    const deps = memory()
    const facts = input({ samples: [sample({ spendMinor: 201 })] })
    expect((await applyIntradayCpl(facts, deps)).cards).toBe(1)
    expect((await applyIntradayCpl(facts, deps)).cards).toBe(0)
    expect(deps.issued()).toBe(1)
  })

  it('issues nothing when the client switch is off', async () => {
    const deps = memory()
    const facts = input({
      settings: { ...defaultBreakerSettings(), enabled: false, targetCplCents: 100 },
      samples: [sample({ spendMinor: 900 })],
    })
    expect(await applyIntradayCpl(facts, deps)).toEqual({ cards: 0, kind: 'off' })
    expect(deps.issued()).toBe(0)
  })

  it('issues nothing when the sample is stale', async () => {
    const deps = memory()
    const stale = new Date(NOW.getTime() - 31 * 60 * 1000).toISOString()
    const facts = input({ samples: [sample({ sampledAt: stale, spendMinor: 900 })] })
    expect(await applyIntradayCpl(facts, deps)).toEqual({ cards: 0, kind: 'stale' })
    expect(deps.issued()).toBe(0)
  })

  it('does not treat an unattributed lead as zero', async () => {
    const deps = memory()
    const facts = input({
      leads: [{ campaignId: null, createdAt: NOW.toISOString() }],
    })
    expect(await applyIntradayCpl(facts, deps)).toMatchObject({ cards: 0 })
    expect(deps.issued()).toBe(0)
  })

  it('refuses confirm when the fresh read cleared or the sample went stale', async () => {
    const quiet = {
      settings: defaultBreakerSettings(),
      spend: [],
      spendReadable: true,
      capReadable: true,
      capCents: null,
      localDate: DAY,
    } as BreakerFacts
    const ports = {
      plan: async () => null,
      load: async () => quiet,
      capture: async () => 'fresh' as const,
    }
    const held = await recheckBreakerPause({} as SupabaseClient, CLIENT, 'camp-a', 'act-demo', NOW, {
      ...ports,
      intraday: async () => 'holding',
    })
    const stale = await recheckBreakerPause({} as SupabaseClient, CLIENT, 'camp-a', 'act-demo', NOW, {
      ...ports,
      intraday: async () => 'stale',
    })
    const cleared = await recheckBreakerPause({} as SupabaseClient, CLIENT, 'camp-a', 'act-demo', NOW, {
      ...ports,
      intraday: async () => 'clear',
    })
    const unread = await recheckBreakerPause({} as SupabaseClient, CLIENT, 'camp-a', 'act-demo', NOW, {
      ...ports,
      intraday: async () => 'unread',
    })
    expect(held).toBeNull()
    expect(stale).toBe(SAMPLE_STALE)
    expect(cleared).toBe(RULE_CLEARED)
    expect(unread).toBe(DATA_UNREAD)
  })
})

describe('loadIntradayCplInput', () => {
  it('maps the sample and the CRM lead into one over-target card', async () => {
    const loaded = await loadIntradayCplInput(sb({
      clients: [{ leads_config: { ads_circuit_breaker: { target_cpl_cents: 100 } } }],
      ad_strategy_configs: [{ primary_result: 'lead', target_cost_per_primary: null }],
      marketing_plans: [{ plan_data: {} }],
      ad_entity_snapshots: [{ entity_id: 'camp-a', entity_name: '合成系列' }],
      ad_intraday_spend_samples: [{
        ad_account_id: 'act-demo',
        account_day: DAY,
        sampled_at: NOW.toISOString(),
        local_minute: 1020,
        entity_id: 'camp-a',
        spend_minor: 250,
        currency: 'NZD',
      }],
      contacts: [{ attr_campaign_id: 'camp-a', created_at: NOW.toISOString() }],
    }), CLIENT, NOW)
    expect(loaded).not.toBe('unread')
    if (loaded === 'unread') return
    const judged = judgeIntradayCpl(loaded)
    expect(judged.kind).toBe('judged')
    if (judged.kind === 'judged') expect(judged.judgement.pauses.map((item) => item.rules)).toEqual([['cpl_over_target']])
  })
})

describe('no new write path', () => {
  it('keeps the pause behind the existing card and does not call Meta', () => {
    const dir = join(process.cwd(), 'src/lib/ads-strategy/circuit-breaker')
    const source = ['intraday.ts', 'intraday-run.ts', 'run.ts'].map((name) => readFileSync(join(dir, name), 'utf8')).join('\n')
    expect(source).toContain("cardLifetime: 'nz_day'")
    expect(source).not.toContain('graph.facebook')
    expect(source).not.toContain('setCampaignStatus')
    const guard = readFileSync(join(process.cwd(), 'src/lib/ads-strategy/scale-fallback/rules.ts'), 'utf8')
    expect(guard).toContain("input.stage === 'scale'")
  })
})

function sb(tables: Record<string, unknown[]>): SupabaseClient {
  let rows: unknown[] = []
  const api = {
    select: () => api,
    eq: () => api,
    gte: () => api,
    lte: () => api,
    order: () => api,
    limit: async () => ({ data: rows, error: null }),
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
  }
  return { from: (table: string) => { rows = tables[table] ?? []; return api } } as unknown as SupabaseClient
}
