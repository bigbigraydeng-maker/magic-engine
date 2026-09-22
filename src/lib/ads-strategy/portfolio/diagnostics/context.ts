/**
 * 诊断公共上下文：实体索引、角色、Meta 实验排除（§14 M7）、窗口内花费聚合。纯函数。
 */

import type { EntitySnapshotRow } from '../snapshot'
import { classifyAdsetRole, rollupCampaignRole, type Confidence, type FunnelRole, type RoleVerdict } from '../roles'
import type { AccountInput, DailyRow, DiagnosisUnit, ExcludedEntity } from './types'
import { WINDOW_DAYS } from './thresholds'

export function shiftDate(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + delta)
  return d.toISOString().slice(0, 10)
}

/** 账户时区某天结束的 UTC 时刻（毫秒）。时区缺失按 UTC。 */
export function localDayEndUtc(day: string, tz: string | null): number {
  const next = shiftDate(day, 1)
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  // 按 15 分钟步长找：半小时/45 分钟时区（如 Adelaide +9:30）也要切准（魏征复审）
  for (let offMin = -14 * 60; offMin <= 14 * 60; offMin += 15) {
    const t = Date.parse(`${next}T00:00:00Z`) - offMin * 60_000
    const p = fmt.formatToParts(new Date(t))
    const get = (k: string) => p.find(x => x.type === k)?.value
    if (`${get('year')}-${get('month')}-${get('day')}` === next && get('hour') === '00' && get('minute') === '00') return t - 1000
  }
  return Date.parse(`${day}T23:59:59Z`)
}

export function windowDays(date: string, days = WINDOW_DAYS): string[] {
  return Array.from({ length: days }, (_, i) => shiftDate(date, i - days + 1))
}

const DELIVERING = new Set(['ACTIVE', 'IN_PROCESS', 'WITH_ISSUES', 'PENDING_BILLING_INFO'])

export interface BudgetUnit {
  level: 'campaign' | 'adset'
  id: string
  name: string | null
  role: FunnelRole
  confidence: Confidence
  dailyBudgetMinor: number | null
  lifetimeBudgetMinor: number | null
  adsetIds: string[]
}

export interface AccountContext {
  account: AccountInput
  date: string
  window: string[]
  campaigns: Map<string, EntitySnapshotRow>
  adsets: Map<string, EntitySnapshotRow>
  ads: EntitySnapshotRow[]
  audiences: Map<string, EntitySnapshotRow>
  accountRow: EntitySnapshotRow | null
  roles: Map<string, RoleVerdict>
  /** 被 Meta 实验占用的广告组 / 系列 id（与评估窗口有重叠） */
  experimentIds: Set<string>
  excluded: ExcludedEntity[]
  /** 独立预算单位：CBO 系列 / ABO 广告组（不含实验中的） */
  budgetUnits: BudgetUnit[]
  /** 含 Meta 实验中的单位——只给账户级判断（D1 预算合计、D7 在投）用，花费和预算口径必须一致 */
  allBudgetUnits: BudgetUnit[]
}

function studyOverlaps(start: string | null, end: string | null, windowStartIso: string, windowEndIso: string): boolean {
  const s = start ? Date.parse(start) : -Infinity
  const e = end ? Date.parse(end) : Infinity
  return s <= Date.parse(windowEndIso) && e >= Date.parse(windowStartIso)
}

export function isDelivering(row: EntitySnapshotRow | undefined | null): boolean {
  return !!row && DELIVERING.has(row.effective_status ?? '')
}

