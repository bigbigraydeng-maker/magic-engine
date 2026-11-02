import { describe, it, expect } from 'vitest'
import { createFakeSupabase, type Row } from '@/lib/kernel/__tests__/fake-supabase'
import { loadAdsNextStepView, o1PendingMatchesGrowthCycleDate } from '../load-ads-next-step'

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

describe('o1PendingMatchesGrowthCycleDate', () => {
  it('evidence.date 须与 growth 巡察日一致', () => {
    expect(o1PendingMatchesGrowthCycleDate({ evidence: { date: '2026-11-02' } }, '2026-11-02')).toBe(true)
    expect(o1PendingMatchesGrowthCycleDate({ evidence: { date: '2026-11-01' } }, '2026-11-02')).toBe(false)
    expect(o1PendingMatchesGrowthCycleDate({ evidence: {} }, '2026-11-02')).toBe(false)
  })
})

describe('loadAdsNextStepView', () => {
  it('三块都有数据时合并成功', async () => {
    const decisionId = '11111111-1111-4111-8111-111111111111'
    const runId = '22222222-2222-4222-8222-222222222222'
    const sb = createFakeSupabase({
      ad_health_narratives: [narrativeWithHits(['花钱没结果', '投放卡住'])],
      ads_growth_states: [],
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
      ads_growth_states: [],
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
        ads_growth_states: [],
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

  it('ads_growth_states 读失败 → 待批 unreadable，不当成没有待批', async () => {
    const o1Decision = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const o1Run = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
    const sb = createFakeSupabase(
      {
        ad_health_narratives: [narrativeWithHits(['账户授权异常'])],
        ads_growth_states: [{ client_id: CLIENT, date: '2026-11-02' }],
        action_runs: [{
          id: o1Run,
          client_id: CLIENT,
          action_key: O1,
          action_version: 1,
          idempotency_key: 'k-growth-down',
          status: 'pending_approval',
          authorization_decision_id: o1Decision,
          input: { adset_id: 'adset-1', ad_account_id: 'act_1' },
          evidence: { date: '2026-11-02' },
          rationale: '加预算还在等批准',
          created_at: '2026-11-02T00:00:00Z',
        }],
        authorization_decisions: [{
          id: o1Decision,
          action_run_id: o1Run,
          client_id: CLIENT,
          action_key: O1,
          action_version: 1,
          idempotency_key: 'k-growth-down',
          verdict: 'require_approval',
        }],
        flywheel_actions: [],
        prescriptions: [{
          client_id: CLIENT,
          version: 1,
          status: 'draft',
          approved_at: null,
          created_at: '2026-11-01T00:00:00Z',
        }],
      },
      { failOn: [{ table: 'ads_growth_states', op: 'select', message: 'timeout' }] },
    )

    const view = await loadAdsNextStepView(sb, CLIENT, { staffView: true })
    expect(view.healthRedLights.kind).toBe('ok')
    expect(view.pendingActions.kind).toBe('unreadable')
    expect(view.prescription.kind).toBe('ok')
  })

  it('ad_health_narratives 读失败 → 体检红灯 unreadable', async () => {
    const sb = createFakeSupabase(
      {
        ad_health_narratives: [narrativeWithHits(['x'])],
        ads_growth_states: [],
        action_runs: [],
        authorization_decisions: [],
        flywheel_actions: [],
        prescriptions: [],
      },
      { failOn: [{ table: 'ad_health_narratives', op: 'select', message: 'down' }] },
    )
    const view = await loadAdsNextStepView(sb, CLIENT, { staffView: true })
    expect(view.healthRedLights.kind).toBe('unreadable')
    expect(view.pendingActions.kind).toBe('empty')
  })

  it('prescriptions 读失败 → 处方 unreadable', async () => {
    const sb = createFakeSupabase(
      {
        ad_health_narratives: [],
        action_runs: [],
        authorization_decisions: [],
        flywheel_actions: [],
        prescriptions: [{ client_id: CLIENT, version: 1, status: 'draft', created_at: '2026-11-01' }],
      },
      { failOn: [{ table: 'prescriptions', op: 'select', message: 'down' }] },
    )
    const view = await loadAdsNextStepView(sb, CLIENT, { staffView: true })
    expect(view.prescription.kind).toBe('unreadable')
  })

  it('最新 rejected 处方会显示「已驳回」而不是更早的 approved', async () => {
    const sb = createFakeSupabase({
      ad_health_narratives: [],
      action_runs: [],
      authorization_decisions: [],
      flywheel_actions: [],
      prescriptions: [
        {
          client_id: CLIENT,
          version: 3,
          status: 'rejected',
          approved_at: null,
          created_at: '2026-11-02T00:00:00Z',
        },
        {
          client_id: CLIENT,
          version: 2,
          status: 'approved',
          approved_at: '2026-10-01T00:00:00Z',
          created_at: '2026-10-01T00:00:00Z',
        },
      ],
    })
    const view = await loadAdsNextStepView(sb, CLIENT, { staffView: true })
    expect(view.prescription).toEqual({
      kind: 'ok',
      data: { version: 3, statusLabel: '已驳回', approvedAt: null },
    })
  })

  it('paid_client 看不到 O1 内核 rationale，只用通用文案', async () => {
    const decisionId = '44444444-4444-4444-8444-444444444444'
    const runId = '55555555-5555-4555-8555-555555555555'
    const sb = createFakeSupabase({
      ad_health_narratives: [],
      ads_growth_states: [{ client_id: CLIENT, date: '2026-11-01' }],
      action_runs: [{
        id: runId,
        client_id: CLIENT,
        action_key: O1,
        action_version: 1,
        idempotency_key: 'k-o1',
        status: 'pending_approval',
        authorization_decision_id: decisionId,
        input: { adset_id: 'adset-1', ad_account_id: 'act_1' },
        evidence: { date: '2026-11-01' },
        rationale: '内部才该看到的 O1 依据句',
        created_at: '2026-11-01T00:00:00Z',
      }],
      authorization_decisions: [{
        id: decisionId,
        action_run_id: runId,
        client_id: CLIENT,
        action_key: O1,
        action_version: 1,
        idempotency_key: 'k-o1',
        verdict: 'require_approval',
      }],
      flywheel_actions: [],
      prescriptions: [],
    })
    const staff = await loadAdsNextStepView(sb, CLIENT, { staffView: true })
    const client = await loadAdsNextStepView(sb, CLIENT, { staffView: false })
    expect(staff.pendingActions.kind).toBe('ok')
    expect(client.pendingActions.kind).toBe('empty')
    if (staff.pendingActions.kind === 'ok') {
      expect(staff.pendingActions.data.items[0].summary).toContain('内部才该看到')
    }
  })

  it('staffView=false 不读 portfolio_diagnoses，返回 staff_only', async () => {
    const sb = createFakeSupabase(
      {
        ad_health_narratives: [narrativeWithHits(['内部 D11 不应下发'])],
        action_runs: [],
        authorization_decisions: [],
        flywheel_actions: [],
        prescriptions: [],
      },
      { failOn: [{ table: 'ad_health_narratives', op: 'select', message: 'must not query' }] },
    )
    const view = await loadAdsNextStepView(sb, CLIENT, { staffView: false })
    expect(view.healthRedLights).toEqual({ kind: 'staff_only' })
  })

  it('staffView=true 时员工可见仅内部诊断（clientVisible:false 仍列出）', async () => {
    const sb = createFakeSupabase({
      ad_health_narratives: [{
        client_id: CLIENT,
        insight_date: '2026-11-01',
        payload: {
          portfolio_diagnoses: {
            diagnoses: [
              {
                code: 'D11',
                status: 'hit',
                title: '人群池异常',
                units: [],
                evidence: {},
                sample: [],
                reasons: [],
                clientVisible: false,
              },
              {
                code: 'D7',
                status: 'hit',
                title: '读不到这个广告账户',
                units: [],
                evidence: {},
                sample: [],
                reasons: [],
                clientVisible: false,
              },
            ],
          },
        },
      }],
      action_runs: [],
      authorization_decisions: [],
      flywheel_actions: [],
      prescriptions: [],
    })
    const view = await loadAdsNextStepView(sb, CLIENT, { staffView: true })
    expect(view.healthRedLights).toEqual({
      kind: 'ok',
      data: { items: ['人群池异常', '读不到这个广告账户'] },
    })
  })

  it('staffView=false 不列出 O1 待批（即使库里有）', async () => {
    const o1Decision = '66666666-6666-4666-8666-666666666666'
    const o1Run = '77777777-7777-4777-8777-777777777777'
    const sb = createFakeSupabase({
      ad_health_narratives: [],
      ads_growth_states: [{ client_id: CLIENT, date: '2026-11-02' }],
      action_runs: [{
        id: o1Run,
        client_id: CLIENT,
        action_key: O1,
        action_version: 1,
        idempotency_key: 'k-o1-only',
        status: 'pending_approval',
        authorization_decision_id: o1Decision,
        input: { adset_id: 'adset-1', ad_account_id: 'act_1' },
        evidence: { date: '2026-11-02' },
        rationale: 'secret',
        created_at: '2026-11-01T00:00:00Z',
      }],
      authorization_decisions: [{
        id: o1Decision,
        action_run_id: o1Run,
        client_id: CLIENT,
        action_key: O1,
        action_version: 1,
        idempotency_key: 'k-o1-only',
        verdict: 'require_approval',
      }],
      flywheel_actions: [],
      prescriptions: [],
    })
    const view = await loadAdsNextStepView(sb, CLIENT, { staffView: false })
    expect(view.pendingActions.kind).toBe('empty')
  })

  it('O1 待批日与当前 growth 巡察日不一致时不进合并卡', async () => {
    const o1Decision = '88888888-8888-4888-8888-888888888888'
    const o1Run = '99999999-9999-4999-8999-999999999999'
    const sb = createFakeSupabase({
      ad_health_narratives: [],
      ads_growth_states: [{ client_id: CLIENT, date: '2026-11-02' }],
      action_runs: [{
        id: o1Run,
        client_id: CLIENT,
        action_key: O1,
        action_version: 1,
        idempotency_key: 'k-stale',
        status: 'pending_approval',
        authorization_decision_id: o1Decision,
        input: { adset_id: 'adset-1', ad_account_id: 'act_1' },
        evidence: { date: '2026-11-01' },
        rationale: '旧日 O1',
        created_at: '2026-11-01T00:00:00Z',
      }],
      authorization_decisions: [{
        id: o1Decision,
        action_run_id: o1Run,
        client_id: CLIENT,
        action_key: O1,
        action_version: 1,
        idempotency_key: 'k-stale',
        verdict: 'require_approval',
      }],
      flywheel_actions: [],
      prescriptions: [],
    })
    const view = await loadAdsNextStepView(sb, CLIENT, { staffView: true })
    expect(view.pendingActions.kind).toBe('empty')
  })
})
