import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { PrescriptionContent } from '@/types/diagnostic'
import type { AdsDraftFacts } from '@/lib/marketing-plan/promo/draft-ads'

vi.mock('@/lib/anthropic/client', () => ({
  MODEL_SONNET: 'm',
  parseJsonResponse: JSON.parse,
  getAnthropicClient: () => ({}),
}))

vi.mock('@/lib/ads-strategy/plan-seed/deps', () => ({
  productionDeps: () => ({
    now: () => new Date('2026-10-26T02:00:00Z'),
    loadOwnedAccounts: async () => { throw new Error('production dep must not be used') },
    loadFacts: async () => { throw new Error('production dep must not be used') },
    loadCaptureAt: async () => { throw new Error('production dep must not be used') },
    loadClientPageId: async () => { throw new Error('production dep must not be used') },
    getPageToken: async () => { throw new Error('production dep must not be used') },
    readForms: async () => { throw new Error('production dep must not be used') },
    readScopes: async () => { throw new Error('production dep must not be used') },
    readPromotePages: async () => { throw new Error('production dep must not be used') },
    playbookShare: async () => { throw new Error('production dep must not be used') },
  }),
  loadGoalPeriod: vi.fn(async () => null),
}))

import { normalizePrescriptionContent } from '../agent'
import {
  attachPlanSeed,
  collectAdPlays,
  type AttachDeps,
} from '@/lib/ads-strategy/plan-seed/attach'
import { planSeedSchema } from '@/lib/ads-strategy/plan-seed/types'

function facts(): AdsDraftFacts {
  return {
    today: '2026-10-26',
    headroom: {
      ok: true,
      headroom_minor: 15000,
      delivering_minor: 5000,
      cap_minor: 20000,
      currency: 'NZD',
      as_of: null,
    },
    account_delivering_minor: 0,
    account_cap_minor: 10000,
    committed_minor: 0,
    daily: [],
    insights_as_of: null,
    account_status: 1,
    audiences: [],
    audiences_complete: true,
    approved_creatives: [],
    budget_share_of_headroom: 0.5,
    min_audience_size: 1000,
    max_creatives: 3,
  }
}

function fullDeps(): AttachDeps {
  return {
    now: () => new Date('2026-10-26T02:00:00Z'),
    loadOwnedAccounts: async () => [{ id: 'act_A', cap: 10000, label: 'A' }],
    loadFacts: async () => facts(),
    loadCaptureAt: async () => '2026-10-26T00:00:00Z',
    loadClientPageId: async () => '555',
    getPageToken: async () => 'tok',
    readForms: async () => ({ state: 'ok', value: [{ id: 'f1', active: true }] }),
    readScopes: async () => ({
      source: 'client_page',
      scopes: { state: 'ok', value: ['leads_retrieval', 'pages_manage_ads'] },
    }),
    readPromotePages: async () => ({ state: 'ok', value: ['555'] }),
    playbookShare: async () => 0.5,
    loadPeriod: async () => ({ start_date: '2026-10-27', end_date: '2026-11-10' }),
  }
}

const asC = (v: object): PrescriptionContent => JSON.parse(JSON.stringify(v))

function seed(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    initiative_type: 'demand_generation',
    title: 't',
    posture: 'offensive',
    budget_percent: 50,
    hypothesis: 'h',
    ...extra,
  }
}

function phase(n: number, s: Record<string, unknown>): Record<string, unknown> {
  return { phase_number: n, name: 'n', duration_weeks: 4, actions: [], initiative_seed: s }
}

function llmOutput(phase1: Record<string, unknown>, phase2: Record<string, unknown>): object {
  return {
    summary: 's',
    kpi_targets: [],
    budget_allocation: [],
    phases: [phase(1, phase1), phase(2, phase2)],
  }
}

function buildPrior(): PrescriptionContent {
  const raw = llmOutput(
    seed({ ad_plays: [{ play: 'lead_form_harvest' }] }),
    seed({ ad_plays: [{ play: 'thruplay_pool_build' }] }),
  )
  return normalizePrescriptionContent(raw)
}

const ctx = { clientId: 'c1', goalId: 'g1' }

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  warn.mockRestore()
})