export function buildAccountContext(account: AccountInput, date: string, windowLen = WINDOW_DAYS): AccountContext {
  const window = windowDays(date, windowLen)
  const byLevel = (level: string) => account.snapshots.filter(r => r.level === level)
  const campaigns = new Map(byLevel('campaign').map(r => [r.entity_id, r]))
  const adsets = new Map(byLevel('adset').map(r => [r.entity_id, r]))
  const audiences = new Map(byLevel('audience').map(r => [r.entity_id, r]))
  const accountRow = byLevel('account')[0] ?? null

  const roles = new Map<string, RoleVerdict>()
  for (const s of Array.from(adsets.values())) {
    roles.set(s.entity_id, classifyAdsetRole({ adset: s, campaign: s.campaign_id ? campaigns.get(s.campaign_id) ?? null : null, audiences }))
  }

  // §14 M7：窗口与实验时间有重叠就排除（实验开始前的数据也会被实验期的判断带偏，宁可整窗排除）
  const windowStartIso = new Date(localDayEndUtc(shiftDate(window[0], -1), account.timezone) + 1000).toISOString()
  const windowEndIso = new Date(localDayEndUtc(date, account.timezone)).toISOString()
  const experimentIds = new Set<string>()
  const excluded: ExcludedEntity[] = []
  for (const row of [...Array.from(campaigns.values()), ...Array.from(adsets.values())]) {
    const hit = row.ad_studies.find(st => studyOverlaps(st.start_time, st.end_time, windowStartIso, windowEndIso))
    if (!hit) continue
    experimentIds.add(row.entity_id)
    excluded.push({
      adAccountId: account.adAccountId,
      level: row.level === 'campaign' ? 'campaign' : 'adset',
      id: row.entity_id,
      name: row.entity_name,
      reason: 'meta_experiment',
      detail: `Meta 实验 ${hit.id}（${hit.type ?? '类型未知'}，${hit.start_time ?? '?'} → ${hit.end_time ?? '?'}）`,
    })
  }
  // 系列在实验中 → 其下广告组一并排除
  for (const s of Array.from(adsets.values())) {
    if (s.campaign_id && experimentIds.has(s.campaign_id) && !experimentIds.has(s.entity_id)) {
      experimentIds.add(s.entity_id)
      excluded.push({ adAccountId: account.adAccountId, level: 'adset', id: s.entity_id, name: s.entity_name, reason: 'meta_experiment', detail: `所属系列 ${s.campaign_id} 在 Meta 实验中` })
    }
  }

  const buildUnits = (skipExperiments: boolean): BudgetUnit[] => {
    const units: BudgetUnit[] = []
    for (const c of Array.from(campaigns.values())) {
      if (skipExperiments && experimentIds.has(c.entity_id)) continue
      const children = Array.from(adsets.values()).filter(s => s.campaign_id === c.entity_id && !(skipExperiments && experimentIds.has(s.entity_id)))
      if (c.budget_level === 'cbo') {
        const live = children.filter(isDelivering)
        const rolled = rollupCampaignRole((live.length > 0 ? live : children).map(s => roles.get(s.entity_id)!).filter(Boolean))
        units.push({ level: 'campaign', id: c.entity_id, name: c.entity_name, role: rolled.role, confidence: rolled.confidence, dailyBudgetMinor: c.daily_budget_minor, lifetimeBudgetMinor: c.lifetime_budget_minor, adsetIds: children.map(s => s.entity_id) })
      } else {
        for (const s of children) {
          const v = roles.get(s.entity_id)!
          units.push({ level: 'adset', id: s.entity_id, name: s.entity_name, role: v.role, confidence: v.confidence, dailyBudgetMinor: s.daily_budget_minor, lifetimeBudgetMinor: s.lifetime_budget_minor, adsetIds: [s.entity_id] })
        }
      }
    }
    return units
  }

  return {
    account, date, window, campaigns, adsets, ads: byLevel('ad'), audiences, accountRow, roles, experimentIds, excluded,
    budgetUnits: buildUnits(true),
    allBudgetUnits: buildUnits(false),
  }
}

/** 窗口内某些广告组的日行（adset 级）。 */
export function adsetRows(ctx: AccountContext, adsetIds: Iterable<string>, days: string[] = ctx.window): DailyRow[] {
  const ids = new Set(adsetIds)
  const inDays = new Set(days)
  return ctx.account.daily.filter(r => r.level === 'adset' && ids.has(r.entity_id) && inDays.has(r.insight_date))
}

export function sumSpend(rows: DailyRow[]): number {
  return Math.round(rows.reduce((s, r) => s + r.spend, 0) * 100) / 100
}

export function unitOf(ctx: AccountContext, level: 'campaign' | 'adset', id: string): DiagnosisUnit {
  const row = level === 'campaign' ? ctx.campaigns.get(id) : ctx.adsets.get(id)
  const verdict = level === 'adset' ? ctx.roles.get(id) : undefined
  return { level, id, name: row?.entity_name ?? null, adAccountId: ctx.account.adAccountId, role: verdict?.role, roleConfidence: verdict?.confidence }
}

/** 金额带币种（邮件里每个钱数都要带，板桥复审） */
export function money(ctx: AccountContext, n: number | null): string {
  return n === null ? '—' : `${ctx.account.currency ?? ''}${ctx.account.currency ? ' ' : ''}${n}`
}

export function minorToMajor(minor: number | null): number | null {
  return minor === null ? null : Math.round(minor) / 100
}
