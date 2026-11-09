import { describe, expect, it } from 'vitest'
import { planRun } from '../plan-run'

const CONFIGURED = ['client-a', 'client-b']
const NOW = new Date('2026-10-22T02:00:00.000Z')
const HOUR = 3_600_000
const PREFLIGHT_EVENT = 'ads.tracking_preflight.requested'
const POSTLAUNCH_EVENT = 'ads.tracking_postlaunch.requested'

describe('planRun · 这一轮要查谁、查什么（把事件内容先洗一遍）', () => {
  it('定时触发 / 不认识的事件名 → 查所有配置了的客户，类型是 cron', () => {
    for (const eventName of ['inngest/scheduled.timer', 'whatever']) {
      expect(planRun({ eventName, data: undefined, configuredClientIds: CONFIGURED, now: NOW })).toEqual({
        trigger: 'cron', phase: 'preflight', clientIds: CONFIGURED, launchedAt: null, error: null,
      })
    }
  })

  it('开投前检查事件不带 client_id → 所有配置了的客户；带了就只查那一个', () => {
    expect(planRun({ eventName: PREFLIGHT_EVENT, data: {}, configuredClientIds: CONFIGURED, now: NOW }).clientIds).toEqual(CONFIGURED)
    const one = planRun({ eventName: PREFLIGHT_EVENT, data: { client_id: 'client-b', reason: 'T-24h' }, configuredClientIds: CONFIGURED, now: NOW })
    expect(one).toEqual({ trigger: 'requested', phase: 'preflight', clientIds: ['client-b'], launchedAt: null, error: null })
  })

  it('指定的客户没配置追踪检查 → 不查，写明原因（不替它猜）', () => {
    const plan = planRun({ eventName: PREFLIGHT_EVENT, data: { client_id: 'stranger' }, configuredClientIds: CONFIGURED, now: NOW })
    expect(plan.clientIds).toEqual([])
    expect(plan.error).toContain('配置')
  })

  it('client_id 不是字符串 → 当作格式错误，不查任何客户', () => {
    const plan = planRun({ eventName: PREFLIGHT_EVENT, data: { client_id: 42 }, configuredClientIds: CONFIGURED, now: NOW })
    expect(plan.clientIds).toEqual([])
    expect(plan.error).toBeTruthy()
  })

  it('开投后读回：1 小时 / 24 小时两种，带开投时间', () => {
    const t1 = planRun({ eventName: POSTLAUNCH_EVENT, data: { client_id: 'client-a', phase: 't1h', launched_at: '2026-10-22T01:00:00Z' }, configuredClientIds: CONFIGURED, now: NOW })
    expect(t1).toEqual({ trigger: 'postlaunch', phase: 'post_t1h', clientIds: ['client-a'], launchedAt: '2026-10-22T01:00:00Z', error: null })
    const t24 = planRun({ eventName: POSTLAUNCH_EVENT, data: { client_id: 'client-a', phase: 't24h', launched_at: '2026-10-22T01:00:00Z' }, configuredClientIds: CONFIGURED, now: NOW })
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
      const plan = planRun({ eventName: POSTLAUNCH_EVENT, data, configuredClientIds: CONFIGURED, now: NOW })
      expect(plan.trigger, JSON.stringify(data)).toBe('postlaunch')
      expect(plan.clientIds, JSON.stringify(data)).toEqual([])
      expect(plan.launchedAt, JSON.stringify(data)).toBeNull()
      expect(plan.error, JSON.stringify(data)).toBeTruthy()
    }
  })

  // 🔴 审查整改：开投时间必须是合理的时间。事件是外面发进来的，一个写错的年份会让读回去读一整年的数据
  it('开投时间不得晚于现在（允许 5 分钟的时钟误差）：晚 5 分钟以内放行，再晚就拒绝', () => {
    const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs).toISOString()
    const plan = (launchedAt: string) => planRun({
      eventName: POSTLAUNCH_EVENT, data: { client_id: 'client-a', phase: 't1h', launched_at: launchedAt },
      configuredClientIds: CONFIGURED, now: NOW,
    })
    expect(plan(at(5 * 60_000)).error).toBeNull()
    const tooLate = plan(at(5 * 60_000 + 1000))
    expect(tooLate.error).toContain('晚于现在')
    expect(tooLate.clientIds).toEqual([])
    expect(tooLate.launchedAt).toBeNull()
  })

  it('开投时间不得早于 7 天前：刚好 7 天放行，再早就拒绝', () => {
    const at = (offsetMs: number) => new Date(NOW.getTime() - offsetMs).toISOString()
    const plan = (launchedAt: string) => planRun({
      eventName: POSTLAUNCH_EVENT, data: { client_id: 'client-a', phase: 't24h', launched_at: launchedAt },
      configuredClientIds: CONFIGURED, now: NOW,
    })
    expect(plan(at(7 * 24 * HOUR)).error).toBeNull()
    const tooOld = plan(at(7 * 24 * HOUR + 1000))
    expect(tooOld.error).toContain('7 天')
    expect(tooOld.clientIds).toEqual([])
  })

  it('写成别的年份 / 纪元 0 这类明显不合理的开投时间 → 拒绝', () => {
    for (const launched_at of ['2025-10-22T01:00:00Z', '2027-10-22T01:00:00Z', '1970-01-01T00:00:00Z']) {
      const plan = planRun({
        eventName: POSTLAUNCH_EVENT, data: { client_id: 'client-a', phase: 't1h', launched_at },
        configuredClientIds: CONFIGURED, now: NOW,
      })
      expect(plan.error, launched_at).toBeTruthy()
      expect(plan.clientIds, launched_at).toEqual([])
    }
  })
})
