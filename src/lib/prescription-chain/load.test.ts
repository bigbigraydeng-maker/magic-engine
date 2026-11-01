import { describe, expect, it } from 'vitest'
import { loadChainFacts, type ChainReader } from './load'

interface Result { data: unknown; error: { message: string } | null }

function reader(tables: Record<string, Result>): ChainReader {
  const built = {
    from(table: string) {
      const result = tables[table] ?? { data: null, error: { message: 'missing table' } }
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        limit: () => query,
        maybeSingle: () => Promise.resolve(result),
        then: (resolve: (value: Result) => unknown, reject?: (reason: unknown) => unknown) => (
          Promise.resolve(result).then(resolve, reject)
        ),
      }
      return query
    },
  }
  return built as ChainReader
}

const prescription = {
  status: 'draft',
  goal_id: 'goal-1',
  approved_at: null,
  error_message: null,
  intake: { business_goal: '推北岛', monthly_budget_aud: 100 },
  content: {
    phases: [{ initiative_seed: { ad_plays: [{ step_key: 'p1-1-lead', play: 'lead_form_harvest' }] } }],
    kpi_targets: [{ metric: '线索成本', target_value: 12, unit: 'NZD' }],
    review_anchor: '2026-10-01',
  },
}

describe('loadChainFacts', () => {
  it('turns a failed snapshot read into unread and does not invent a time', async () => {
    const facts = await loadChainFacts(reader({
      prescriptions: { data: prescription, error: null },
      goals: { data: { title: '线索目标', target_value: 1, baseline_value: 0, current_value: null, period_start: '2026-10-01', period_end: '2026-10-31' }, error: null },
      ad_strategy_configs: { data: null, error: { message: 'relation missing' } },
      marketing_plans: { data: [], error: null },
      content_work_orders: { data: [], error: null },
      execution_items: { data: [], error: null },
      ad_entity_snapshots: { data: null, error: { message: 'relation missing' } },
    }), { clientId: 'client-1', prescriptionId: 'rx-1', nowIso: '2026-10-26T12:00:00.000Z' })

    expect(facts.snapshot).toEqual({ read: 'unread' })
    expect(facts.strategy).toEqual({ read: 'unread' })
    expect(facts.outcome).toEqual({ read: 'unread' })
    expect(facts.prescription.read).toBe('ok')
    if (facts.prescription.read === 'ok' && facts.prescription.value) {
      expect(facts.prescription.value.targetCosts).toEqual([12])
      expect(facts.prescription.value.adPlayCount).toBe(1)
    }
  })

  it('treats a missing config row as unset, not as a failed read', async () => {
    const facts = await loadChainFacts(reader({
      prescriptions: { data: prescription, error: null },
      goals: { data: null, error: null },
      ad_strategy_configs: { data: null, error: null },
      marketing_plans: { data: [], error: null },
      content_work_orders: { data: [], error: null },
      execution_items: { data: [], error: null },
      ad_entity_snapshots: { data: null, error: null },
    }), { clientId: 'client-1', prescriptionId: 'rx-1', nowIso: '2026-10-26T12:00:00.000Z' })

    expect(facts.strategy).toEqual({ read: 'ok', value: { dailyCapCents: null, pool: [] } })
    expect(facts.outcome).toEqual({ read: 'ok', value: { configured: false, targetCostPerPrimary: null } })
    expect(facts.snapshot).toEqual({ read: 'ok', value: null })
    expect(facts.goal).toEqual({ read: 'ok', value: null })
  })

  it('does not treat a capped plan read as an empty list', async () => {
    const rows = Array.from({ length: 201 }, (_, index) => ({
      id: `plan-${index}`,
      status: 'draft',
      created_at: '2026-10-01T00:00:00.000Z',
      plan_data: {},
      generation_meta: null,
    }))
    const facts = await loadChainFacts(reader({
      prescriptions: { data: null, error: null },
      marketing_plans: { data: rows, error: null },
      execution_items: { data: [], error: null },
      ad_strategy_configs: { data: null, error: null },
      ad_entity_snapshots: { data: null, error: null },
    }), { clientId: 'client-1', prescriptionId: 'missing', nowIso: '2026-10-26T12:00:00.000Z' })

    expect(facts.prescription).toEqual({ read: 'ok', value: null })
    expect(facts.plans).toEqual({ read: 'unread' })
    expect(facts.goal).toEqual({ read: 'skipped' })
    expect(facts.workOrders).toEqual({ read: 'skipped' })
  })

  it('reads drafts from the client ledger and says unread when none can be linked', async () => {
    const tables = (itemIds: string[]): Record<string, Result> => ({
      prescriptions: { data: prescription, error: null },
      goals: { data: null, error: null },
      ad_strategy_configs: { data: null, error: null },
      marketing_plans: { data: [], error: null },
      content_work_orders: { data: [], error: null },
      execution_items: { data: itemIds.map((id) => ({ id })), error: null },
      flywheel_actions: {
        data: [{ id: 'a-1', execution_item_id: 'item-1', payload: { status: 'awaiting_approval', draft: { creatives: [{ videoId: 'video-1' }] } } }],
        error: null,
      },
      ad_entity_snapshots: { data: null, error: null },
    })
    const input = { clientId: 'client-1', prescriptionId: 'rx-1', nowIso: '2026-10-26T12:00:00.000Z' }
    const linked = await loadChainFacts(reader(tables(['item-1'])), input)
    const unlinked = await loadChainFacts(reader(tables([])), input)

    expect(linked.drafts).toEqual({ read: 'ok', value: [{ status: 'awaiting_approval' }] })
    expect(unlinked.drafts).toEqual({ read: 'unread' })
  })

  it('marks a non-list creative pool as unreadable instead of empty', async () => {
    const facts = await loadChainFacts(reader({
      prescriptions: { data: prescription, error: null },
      goals: { data: null, error: null },
      ad_strategy_configs: { data: { daily_budget_cap_cents: 5000, creative_pool: { bad: true }, target_cost_per_primary: 11 }, error: null },
      marketing_plans: { data: [], error: null },
      content_work_orders: { data: [], error: null },
      execution_items: { data: [], error: null },
      ad_entity_snapshots: { data: { captured_at: '2026-10-26T11:00:00.000Z' }, error: null },
    }), { clientId: 'client-1', prescriptionId: 'rx-1', nowIso: '2026-10-26T12:00:00.000Z' })

    expect(facts.strategy.read).toBe('ok')
    if (facts.strategy.read !== 'ok' || facts.strategy.value === null) throw new Error('strategy missing')
    expect(facts.strategy.value.dailyCapCents).toBe(5000)
    expect(facts.strategy.value.pool).toBeNull()
    expect(facts.snapshot).toEqual({ read: 'ok', value: { capturedAt: '2026-10-26T11:00:00.000Z' } })
  })
})
