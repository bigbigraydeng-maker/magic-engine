import { describe, it, expect } from 'vitest'
import { createFakeSupabase, type Row } from '@/lib/kernel/__tests__/fake-supabase'
import { loadAdsNextStepView } from '../load-ads-next-step'

const CLIENT = 'c0000000-0000-0000-0000-000000000000'
const D3 = 'ads.auto_pause_on_d3'
const O1 = 'ads.scale_unit_budget'

function narrativeWithHits(titles: string[]): Row {
  return {
    client_id: CLIENT,
    insight_date: '2026-11-01',
    payload: {
      portfolio_diagnoses: {
        diagnoses: titles.map((title, i) => ({
          code: `D${i + 1}`,
          status: 'hit',
          title,
          units: [],
          evidence: {},
          sample: [],
          reasons: [],
          clientVisible: true,
        })),
      },
    },
  }
}

describe('loadAdsNextStepView', () => {
  it('三块都有数据时合并成功', async () => {
    const decisionId = '11111111-1111-4111-8111-111111111111'
    const runId = '22222222-2222-4222-8222-222222222222'
    const sb = createFakeSupabase({
      ad_health_narratives: [narrativeWithHits(['花钱没结果', '投放卡住'])],
      action_runs: [{
        id: runId,
        client_id: CLIENT,
        action_key: D3,
        action_version: 1,
        idempotency_key: 'k1',
        status: 'pending_approval',
        authorization_decision_id: decisionId,
        input: { adset_id: 'adset-1', ad_account_id: 'act_1', insight_date: '2026-11-01' },
        rationale: 'D3 暂停建议',
        created_at: '2026-11-01T00:00:00Z',
      }],
      authorization_decisions: [{
        id: decisionId,
        action_run_id: runId,
        client_id: CLIENT,
        action_key: D3,
        action_version: 1,
        idempotency_key: 'k1',
        verdict: 'require_approval',
      }],
      flywheel_actions: [{
        id: '33333333-3333-4333-8333-333333333333',
        client_id: CLIENT,
        flywheel: 'ads',
        action_type: D3,
        payload: { action_run_id: runId, diagnosis_title: '连续花钱没留资' },
      }],
      prescriptions: [{
        client_id: CLIENT,
        version: 2,
        status: 'approved',
        approved_at: '2026-10-20T12:00:00Z',
        created_at: '2026-10-19T00:00:00Z',
      }],
    })

    const view = await loadAdsNextStepView(sb, CLIENT, { staffView: true })
    expect(view.healthRedLights).toEqual({
      kind: 'ok',
      data: { items: ['花钱没结果', '投放卡住'] },
    })
    expect(view.pendingActions.kind).toBe('ok')
    if (view.pendingActions.kind === 'ok') {
      expect(view.pendingActions.data.count).toBe(1)
      expect(view.pendingActions.data.items[0].summary).toContain('连续花钱')
      expect(view.pendingActions.data.items[0].href).toContain('tab=approvals')
    }
    expect(view.prescription).toEqual({
      kind: 'ok',
      data: { version: 2, statusLabel: '已批', approvedAt: '2026-10-20T12:00:00Z' },
    })
  })

  it('某块为空时显示 empty，不当作 0 或没读到', async () => {
    const sb = createFakeSupabase({
      ad_health_narratives: [{
        client_id: CLIENT,
        insight_date: '2026-11-01',
        payload: {
          portfolio_diagnoses: {
            diagnoses: [{
              code: 'D3',
              status: 'not_comparable',
              title: '判不了',
              units: [],
              evidence: {},
              sample: [],
              reasons: [],
              clientVisible: true,
            }],
          },
        },
      }],
      action_runs: [],
      authorization_decisions: [],
      flywheel_actions: [],
      prescriptions: [],
    })

    const view = await loadAdsNextStepView(sb, CLIENT, { staffView: true })
    expect(view.healthRedLights.kind).toBe('empty')
    expect(view.pendingActions.kind).toBe('empty')
    expect(view.prescription.kind).toBe('empty')
  })

  it('某块读失败时该行 unreadable，其它块不受影响', async () => {
    const sb = createFakeSupabase(
      {
        ad_health_narratives: [narrativeWithHits(['账户授权异常'])],
        action_runs: [],
        authorization_decisions: [],
        flywheel_actions: [],
        prescriptions: [{
          client_id: CLIENT,
          version: 1,
          status: 'draft',
          approved_at: null,
          created_at: '2026-11-01T00:00:00Z',
        }],
      },
      { failOn: [{ table: 'action_runs', op: 'select', message: 'timeout' }] },
    )

    const view = await loadAdsNextStepView(sb, CLIENT, { staffView: true })
    expect(view.healthRedLights.kind).toBe('ok')
    expect(view.pendingActions.kind).toBe('unreadable')
    expect(view.prescription.kind).toBe('ok')
  })
})
