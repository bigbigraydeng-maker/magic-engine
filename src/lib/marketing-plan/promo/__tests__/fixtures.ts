/** 测试夹具：全部虚构（客户 / 账户 / 日期），不含任何真实客户信息。 */
import type { PromoSpec } from '../spec'
import { DEFAULT_PROMO_PLAYBOOK } from '../playbooks'
import { promoContentHash } from '../content-hash'
import { evaluateApproval as realEvaluateApproval, evaluatePhaseGates as realEvaluatePhaseGates, type GateFacts } from '../gates'
import type { ReconcileFacts } from '../reconcile'

export function baseSpec(overrides: Partial<PromoSpec> = {}): PromoSpec {
  return {
    schema: 'promo_v1',
    goal_id: 'goal-1',
    phases: [
      {
        id: 'p1', name: '阶段 1', start_date: '2026-11-01', end_date: '2026-11-14',
        steps: [
          { id: 's-ads', kind: 'ads_campaign', settings: {
            ad_account_id: 'act_1', daily_budget_cents: 5000, audience_ref: 'aud-1',
            creative_refs: ['vid-1'], placements: [], paused_ranges: [] } },
          { id: 's-soc', kind: 'social_cadence', settings: { posts_per_week: 3, stories_per_week: 2, reels_per_month: 0 } },
        ],
      },
      { id: 'p2', name: '阶段 2', start_date: '2026-11-15', end_date: '2026-11-30', steps: [] },
    ],
    checks: [],
    ...overrides,
  }
}

export const NOW = new Date('2026-10-30T00:00:00Z')

export function goodFacts(overrides: Partial<GateFacts> = {}): GateFacts {
  return {
    today: '2026-10-30', now: NOW, playbook: DEFAULT_PROMO_PLAYBOOK,
    accounts: [{ ad_account_id: 'act_1', currency: 'AUD', daily_cap_cents: 10000, owned_by_client: true }],
    snapshots: { act_1: { account_status: 1, captured_at: '2026-10-29T00:00:00Z' } },
    config: { daily_budget_cap_cents: 20000, primary_result: 'leads', creative_pool: [{ ref: 'vid-1', status: 'approved' }] },
    daily_plan_coverage_days: 10,
    manual_checks: [],
    ...overrides,
  }
}

export function goodReconFacts(overrides: Partial<ReconcileFacts> = {}): ReconcileFacts {
  return {
    spend_cents_by_account_day: { act_1: {} },
    meta_results: 12,
    goal: {
      status: 'active', target_value: 100, baseline_value: 0,
      period_start: '2026-11-01', period_end: '2026-11-30',
      current_value: 38, current_value_fetched_at: '2026-11-15T00:00:00Z',
    },
    content_published: 5,
    insights_as_of: '2026-11-15T00:00:00Z',
    timezone_known: true,
    ...overrides,
  }
}

/** 测试便利：把夹具 spec.checks 当作服务端核实记录并入 facts（生产里 spec.checks 不参与判定）。 */
const foldChecks = (spec: PromoSpec, f: GateFacts): GateFacts => ({
  ...f,
  manual_checks: [...spec.checks.map(c => ({ ...c, content_hash: c.content_hash ?? promoContentHash(spec) })), ...f.manual_checks],
})
export const evaluateApproval = (spec: PromoSpec, f: GateFacts) => realEvaluateApproval(spec, foldChecks(spec, f))
export const evaluatePhaseGates = (spec: PromoSpec, phase: PromoSpec['phases'][number], f: GateFacts) =>
  realEvaluatePhaseGates(spec, phase, foldChecks(spec, f))