describe('refine carry end-to-end', () => {
  it('restores phase 2 from the previous version when the LLM writes an invalid play', async () => {
    const prior = buildPrior()
    const next = normalizePrescriptionContent(
      llmOutput(
        seed({ ad_plays: [{ play: 'lead_form_harvest' }] }),
        seed({ ad_plays: [{ play: 'retargeting' }] }),
      ),
    )
    const result = await attachPlanSeed(
      next,
      { clientId: ctx.clientId, goalId: ctx.goalId, priorContent: prior },
      fullDeps(),
    )
    expect(result.plan_seed).toBeDefined()
    expect(collectAdPlays(result).map((p) => p.step_key)).toEqual([
      'p1-1-lead_form_harvest',
      'p2-1-thruplay_pool_build',
    ])
    const notes = planSeedSchema.parse(result.plan_seed).notes
    expect(notes).toContain('打法是从上一版带回来的（阶段 2）')
    expect(notes).not.toContain('打法是从上一版带回来的（阶段 1）')
    const warned = warn.mock.calls.some(
      (call) => typeof call[0] === 'string' && call[0].includes('ad_plays dropped phase=2'),
    )
    expect(warned).toBe(true)
  })

  it('does not restore phase 2 when the LLM omits ad_plays (intentional removal)', async () => {
    const prior = buildPrior()
    const next = normalizePrescriptionContent(
      llmOutput(
        seed({ ad_plays: [{ play: 'lead_form_harvest' }] }),
        seed(),
      ),
    )
    const result = await attachPlanSeed(
      next,
      { clientId: ctx.clientId, goalId: ctx.goalId, priorContent: prior },
      fullDeps(),
    )
    expect(result.plan_seed).toBeDefined()
    expect(collectAdPlays(result).map((p) => p.step_key)).toEqual(['p1-1-lead_form_harvest'])
    const notes = planSeedSchema.parse(result.plan_seed).notes
    expect(notes.some((n) => n.includes('带回来'))).toBe(false)
  })

  it('does not restore phase 2 when the LLM writes null or an empty list', async () => {
    const prior = buildPrior()
    const nextNull = normalizePrescriptionContent(
      llmOutput(
        seed({ ad_plays: [{ play: 'lead_form_harvest' }] }),
        seed({ ad_plays: null }),
      ),
    )
    const resultNull = await attachPlanSeed(
      nextNull,
      { clientId: ctx.clientId, goalId: ctx.goalId, priorContent: prior },
      fullDeps(),
    )
    expect(resultNull.plan_seed).toBeDefined()
    expect(collectAdPlays(resultNull).map((p) => p.step_key)).toEqual(['p1-1-lead_form_harvest'])
    expect(
      planSeedSchema.parse(resultNull.plan_seed).notes.some((n) => n.includes('带回来')),
    ).toBe(false)

    const nextEmpty = normalizePrescriptionContent(
      llmOutput(
        seed({ ad_plays: [{ play: 'lead_form_harvest' }] }),
        seed({ ad_plays: [] }),
      ),
    )
    const resultEmpty = await attachPlanSeed(
      nextEmpty,
      { clientId: ctx.clientId, goalId: ctx.goalId, priorContent: prior },
      fullDeps(),
    )
    expect(resultEmpty.plan_seed).toBeDefined()
    expect(collectAdPlays(resultEmpty).map((p) => p.step_key)).toEqual(['p1-1-lead_form_harvest'])
    expect(
      planSeedSchema.parse(resultEmpty.plan_seed).notes.some((n) => n.includes('带回来')),
    ).toBe(false)
  })

  it('restores both phases when both write invalid lists', async () => {
    const prior = buildPrior()
    const next = normalizePrescriptionContent(
      llmOutput(
        seed({ ad_plays: [{ play: 'retargeting' }] }),
        seed({ ad_plays: [{ play: 'retargeting' }] }),
      ),
    )
    const result = await attachPlanSeed(
      next,
      { clientId: ctx.clientId, goalId: ctx.goalId, priorContent: prior },
      fullDeps(),
    )
    expect(result.plan_seed).toBeDefined()
    expect(collectAdPlays(result).map((p) => p.step_key)).toEqual([
      'p1-1-lead_form_harvest',
      'p2-1-thruplay_pool_build',
    ])
    const notes = planSeedSchema.parse(result.plan_seed).notes
    expect(notes).toContain('打法是从上一版带回来的（阶段 1）')
    expect(notes).toContain('打法是从上一版带回来的（阶段 2）')
  })

  it('does not persist the dropped marker', async () => {
    const prior = buildPrior()
    const next = normalizePrescriptionContent(
      llmOutput(
        seed({ ad_plays: [{ play: 'lead_form_harvest' }] }),
        seed({ ad_plays: [{ play: 'retargeting' }] }),
      ),
    )
    const result = await attachPlanSeed(
      next,
      { clientId: ctx.clientId, goalId: ctx.goalId, priorContent: prior },
      fullDeps(),
    )
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('dropped')
    expect(serialized).not.toContain('marker')
  })
})

describe('huatuo generate path persisted shape (end-to-end)', () => {
  it('stores only step_key + play and no LLM-smuggled numbers', async () => {
    const raw = {
      ...llmOutput(
        seed({
          ad_plays: [
            {
              step_key: 'ACT-1234567890-50aud-day',
              play: 'lead_form_harvest',
              budget: 999,
              account: 'act_123',
              daily_budget_cents: 5000,
            },
          ],
        }),
        seed(),
      ),
      plan_seed: {
        ad_steps: [
          { ad_account_id: { ok: true, value: 'act_FAKE' }, daily_budget_cents: 999999 },
        ],
      },
    }
    const normalized = normalizePrescriptionContent(raw)
    const result = await attachPlanSeed(normalized, ctx, fullDeps())
    const stored = JSON.parse(JSON.stringify(result)) as PrescriptionContent

    expect(stored.phases[0].initiative_seed?.ad_plays).toEqual([
      { step_key: 'p1-1-lead_form_harvest', play: 'lead_form_harvest' },
    ])

    const phasesJson = JSON.stringify(stored.phases)
    expect(phasesJson).not.toContain('999')
    expect(phasesJson).not.toContain('act_123')
    expect(phasesJson).not.toContain('1234567890')

    expect(stored.plan_seed).toBeDefined()
    const planSeedJson = JSON.stringify(stored.plan_seed)
    expect(planSeedJson).not.toContain('act_FAKE')
    expect(planSeedJson).not.toContain('999999')
  })
})
