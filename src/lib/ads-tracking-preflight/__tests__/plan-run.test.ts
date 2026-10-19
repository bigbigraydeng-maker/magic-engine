import { describe, expect, it } from 'vitest'
import { planRun } from '../plan-run'

const CONFIGURED = ['client-a', 'client-b']
const PREFLIGHT_EVENT = 'ads.tracking_preflight.requested'
const POSTLAUNCH_EVENT = 'ads.tracking_postlaunch.requested'

describe('planRun · 这一轮要查谁、查什么（把事件内容先洗一遍）', () => {
  it('定时触发 / 不认识的事件名 → 查所有配置了的客户，类型是 cron', () => {
    for (const eventName of ['inngest/scheduled.timer', 'whatever']) {
      expect(planRun({ eventName, data: undefined, configuredClientIds: CONFIGURED })).toEqual({
        trigger: 'cron', phase: 'preflight', clientIds: CONFIGURED, launchedAt: null, error: null,
      })
    }
  })

  it('开投前检查事件不带 client_id → 所有配置了的客户；带了就只查那一个', () => {
    expect(planRun({ eventName: PREFLIGHT_EVENT, data: {}, configuredClientIds: CONFIGURED }).clientIds).toEqual(CONFIGURED)
    const one = planRun({ eventName: PREFLIGHT_EVENT, data: { client_id: 'client-b', reason: 'T-24h' }, configuredClientIds: CONFIGURED })
    expect(one).toEqual({ trigger: 'requested', phase: 'preflight', clientIds: ['client-b'], launchedAt: null, error: null })
  })

  it('指定的客户没配置追踪检查 → 不查，写明原因（不替它猜）', () => {
    const plan = planRun({ eventName: PREFLIGHT_EVENT, data: { client_id: 'stranger' }, configuredClientIds: CONFIGURED })
    expect(plan.clientIds).toEqual([])
    expect(plan.error).toContain('配置')
  })

  it('client_id 不是字符串 → 当作格式错误，不查任何客户', () => {
    const plan = planRun({ eventName: PREFLIGHT_EVENT, data: { client_id: 42 }, configuredClientIds: CONFIGURED })
    expect(plan.clientIds).toEqual([])
    expect(plan.error).toBeTruthy()
  })

  it('开投后读回：1 小时 / 24 小时两种，带开投时间', () => {
    const t1 = planRun({ eventName: POSTLAUNCH_EVENT, data: { client_id: 'client-a', phase: 't1h', launched_at: '2026-10-22T01:00:00Z' }, configuredClientIds: CONFIGURED })
    expect(t1).toEqual({ trigger: 'postlaunch', phase: 'post_t1h', clientIds: ['client-a'], launchedAt: '2026-10-22T01:00:00Z', error: null })
    const t24 = planRun({ eventName: POSTLAUNCH_EVENT, data: { client_id: 'client-a', phase: 't24h', launched_at: '2026-10-22T01:00:00Z' }, configuredClientIds: CONFIGURED })
    expect(t24.phase).toBe('post_t24h')
  })

  it('开投后读回的事件缺东西 / 阶段不对 / 开投时间读不懂 / 客户没配置 → 不查，写明原因', () => {
    const base = { client_id: 'client-a', phase: 't1h', launched_at: '2026-10-22T01:00:00Z' }
    const bads: unknown[] = [
      undefined, null, 'x', {},
      { ...base, client_id: undefined },
      { ...base, phase: 't2h' },
      { ...base, launched_at: 'garbage' },
      { ...base, launched_at: undefined },
      { ...base, client_id: 'stranger' },
    ]
    for (const data of bads) {
      const plan = planRun({ eventName: POSTLAUNCH_EVENT, data, configuredClientIds: CONFIGURED })
      expect(plan.trigger, JSON.stringify(data)).toBe('postlaunch')
      expect(plan.clientIds, JSON.stringify(data)).toEqual([])
      expect(plan.launchedAt, JSON.stringify(data)).toBeNull()
      expect(plan.error, JSON.stringify(data)).toBeTruthy()
    }
  })
})
