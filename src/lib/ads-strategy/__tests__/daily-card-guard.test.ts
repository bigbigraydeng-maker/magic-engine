import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { KernelDeps } from '@/lib/kernel/deps'
import type { BreakerFacts } from '@/lib/ads-strategy/circuit-breaker/rules'
import { defaultBreakerSettings } from '@/lib/ads-strategy/circuit-breaker/settings'
import type { FallbackInput } from '@/lib/ads-strategy/scale-fallback/rules'
import {
  DATA_UNREAD,
  MANY_PLANS,
  NO_CAP,
  RULE_CLEARED,
  STALE_SNAPSHOT,
  blockScaleFallbackOnConfirm,
  latestUsableCapture,
  recheckBreakerPause,
  recheckScaleFallback,
  singleApprovedPlanReason,
} from '@/lib/ads-strategy/daily-card-guard'

const CLIENT = 'client-1'
const NOW = new Date('2026-11-09T05:00:00.000Z')

function plans(rows: unknown[], error: { message: string } | null = null) {
  const sb = {
    from() {
      const api = {
        select: () => api,
        eq: () => api,
        then: (resolve: (value: { data: unknown; error: typeof error }) => unknown) => (
          Promise.resolve({ data: rows, error }).then(resolve)
        ),
      }
      return api
    },
  }
  return sb as unknown as SupabaseClient
}

function captures(rows: unknown[], error: { message: string } | null = null) {
  const sb = {
    from() {
      const api = {
        select: () => api,
        eq: () => api,
        order: () => api,
        limit: async () => ({ data: rows, error }),
      }
      return api
    },
  }
  return sb as unknown as SupabaseClient
}

function facts(): BreakerFacts {
  return {
    settings: defaultBreakerSettings(), spend: [], spendReadable: true,
    capReadable: true, capCents: 1000, localDate: '2026-11-09',
  } as BreakerFacts
}

function fallback(over: Partial<FallbackInput> = {}): FallbackInput {
  return {
    stage: 'other',
    targetCents: null,
    capCents: null,
    fresh: true,
    timezoneKnown: true,
    truncated: false,
    yesterday: null,
    dayBefore: null,
    currency: null,
    adsets: [],
    campaigns: [],
    days: {},
    actions: [],
    ...over,
  }
}

describe('daily card confirm recheck', () => {
  it('uses the latest complete capture and ignores a newer row that failed', async () => {
    const found = await latestUsableCapture(captures([
      { captured_at: '2026-11-09T04:00:00.000Z', complete: false, error: 'read failed', skipped_shared: false },
      { captured_at: '2026-11-09T01:00:00.000Z', complete: true, error: null, skipped_shared: false },
    ]), CLIENT, '11', 'ad')
    expect(found).toEqual({ state: 'row', capturedAt: '2026-11-09T01:00:00.000Z' })
    const none = await latestUsableCapture(captures([
      { captured_at: '2026-11-09T04:00:00.000Z', complete: true, error: 'read failed', skipped_shared: false },
    ]), CLIENT, '11', 'ad')
    expect(none.state).toBe('none')
    const unread = await latestUsableCapture(captures([], { message: 'down' }), CLIENT, '11', 'ad')
    expect(unread.state).toBe('unread')
  })

  it('requires one approved plan that has a daily total', async () => {
    const cap = { promo: { daily_total_cap_cents: 100 } }
    expect(await singleApprovedPlanReason(plans([{ plan_data: cap }]), CLIENT)).toBeNull()
    expect(await singleApprovedPlanReason(plans([]), CLIENT)).toContain('没有已批准')
    expect(await singleApprovedPlanReason(plans([{ plan_data: cap }, { plan_data: cap }]), CLIENT)).toBe(MANY_PLANS)
    expect(await singleApprovedPlanReason(plans([{ plan_data: { promo: {} } }]), CLIENT)).toBe(NO_CAP)
  })

  it('refuses a breaker pause when the snapshot is stale or the rule has cleared, and does not write', async () => {
    const write = vi.fn()
    const stale = await recheckBreakerPause({} as SupabaseClient, CLIENT, 'camp-1', '11', NOW, {
      plan: async () => null,
      load: async () => facts(),
      capture: async () => 'stale',
    })
    expect(stale).toBe(STALE_SNAPSHOT)
    const cleared = await recheckBreakerPause({} as SupabaseClient, CLIENT, 'camp-1', '11', NOW, {
      plan: async () => null,
      load: async () => facts(),
      capture: async () => 'fresh',
    })
    expect(cleared).toBe(RULE_CLEARED)
    const unread = await recheckBreakerPause({} as SupabaseClient, CLIENT, 'camp-1', '11', NOW, {
      plan: async () => null,
      load: async () => 'unreadable',
      capture: async () => 'fresh',
    })
    expect(unread).toBe(DATA_UNREAD)
    expect(write).not.toHaveBeenCalled()
    const source = readFileSync(join(process.cwd(), 'src/lib/ads-strategy/daily-card-guard.ts'), 'utf8')
    expect(source).not.toContain('graph.facebook')
    expect(source).not.toContain('setCampaignStatus')
    expect(source).not.toContain('getMetaTokenForClient')
  })

  it('refuses a scale-back card when the numbers no longer match or the snapshot is stale', async () => {
    const write = vi.fn()
    const cleared = await recheckScaleFallback({} as SupabaseClient, CLIENT, 'scale-back-abc', NOW, {
      plan: async () => null,
      load: async () => fallback(),
    })
    expect(cleared).toBe(RULE_CLEARED)
    const stale = await recheckScaleFallback({} as SupabaseClient, CLIENT, 'scale-back-abc', NOW, {
      plan: async () => null,
      load: async () => fallback({ fresh: false }),
    })
    expect(stale).toBe(STALE_SNAPSHOT)
    expect(write).not.toHaveBeenCalled()
  })

  it('refuses an expired scale-back card before the recheck, and leaves manual cards alone', async () => {
    const load = vi.fn()
    const kernel = {
      supabase: {} as SupabaseClient,
      now: () => NOW,
      requireRun: async () => ({
        client_id: CLIENT,
        input: cardInput('nz_day', '2026-11-07T17:00:00.000Z'),
      }),
    } as unknown as KernelDeps
    const expired = await blockScaleFallbackOnConfirm(kernel, CLIENT, 'run-1', 'confirm', NOW)
    expect(expired).toContain('23:59')
    expect(load).not.toHaveBeenCalled()

    const manual = {
      ...kernel,
      requireRun: async () => ({
        client_id: CLIENT,
        input: cardInput('urgent_30m', '2026-11-07T17:00:00.000Z'),
      }),
    } as unknown as KernelDeps
    expect(await blockScaleFallbackOnConfirm(manual, CLIENT, 'run-1', 'confirm', NOW)).toBeNull()
  })
})

function cardInput(lifetime: string, issuedAt: string): Record<string, unknown> {
  return {
    lifetime,
    subject_key: 'scale-back-abc',
    content_fingerprint: 'a'.repeat(64),
    what: '提议把日预算收回放量之前。只出确认卡，不暂停，不加预算，点确认也不会改预算。',
    account_label: '这位客户的广告账户',
    amount_label: '每天收回一点。不暂停，也不加预算。',
    date_label: '前一天到昨天',
    scope_label: '不改计划上的阶段，也不改正在跑的预算。',
    issued_at: issuedAt,
    hard_checks: JSON.stringify([{ label: '快照', state: 'green', reason: '最近一次抓全的广告快照还在有效期内。' }]),
  }
}
