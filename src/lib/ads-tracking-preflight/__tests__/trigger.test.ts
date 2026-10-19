import { describe, expect, it } from 'vitest'
import { buildTriggerEvent } from '../trigger'

const CONFIGURED = ['c1', 'c2']
const LAUNCHED = '2026-10-22T01:00:00.000Z'

describe('buildTriggerEvent · 手动触发入口：把请求洗成要发的事件', () => {
  it('开投前检查：必须点名一个已配置的客户；默认只演练（dry_run 为 true）', () => {
    const out = buildTriggerEvent({ kind: 'preflight', client_id: 'c1' }, CONFIGURED)
    expect(out).toEqual({
      ok: true, dry_run: true,
      event: { name: 'ads.tracking_preflight.requested', data: { client_id: 'c1', reason: 'manual' } },
    })
  })

  it('只有明确写 dry_run: false 才算真发；写 "false" / 0 / null / 不写都按演练', () => {
    expect(buildTriggerEvent({ kind: 'preflight', client_id: 'c1', dry_run: false }, CONFIGURED)).toMatchObject({ ok: true, dry_run: false })
    for (const dry_run of ['false', 0, null, undefined, 'no']) {
      expect(buildTriggerEvent({ kind: 'preflight', client_id: 'c1', dry_run }, CONFIGURED), String(dry_run)).toMatchObject({ ok: true, dry_run: true })
    }
  })

  it('叫醒原因可以写（限 40 字，只进日志），不写默认 manual', () => {
    const out = buildTriggerEvent({ kind: 'preflight', client_id: 'c1', reason: 'T-24h' }, CONFIGURED)
    expect(out).toMatchObject({ ok: true, event: { data: { reason: 'T-24h' } } })
    const long = buildTriggerEvent({ kind: 'preflight', client_id: 'c1', reason: 'x'.repeat(100) }, CONFIGURED)
    expect(long.ok && String(long.event.data.reason).length).toBeLessThanOrEqual(40)
  })

  it('开投后读回：要阶段（t1h / t24h）和开投时刻', () => {
    const out = buildTriggerEvent({ kind: 'postlaunch', client_id: 'c2', phase: 't24h', launched_at: LAUNCHED, dry_run: false }, CONFIGURED)
    expect(out).toEqual({
      ok: true, dry_run: false,
      event: { name: 'ads.tracking_postlaunch.requested', data: { client_id: 'c2', phase: 't24h', launched_at: LAUNCHED } },
    })
  })

  it('不允许「所有客户」：必须点名一个客户', () => {
    for (const body of [{ kind: 'preflight' }, { kind: 'preflight', client_id: '' }, { kind: 'preflight', client_id: 7 }]) {
      const out = buildTriggerEvent(body, CONFIGURED)
      expect(out.ok, JSON.stringify(body)).toBe(false)
    }
  })

  it('只配置了一个客户时，不点名也不行（不能因为「正好只有一个」就默认查它）', () => {
    for (const kind of ['preflight', 'postlaunch']) {
      const out = buildTriggerEvent({ kind, phase: 't1h', launched_at: LAUNCHED }, ['c1'])
      expect(out.ok, kind).toBe(false)
    }
  })

  it('没配置追踪检查的客户 → 拒绝并写明原因，不去猜', () => {
    const out = buildTriggerEvent({ kind: 'preflight', client_id: 'stranger' }, CONFIGURED)
    expect(out).toMatchObject({ ok: false, status: 400 })
    expect(!out.ok && out.error).toContain('配置')
  })

  it('kind 不对 / 开投后缺阶段、阶段不对、开投时间读不懂 → 拒绝', () => {
    const bads: unknown[] = [
      null, 'x', [], {},
      { kind: 'other', client_id: 'c1' },
      { kind: 'postlaunch', client_id: 'c1' },
      { kind: 'postlaunch', client_id: 'c1', phase: 't2h', launched_at: LAUNCHED },
      { kind: 'postlaunch', client_id: 'c1', phase: 't1h' },
      { kind: 'postlaunch', client_id: 'c1', phase: 't1h', launched_at: 'garbage' },
    ]
    for (const body of bads) {
      const out = buildTriggerEvent(body, CONFIGURED)
      expect(out.ok, JSON.stringify(body)).toBe(false)
      expect(!out.ok && out.error.length, JSON.stringify(body)).toBeGreaterThan(0)
    }
  })
})
