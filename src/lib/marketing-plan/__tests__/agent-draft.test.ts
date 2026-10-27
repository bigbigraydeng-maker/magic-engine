import { describe, expect, it, vi } from 'vitest'
import type { GoalFact } from '@/lib/marketing-plan/promo/reconcile'
import type { PlanSeed } from '@/lib/ads-strategy/plan-seed/types'
import type { AccountCapFacts } from '@/lib/marketing-plan/promo/budget-caps'
import { parseAgentDraftBody } from '@/lib/marketing-plan/agent-draft-parse'
import { saveAgentDraft, type AgentDraftDeps, type AgentPlanRow, type DraftInsert } from '@/lib/marketing-plan/agent-draft'
import { planDraftId } from '@/lib/marketing-plan/promo/plan-draft-id'

const RX = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PLAN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const KEY = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const CLIENT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const basis = { label: 'label', value: 'value', source: 'source', as_of: null }

function promo(cents: number): Record<string, unknown> {
  return {
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
          daily_budget_cents: cents,
          audience_ref: 'aud',
          creative_refs: [],
          placements: [],
          paused_ranges: [],
        },
      }],
    }],
  }
}

function goal(): GoalFact {
  return {
    status: 'active',
    target_value: null,
    baseline_value: null,
    period_start: '2026-11-01',
    period_end: '2026-11-14',
    current_value: null,
    current_value_fetched_at: null,
  }
}

function seed(cents: number): PlanSeed {
  const field = <T extends string | number>(value: T) => ({ ok: true as const, value, basis: [basis], notes: [] as string[] })
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
      page_id: field('page'),
      ad_account_id: field('act_1'),
      daily_budget_cents: field(cents),
    }],
    skipped: [],
    notes: [],
  }
}

function account(cap: number | null): AccountCapFacts {
  return { ad_account_id: 'act_1', currency: 'AUD', daily_cap_cents: cap, owned_by_client: true }
}

function deps(over: Partial<AgentDraftDeps> = {}): AgentDraftDeps & { inserted: DraftInsert[] } {
  const inserted: DraftInsert[] = []
  const base: AgentDraftDeps = {
    now: () => new Date('2026-10-27T00:00:00.000Z'),
    readSeed: vi.fn(async () => ({ status: 200, body: { success: true, seed: seed(5000) } })),
    loadGoal: vi.fn(async () => goal()),
    loadBudget: vi.fn(async () => ({ accounts: [account(10000)], clientCapCents: 20000 })),
    loadPlan: vi.fn(async () => null),
    insertPlan: vi.fn(async (row: DraftInsert) => {
      inserted.push(row)
      return row.id ?? 'plan-new'
    }),
    updatePlan: vi.fn(async () => true),
  }
  return { ...base, ...over, inserted }
}

function request(cents = 5000) {
  const parsed = parseAgentDraftBody({ prescription_id: RX, title: '草稿', promo: promo(cents) })
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.request
}

function versioned(version: number) {
  const parsed = parseAgentDraftBody({ prescription_id: RX, version, title: '草稿', promo: promo(5000) })
  if (!parsed.ok) throw new Error(parsed.error)
  return parsed.request
}

describe('parseAgentDraftBody', () => {
  it('rejects approval fields instead of saving them', () => {
    for (const extra of [{ status: 'approved' }, { approved_at: '2026-10-27' }, { generation_meta: {} }]) {
      const parsed = parseAgentDraftBody({ prescription_id: RX, title: '草稿', promo: promo(1000), ...extra })
      expect(parsed.ok).toBe(false)
      if (!parsed.ok) expect(parsed.code).toBe('forbidden_field')
    }
    const receipt = parseAgentDraftBody({
      prescription_id: RX,
      title: '草稿',
      promo: { ...promo(1000), gate_snapshot: { taken_at: 'x' } },
    })
    expect(receipt.ok).toBe(false)
  })

  it('rejects a version that is not a whole number', () => {
    const parsed = parseAgentDraftBody({ prescription_id: RX, version: '2', title: '草稿', promo: promo(1000) })
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.code).toBe('invalid_version')
  })
})

