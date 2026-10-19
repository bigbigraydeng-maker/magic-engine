import { describe, expect, it } from 'vitest'
import { getTrackingClientConfig, listTrackingClientIds } from '../client-config'
import { isProbeUrlAllowed } from '../landing-probe'
import { PREFLIGHT_GATE_KEYS } from '../types'

describe('客户配置（L4）', () => {
  it('没配置的客户 → null（不适用，绝不替它猜）', () => {
    expect(getTrackingClientConfig('00000000-0000-0000-0000-00000000dead')).toBeNull()
    expect(getTrackingClientConfig('')).toBeNull()
  })

  it('每个已配置的客户：账户编号带 act_、官网和落地页都在同一个官网主机上、金额是正整数分', () => {
    const ids = listTrackingClientIds()
    expect(ids.length).toBeGreaterThan(0)
    for (const id of ids) {
      const cfg = getTrackingClientConfig(id)
      expect(cfg, id).not.toBeNull()
      if (!cfg) continue
      expect(cfg.ad_account_id).toMatch(/^act_\d{6,20}$/)
      expect(cfg.landing_targets.length).toBeGreaterThan(0)
      for (const target of cfg.landing_targets) {
        expect(isProbeUrlAllowed(target.url, cfg.site_url), `${id} ${target.label}`).toBe(true)
        expect(new URL(target.url).searchParams.has('utm_content'), target.url).toBe(true)
      }
      expect(cfg.ga4_lead_events.length).toBeGreaterThan(0)
      expect(Number.isInteger(cfg.planned_daily_budget_cents ?? 1)).toBe(true)
      expect(Number.isInteger(cfg.official_daily_cap_cents ?? 1)).toBe(true)
      expect(cfg.currency).toMatch(/^[A-Z]{3}$/)
    }
  })

  it('已知问题只能指向真实存在的门，日期格式正确、到期晚于盘点日', () => {
    for (const id of listTrackingClientIds()) {
      for (const issue of getTrackingClientConfig(id)?.known_issues ?? []) {
        expect([...PREFLIGHT_GATE_KEYS, 'post.t1h', 'post.t24h']).toContain(issue.gate)
        expect(issue.observed_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(issue.expires_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(issue.expires_on > issue.observed_on).toBe(true)
        expect(issue.note.length).toBeGreaterThan(0)
      }
    }
  })

  it('盯盘窗口（如果配了）：起始日期格式对、天数合理、时区是真实存在的', () => {
    for (const id of listTrackingClientIds()) {
      const watch = getTrackingClientConfig(id)?.launch_watch
      if (!watch) continue
      expect(watch.from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(Date.parse(`${watch.from}T00:00:00Z`))).toBe(false)
      expect(Number.isInteger(watch.days) && watch.days >= 1 && watch.days <= 14).toBe(true)
      expect(() => new Intl.DateTimeFormat('en-CA', { timeZone: watch.timezone })).not.toThrow()
    }
  })

  it('CTS 这次开投的配置：官方账户、官网、两个落地页、预算数字', () => {
    const cfg = getTrackingClientConfig('c0000000-0000-0000-0000-000000000000')
    expect(cfg).not.toBeNull()
    expect(cfg?.ad_account_id).toBe('act_2202695063810470')
    expect(cfg?.site_url).toBe('https://www.ctstours.co.nz')
    expect(cfg?.landing_targets.map(t => new URL(t.url).searchParams.get('utm_content'))).toEqual([
      'nc_a2_web_20261022',
      'nc_b3_web_20261022',
    ])
    expect(cfg?.landing_targets.every(t => new URL(t.url).pathname === '/tours/china/signature/landscapes')).toBe(true)
    expect(cfg?.planned_daily_budget_cents).toBe(10100)
    expect(cfg?.official_daily_cap_cents).toBe(11000)
    expect(cfg?.currency).toBe('NZD')
    expect(cfg?.launch_watch).toEqual({ from: '2026-10-22', days: 4, timezone: 'Pacific/Auckland' })
    expect(cfg?.known_issues).toBeUndefined()
  })
})
