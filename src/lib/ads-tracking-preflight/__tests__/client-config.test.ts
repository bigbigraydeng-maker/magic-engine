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
      // 开投日未定时窗口要配得足够长，所以上限放宽到 60 天；开投后实际盯的时间从「第一次见到花费」起另算 96 小时
      expect(Number.isInteger(watch.days) && watch.days >= 1 && watch.days <= 60).toBe(true)
      if (watch.expected_launch_on !== undefined) {
        expect(watch.expected_launch_on).toMatch(/^\d{4}-\d{2}-\d{2}$/)
        expect(Number.isNaN(Date.parse(`${watch.expected_launch_on}T00:00:00Z`))).toBe(false)
      }
      expect(() => new Intl.DateTimeFormat('en-CA', { timeZone: watch.timezone })).not.toThrow()
      // 🔴 审查整改：花费只按本次投放的广告系列算，所以配了盯盘窗口就必须写清是哪几个系列
      expect(watch.campaign_ids.length, `${id} 盯盘必须写明广告系列`).toBeGreaterThan(0)
      for (const campaignId of watch.campaign_ids) expect(campaignId).toMatch(/^\d{6,20}$/)
      expect(new Set(watch.campaign_ids).size).toBe(watch.campaign_ids.length)
      for (const token of watch.campaign_name_contains ?? []) expect(token.length).toBeGreaterThan(0)
    }
  })

  it('CTS 的配置：官方账户、官网、两个落地页；预算数字不写死；盯盘本期不适用', () => {
    const cfg = getTrackingClientConfig('c0000000-0000-0000-0000-000000000000')
    expect(cfg).not.toBeNull()
    expect(cfg?.ad_account_id).toBe('act_2202695063810470')
    expect(cfg?.site_url).toBe('https://www.ctstours.co.nz')
    expect(cfg?.landing_targets.map(t => new URL(t.url).searchParams.get('utm_content'))).toEqual([
      'nc_a2_web_20261022',
      'nc_b3_web_20261022',
    ])
    expect(cfg?.landing_targets.every(t => new URL(t.url).pathname === '/tours/china/signature/landscapes')).toBe(true)
    // 🔴 预算数字不许写死（2026-10-21 事故：写死的 NZ$101 / NZ$110 与库里 NZ$150 的上限、NZ$134 的在投合计都不符，
    // 预算门拿两个旧常量互相比，「预算在上限内」成了假绿）。读库读线上的根本修复上线之前必须保持 null，
    // 门会如实判黄「没法核对」；谁把数字写回来，这里先红。
    expect(cfg?.planned_daily_budget_cents, 'CTS 计划日预算不许写死数字').toBeNull()
    expect(cfg?.official_daily_cap_cents, 'CTS 官方日上限不许写死数字').toBeNull()
    expect(cfg?.currency).toBe('NZD')
    // 开投后盯盘本期不适用（上一期系列已暂停；本期目标是播放量 / WhatsApp，现有读回不适用）。
    // 没配 = 盯盘函数、今日待办都不盯，不会去读一个已暂停的系列。
    expect(cfg?.launch_watch).toBeUndefined()
    expect(cfg?.known_issues).toBeUndefined()
  })

  it('盯盘窗口（如果配了预计开投日）：预计开投日必须落在窗口里（不然「找不到系列」的待办永远不会出，或开投当天就在窗口外）', () => {
    for (const id of listTrackingClientIds()) {
      const watch = getTrackingClientConfig(id)?.launch_watch
      if (!watch || watch.expected_launch_on === undefined) continue
      const last = new Date(Date.parse(`${watch.from}T00:00:00Z`) + (watch.days - 1) * 86_400_000).toISOString().slice(0, 10)
      expect(watch.expected_launch_on >= watch.from, `${id} 预计开投日早于窗口起点`).toBe(true)
      expect(watch.expected_launch_on <= last, `${id} 预计开投日晚于窗口终点`).toBe(true)
    }
  })
})