describe('saveAgentDraft', () => {
  it('inserts an unapproved draft at the suggestion and stamps the key', async () => {
    const d = deps()
    const result = await saveAgentDraft({ clientId: CLIENT, keyId: KEY, request: request(5000), deps: d })
    expect(result).toMatchObject({ status: 200, code: 'saved', planId: 'plan-new' })
    expect(d.inserted).toHaveLength(1)
    const row = d.inserted[0]
    expect(row.status).toBe('draft')
    expect(row.approved_at).toBeNull()
    expect(row).not.toHaveProperty('approved_by')
    expect(row.generation_meta.agent_draft).toEqual({
      key_id: KEY,
      prescription_id: RX,
      saved_at: '2026-10-27T00:00:00.000Z',
    })
    expect(row.generation_meta).not.toHaveProperty('approval_receipt')
    expect(row.status).not.toBe('approved')
    expect(row.id).toBeUndefined()
  })

  it('does not write when the budget exceeds the seed or the cap', async () => {
    const aboveSeed = deps()
    const seedResult = await saveAgentDraft({ clientId: CLIENT, keyId: KEY, request: request(5001), deps: aboveSeed })
    expect(seedResult).toMatchObject({ status: 400, code: 'budget_over' })
    expect(aboveSeed.inserted).toEqual([])

    const aboveCap = deps({
      loadBudget: vi.fn(async () => ({ accounts: [account(1000)], clientCapCents: 20000 })),
    })
    const capResult = await saveAgentDraft({ clientId: CLIENT, keyId: KEY, request: request(5000), deps: aboveCap })
    expect(capResult).toMatchObject({ status: 400, code: 'budget_over' })
    expect(aboveCap.insertPlan).not.toHaveBeenCalled()
  })

  it('does not change an approved plan', async () => {
    const approved: AgentPlanRow = {
      id: PLAN,
      status: 'approved',
      updatedAt: '2026-10-26T00:00:00.000Z',
      title: 'old',
      startDate: null,
      endDate: null,
      planData: {},
      generationMeta: null,
    }
    const d = deps({ loadPlan: vi.fn(async () => approved) })
    const parsed = parseAgentDraftBody({
      prescription_id: RX,
      plan_id: PLAN,
      expected_updated_at: approved.updatedAt,
      promo: promo(5000),
    })
    if (!parsed.ok) throw new Error(parsed.error)
    const result = await saveAgentDraft({ clientId: CLIENT, keyId: KEY, request: parsed.request, deps: d })
    expect(result).toMatchObject({ status: 409, code: 'not_draft' })
    expect(d.updatePlan).not.toHaveBeenCalled()
    expect(d.inserted).toEqual([])
  })

  it('uses the auto-draft id for one prescription version and updates that draft', async () => {
    const version = 2
    const id = planDraftId(RX, version)
    const created = deps()
    const first = await saveAgentDraft({ clientId: CLIENT, keyId: KEY, request: versioned(version), deps: created })
    expect(first).toMatchObject({ status: 200, code: 'saved', planId: id })
    expect(created.inserted).toHaveLength(1)
    expect(created.inserted[0].id).toBe(id)
    expect(created.inserted[0].status).toBe('draft')

    const existing: AgentPlanRow = {
      id,
      status: 'draft',
      updatedAt: '2026-10-26T00:00:00.000Z',
      title: 'old',
      startDate: null,
      endDate: null,
      planData: {},
      generationMeta: null,
    }
    const again = deps({ loadPlan: vi.fn(async () => existing) })
    const second = await saveAgentDraft({ clientId: CLIENT, keyId: KEY, request: versioned(version), deps: again })
    expect(second).toMatchObject({ status: 200, code: 'saved', planId: id })
    expect(again.insertPlan).not.toHaveBeenCalled()
    expect(again.updatePlan).toHaveBeenCalledWith(id, CLIENT, existing.updatedAt, expect.anything())
    expect(planDraftId(RX, version + 1)).not.toBe(id)
  })

  it('does not overwrite an approved plan that already uses this prescription version', async () => {
    const id = planDraftId(RX, 2)
    const approved: AgentPlanRow = {
      id,
      status: 'approved',
      updatedAt: '2026-10-26T00:00:00.000Z',
      title: 'old',
      startDate: null,
      endDate: null,
      planData: {},
      generationMeta: null,
    }
    const d = deps({ loadPlan: vi.fn(async () => approved) })
    const result = await saveAgentDraft({ clientId: CLIENT, keyId: KEY, request: versioned(2), deps: d })
    expect(result.status).toBe(409)
    expect(result.code).toBe('already_approved')
    expect(result.error).toContain('不能覆盖')
    expect(d.updatePlan).not.toHaveBeenCalled()
    expect(d.insertPlan).not.toHaveBeenCalled()
  })

  it('uses one id for a prescription id in any letter case and keeps an approved plan', async () => {
    const id = planDraftId(RX, 2)
    const parsed = parseAgentDraftBody({ prescription_id: RX.toUpperCase(), version: 2, title: '草稿', promo: promo(5000) })
    if (!parsed.ok) throw new Error(parsed.error)
    const created = deps()
    await saveAgentDraft({ clientId: CLIENT, keyId: KEY, request: parsed.request, deps: created })
    expect(created.inserted[0]?.id).toBe(id)

    const approved: AgentPlanRow = {
      id,
      status: 'approved',
      updatedAt: '2026-10-26T00:00:00.000Z',
      title: 'old',
      startDate: null,
      endDate: null,
      planData: {},
      generationMeta: null,
    }
    const d = deps({ loadPlan: vi.fn(async () => approved) })
    const result = await saveAgentDraft({ clientId: CLIENT, keyId: KEY, request: parsed.request, deps: d })
    expect(result).toMatchObject({ status: 409, code: 'already_approved' })
    expect(d.loadPlan).toHaveBeenCalledWith(CLIENT, id)
    expect(d.updatePlan).not.toHaveBeenCalled()
    expect(d.insertPlan).not.toHaveBeenCalled()
  })

  it('rejects a plan id that does not match the prescription version', async () => {
    const d = deps()
    const parsed = parseAgentDraftBody({
      prescription_id: RX,
      version: 2,
      plan_id: PLAN,
      expected_updated_at: '2026-10-26T00:00:00.000Z',
      title: '草稿',
      promo: promo(5000),
    })
    if (!parsed.ok) throw new Error(parsed.error)
    const result = await saveAgentDraft({ clientId: CLIENT, keyId: KEY, request: parsed.request, deps: d })
    expect(result).toMatchObject({ status: 400, code: 'plan_mismatch' })
    expect(d.insertPlan).not.toHaveBeenCalled()
    expect(d.updatePlan).not.toHaveBeenCalled()
    expect(d.readSeed).not.toHaveBeenCalled()
  })
})
