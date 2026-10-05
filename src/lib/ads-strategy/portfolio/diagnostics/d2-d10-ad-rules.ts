/**
 * 广告级只读规则：D2 素材疲劳 / D10 点进去之后差了。
 *
 * 设计见 docs/specs/2026-09-26-ads-ad-level-rules-d2-d10-design.md。
 * 🔴 只读：只出结论与证据，不出挪预算处方。
 * 🔴 不进自动暂停——自动暂停那边只认 D3。
 */

import type { AccountContext } from './context'
import { adsetRows, isDelivering, money, shiftDate, sumSpend, unitOf, windowDays } from './context'
import { countOutcome } from '../outcome-ladder'
import { benjaminiHochberg } from './d5-budget-result-mismatch'
import type { EntitySnapshotRow } from '../snapshot'
import type { AdLevelCoverage, CheckBack, DailyRow, Diagnosis, DiagnosisInput, DiagnosisUnit } from './types'
import { CORE_METRIC_NOUN, isClickDrivenGoal, resolveCoreMetric, type CoreMetric } from '../../rules/core-metric'
import { classifyFatigue, D2_CTR_SIGNAL_FLOOR, D2_MIN_BASE_IMPRESSIONS, D2_MIN_CTR_DROP, D2_MIN_RECENT_IMPRESSIONS, FATIGUE_FREQUENCY_HIGH, type FatigueKind } from '../../rules/fatigue'
import {
  costPerResult, judgeStep, sumDays,
  D10_MIN_BASE_LINK_CLICKS, D10_MIN_BASE_RESULTS, D10_MIN_COST_MULTIPLE, D10_MIN_CVR_DROP,
  RULE_BASELINE_DAYS, RULE_BH_Q, RULE_HONEYMOON_DAYS, RULE_MIN_BASELINE_ACTIVE_DAYS, RULE_MIN_EXPECTED,
  RULE_MIN_PERSISTENT_DAYS, RULE_MIN_SHARE_OF_ADSET_SPEND, RULE_RECENT_DAYS, SAMPLE_NOTE_COST_MULTIPLE,
  type FunnelDay, type FunnelTotals, type StepVerdict,
} from '../../rules/funnel'

interface OutcomeOpts {
  messagingReferralAvailable: boolean
  optimizationGoal: string | null
}

interface AdCase {
  ad: EntitySnapshotRow
  adset: EntitySnapshotRow
  metric: CoreMetric | null
  opts: OutcomeOpts
  recent: FunnelDay[]
  recentTotals: FunnelTotals
  dropped: number
  firstDelivery: string
  isNewAd: boolean
  changeDate: string | null
  learningNow: boolean
  ownBaseRaw: FunnelDay[] | null
  ownBase: FunnelDay[] | null
}

interface Candidate {
  code: 'D2' | 'D10'
  p: number
  build: (adjustedP: number) => Diagnosis
}

interface RuleResult {
  candidate?: Candidate
  note?: Diagnosis
}

type BaselineChoice =
  | { kind: 'base'; base: FunnelTotals; source: 'own_history' | 'same_adset_peers'; peerCount: number | null }
  | { kind: 'learning' }

/** 设置真改过之后，这么多天内的数据算学习期：不进自身对照；近期窗落在学习期里就先不判。 */
export const RULE_LEARNING_DAYS = 7

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function round(value: number, dp: number): number {
  const f = 10 ** dp
  return Math.round(value * f) / f
}

function linkClicksOf(row: DailyRow): number {
  if (!row.actions) return 0
  const hit = row.actions.find(a => a.action_type === 'link_click')
  if (!hit) return 0
  const n = Number(hit.value)
  return Number.isFinite(n) ? n : 0
}

function toFunnelDay(row: DailyRow, metric: CoreMetric | null, opts: OutcomeOpts): FunnelDay | null {
  const linkClicks = linkClicksOf(row)
  let results: number | null
  if (row.actions === null) {
    if (row.clicks > 0) return null
    results = metric ? 0 : null
  } else if (metric) {
    const c = countOutcome(metric, row, opts)
    if (c.value === null) return null
    results = c.value
  } else {
    results = null
  }
  return {
    date: row.insight_date,
    spend: row.spend,
    impressions: row.impressions,
    clicks: row.clicks,
    linkClicks,
    results,
  }
}

function series(rows: readonly DailyRow[], days: readonly string[], metric: CoreMetric | null, opts: OutcomeOpts): { days: FunnelDay[]; dropped: number } {
  const inDays = new Set(days)
  const kept: FunnelDay[] = []
  let dropped = 0
  for (const row of rows) {
    if (!inDays.has(row.insight_date)) continue
    const day = toFunnelDay(row, metric, opts)
    if (day === null) {
      dropped++
      continue
    }
    kept.push(day)
  }
  return { days: kept, dropped }
}

function dedupeByAd(rows: readonly DailyRow[]): Map<string, DailyRow[]> {
  const byKey = new Map<string, DailyRow>()
  for (const row of rows) {
    if (row.level !== 'ad') continue
    byKey.set(`${row.entity_id}|${row.insight_date}`, row)
  }
  const byAd = new Map<string, DailyRow[]>()
  for (const row of byKey.values()) {
    const list = byAd.get(row.entity_id)
    if (list) list.push(row)
    else byAd.set(row.entity_id, [row])
  }
  return byAd
}

function historyStartOf(rows: readonly DailyRow[]): string | null {
  let start: string | null = null
  for (const row of rows) {
    if (start === null || row.insight_date < start) start = row.insight_date
  }
  return start
}

function firstDeliveryOf(rows: readonly DailyRow[]): string | null {
  let first: string | null = null
  for (const row of rows) {
    if (row.impressions <= 0) continue
    if (first === null || row.insight_date < first) first = row.insight_date
  }
  return first
}

function isEligible(ctx: AccountContext, input: DiagnosisInput, ad: EntitySnapshotRow): boolean {
  if (!ad.adset_id) return false
  const adset = ctx.adsets.get(ad.adset_id)
  if (!adset) return false
  if (ctx.experimentIds.has(ad.adset_id)) return false
  if (ad.campaign_id && ctx.experimentIds.has(ad.campaign_id)) return false
  if (ad.creative_page_id !== input.clientPageId) return false
  if (!isDelivering(ad)) return false
  return isClickDrivenGoal(adset.optimization_goal)
}

export function toLocalDate(iso: string, tz: string | null): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz ?? 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

function lastSettingChange(ctx: AccountContext, ad: EntitySnapshotRow, from: string): string | null {
  const ids = new Set([ad.entity_id, ad.adset_id, ad.campaign_id].filter((x): x is string => !!x))
  const changes = ctx.account.settingChanges ?? []
  let latest: string | null = null
  for (const change of changes) {
    if (!ids.has(change.entity_id)) continue
    const day = toLocalDate(change.captured_at, ctx.account.timezone)
    if (day < from || day > ctx.date) continue
    if (latest === null || day > latest) latest = day
  }
  return latest
}

function lastAdsetStopDay(ctx: AccountContext, adsetId: string | null, firstDelivery: string): string | null {
  if (!adsetId) return null
  const days = windowDays(ctx.date, RULE_BASELINE_DAYS + RULE_RECENT_DAYS)
  const adsetSpendByDay = new Map<string, number>()
  const accountSpendByDay = new Map<string, number>()
  for (const row of ctx.account.daily) {
    if (row.level !== 'adset') continue
    if (row.entity_id === adsetId) adsetSpendByDay.set(row.insight_date, (adsetSpendByDay.get(row.insight_date) ?? 0) + row.spend)
    accountSpendByDay.set(row.insight_date, (accountSpendByDay.get(row.insight_date) ?? 0) + row.spend)
  }
  let latest: string | null = null
  for (const day of days) {
    if (day < firstDelivery) continue
    const adsetSpend = adsetSpendByDay.get(day) ?? 0
    const accountSpend = accountSpendByDay.get(day) ?? 0
    if (adsetSpend <= 0 && accountSpend > 0) {
      if (latest === null || day > latest) latest = day
    }
  }
  return latest
}

function lastChangeDate(ctx: AccountContext, ad: EntitySnapshotRow, from: string, firstDelivery: string): string | null {
  const setting = lastSettingChange(ctx, ad, from)
  const stopped = lastAdsetStopDay(ctx, ad.adset_id, firstDelivery)
  if (setting === null) return stopped
  if (stopped === null) return setting
  return setting > stopped ? setting : stopped
}

function passesCostFloor(recentTotals: FunnelTotals, base: FunnelTotals): boolean {
  const cpr = costPerResult(base)
  if (cpr === null) return true
  return recentTotals.spend >= cpr
}

export function campaignFrequency(ctx: AccountContext, campaignId: string | null): number | null {
  if (!campaignId) return null
  const wanted = new Set([ctx.date, shiftDate(ctx.date, -1)])
  let freq: number | null = null
  for (const row of ctx.account.daily) {
    if (row.level !== 'campaign' || row.entity_id !== campaignId) continue
    if (!wanted.has(row.insight_date)) continue
    const f = row.frequency_7d
    if (typeof f === 'number' && Number.isFinite(f)) freq = f
  }
  return freq
}

function buildOwnBase(rows: readonly DailyRow[], baseline: readonly string[], metric: CoreMetric | null, opts: OutcomeOpts, firstDelivery: string, historyStart: string | null, floor: string | null): FunnelDay[] | null {
  const honeymoon = firstDelivery === historyStart ? null : shiftDate(firstDelivery, RULE_HONEYMOON_DAYS)
  let cut = honeymoon
  if (floor !== null && (cut === null || floor > cut)) cut = floor
  const usable = cut === null ? baseline : baseline.filter(d => d >= cut)
  const baseSeries = series(rows, usable, metric, opts)
  const totals = sumDays(baseSeries.days)
  if (totals.activeDays < RULE_MIN_BASELINE_ACTIVE_DAYS) return null
  return baseSeries.days
}

function buildAdCase(ctx: AccountContext, input: DiagnosisInput, ad: EntitySnapshotRow, rows: readonly DailyRow[], recent: readonly string[], baseline: readonly string[], historyStart: string | null): AdCase | null {
  if (!ad.adset_id) return null
  const adset = ctx.adsets.get(ad.adset_id)
  if (!adset) return null
  const metric = resolveCoreMetric({ destinationType: adset.destination_type, optimizationGoal: adset.optimization_goal, clientPrimary: input.outcome.primary })
  const opts: OutcomeOpts = { messagingReferralAvailable: input.messagingReferralAvailable, optimizationGoal: adset.optimization_goal }
  const recentSeries = series(rows, recent, metric, opts)
  const activeRecentDays = recentSeries.days.filter(d => d.spend > 0).length
  if (activeRecentDays < RULE_MIN_PERSISTENT_DAYS) return null
  const recentTotals = sumDays(recentSeries.days)
  const adsetRecentSpend = sumSpend(adsetRows(ctx, [adset.entity_id], [...recent]))
  if (adsetRecentSpend > 0 && recentTotals.spend < RULE_MIN_SHARE_OF_ADSET_SPEND * adsetRecentSpend) return null
  const firstDelivery = firstDeliveryOf(rows)
  if (firstDelivery === null) return null
  const ownBaseRaw = buildOwnBase(rows, baseline, metric, opts, firstDelivery, historyStart, null)
  const changeDate = lastChangeDate(ctx, ad, baseline[0] ?? ctx.date, firstDelivery)
  const learningNow = changeDate !== null && shiftDate(changeDate, RULE_LEARNING_DAYS) > recent[0]
  const floor = changeDate === null ? null : shiftDate(changeDate, RULE_LEARNING_DAYS)
  const ownBase = buildOwnBase(rows, baseline, metric, opts, firstDelivery, historyStart, floor)
  const isNewAd = firstDelivery !== historyStart && firstDelivery >= shiftDate(ctx.date, -14)
  return { ad, adset, metric, opts, recent: recentSeries.days, recentTotals, dropped: recentSeries.dropped, firstDelivery, isNewAd, changeDate, learningNow, ownBaseRaw, ownBase }
}

function adUnit(ctx: AccountContext, ad: EntitySnapshotRow): DiagnosisUnit {
  const verdict = ad.adset_id ? ctx.roles.get(ad.adset_id) : undefined
  return { level: 'ad', id: ad.entity_id, name: ad.entity_name, adAccountId: ctx.account.adAccountId, role: verdict?.role, roleConfidence: verdict?.confidence }
}

function unitsFor(ctx: AccountContext, c: AdCase): DiagnosisUnit[] {
  return [adUnit(ctx, c.ad), unitOf(ctx, 'adset', c.adset.entity_id)]
}

function checkBackDays(v: StepVerdict, recentTrials: number, minDays: number): number {
  const perDayExpected = (recentTrials / RULE_RECENT_DAYS) * v.baseRate
  const need = perDayExpected > 0 ? Math.ceil(RULE_MIN_EXPECTED / perDayExpected) : 7
  return Math.max(minDays, need)
}

function afterText(ctx: AccountContext, days: number): string {
  return `${days} 天后（约 ${shiftDate(ctx.date, days)}）`
}

function sourceLabel(source: 'own_history' | 'same_adset_peers'): string {
  return source === 'own_history' ? '自身正常水平' : '同组其他广告'
}

function ctrOf(t: FunnelTotals): number {
  return t.impressions > 0 ? round(t.clicks / t.impressions, 4) : 0
}

function baseEvidence(ctx: AccountContext, c: AdCase, base: FunnelTotals, source: 'own_history' | 'same_adset_peers', peerCount: number | null, v: StepVerdict, adj: number, rateKind: 'ctr' | 'link_click_to_result', extra: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> {
  const baseCpr = costPerResult(base)
  const recentCpr = costPerResult(c.recentTotals)
  const costMultiple = baseCpr === null ? null : recentCpr === null ? null : round(recentCpr / baseCpr, 2)
  return {
    window_start: c.recent[0]?.date ?? null,
    window_end: ctx.date,
    baseline_source: source,
    core_metric: c.metric,
    rate_kind: rateKind,
    base_rate: round(v.baseRate, 4),
    recent_rate: round(v.recentRate, 4),
    base_ctr: ctrOf(base),
    recent_ctr: ctrOf(c.recentTotals),
    relative_drop: round(v.relativeDrop, 3),
    expected: round(v.expected, 1),
    p_value: v.p,
    bh_adjusted_p: Number(adj.toPrecision(3)),
    recent_spend: c.recentTotals.spend,
    recent_impressions: c.recentTotals.impressions,
    recent_clicks: c.recentTotals.clicks,
    recent_link_clicks: c.recentTotals.linkClicks,
    recent_results: c.recentTotals.results,
    base_cost_per_result: baseCpr,
    recent_cost_per_result: recentCpr,
    cost_multiple: costMultiple,
    impression_result_drop: round(impressionResultDrop(base, c.recentTotals), 3),
    peer_ads: peerCount,
    dropped_days: c.dropped,
    first_delivery: c.firstDelivery,
    campaign_id: c.ad.campaign_id,
    change_date: c.changeDate,
    ...extra,
  }
}

function sampleFor(c: AdCase, base: FunnelTotals, kind: 'link' | 'impressions'): { label: string; value: number }[] {
  const noun = kind === 'link' ? '链接点击' : '曝光'
  const recentValue = kind === 'link' ? c.recentTotals.linkClicks : c.recentTotals.impressions
  const baseValue = kind === 'link' ? base.linkClicks : base.impressions
  return [
    { label: `近 3 天${noun}`, value: recentValue },
    { label: `对照期${noun}`, value: baseValue },
  ]
}

function d2KindText(kind: FatigueKind, freq: number | null): string {
  if (kind === 'audience') return `同一批人看腻了（所在系列 7 天频次 ${freq === null ? '—' : freq.toFixed(1)}）`
  if (kind === 'creative') return `素材老化（所在系列 7 天频次 ${freq === null ? '—' : freq.toFixed(1)}，不高）`
  return '频次拿不到，分不清是素材老了还是人看腻了'
}

function d2Suggestion(kind: FatigueKind): string {
  if (kind === 'audience') return '同一批人看腻了：考虑扩受众，换素材治不了。'
  if (kind === 'creative') return '素材老化：在同一个系列里另建一个新广告组测新素材（共享预算），这条先别动——往正在跑的组里加广告会让它重新学习。'
  return `频次拿不到，先看所在系列近 7 天频次：高于 ${FATIGUE_FREQUENCY_HIGH} 就扩受众，不高就在同一系列另建新组测新素材；这条先别动。`
}

function d2CheckBack(ctx: AccountContext, base: FunnelTotals, kind: FatigueKind, days: number): CheckBack {
  const after = afterText(ctx, days)
  const baseRate = base.impressions > 0 ? base.clicks / base.impressions : 0
  if (kind === 'audience') {
    return { after, condition: `扩受众后到时点击率还没回到正常水平的 75%（${pct(baseRate * 0.75)}）`, fallback: '改回原来的受众' }
  }
  if (kind === 'creative') {
    return { after, condition: `到时新组的素材点击率不到这条正常水平的 75%（${pct(baseRate * 0.75)}）`, fallback: '停掉新建的那个测试组，这条不动' }
  }
  return { after, condition: `到时这条点击率仍低于正常水平的 75%（${pct(baseRate * 0.75)}）`, fallback: '按当时的频次再决定扩受众还是另建新组测新素材' }
}

function d2Hit(ctx: AccountContext, c: AdCase, base: FunnelTotals, v: StepVerdict, adj: number): Diagnosis {
  const name = c.ad.entity_name ?? c.ad.entity_id
  const freq = campaignFrequency(ctx, c.ad.campaign_id)
  const kind = classifyFatigue(freq)
  const baseRate = base.impressions > 0 ? base.clicks / base.impressions : 0
  const recentRate = c.recentTotals.impressions > 0 ? c.recentTotals.clicks / c.recentTotals.impressions : 0
  const drop = baseRate > 0 ? 1 - recentRate / baseRate : 0
  const days = checkBackDays(v, c.recentTotals.impressions, 7)
  const after = afterText(ctx, days)
  const suggestion = d2Suggestion(kind)
  const checkBack = d2CheckBack(ctx, base, kind, days)
  const title = `素材疲劳：「${name}」点击率从自身正常的 ${pct(baseRate)} 掉到 ${pct(recentRate)}（降 ${Math.round(drop * 100)}%）——${d2KindText(kind, freq)}`
  const basis = `对照：自身前 14 天（已剔除上线头 7 天）· 近 3 天曝光 ${c.recentTotals.impressions}、点击 ${c.recentTotals.clicks} · 按对照应有约 ${v.expected.toFixed(1)} 次点击`
  const caliber = `口径：点击率 = 全部点击 ÷ 曝光；频次取所在广告系列 7 天去重值，高于 ${FATIGUE_FREQUENCY_HIGH} 算看腻（广告健康页系列层那套用的是 2.5，口径不同）`
  const stopLoss = `止损：${after}回头看——${checkBack.condition}，就${checkBack.fallback}`
  const discipline = '一次只改一处；任何改动都会让系统重新学习，改完别再追着改'
  return {
    code: 'D2',
    status: 'hit',
    title,
    units: unitsFor(ctx, c),
    evidence: baseEvidence(ctx, c, base, 'own_history', null, v, adj, 'ctr', { frequency_7d: freq, fatigue_kind: kind }),
    sample: sampleFor(c, base, 'impressions'),
    reasons: [suggestion, stopLoss, basis, caliber, discipline],
    // 命中结论可给客户看（Magic Bridge 报告经客户文案模板转写后展示）；判不了的备注仍只内部
    clientVisible: true,
    checkBack,
  }
}

function d2Verdict(c: AdCase, base: FunnelTotals): StepVerdict {
  return judgeStep({
    recentSuccess: c.recentTotals.clicks,
    recentTrials: c.recentTotals.impressions,
    baseSuccess: base.clicks,
    baseTrials: base.impressions,
    recentDaily: c.recent.map(d => ({ success: d.clicks, trials: d.impressions })),
    minRelativeDrop: D2_MIN_CTR_DROP,
  })
}

function d2BaseUsable(base: FunnelTotals): boolean {
  if (base.impressions < D2_MIN_BASE_IMPRESSIONS) return false
  if (base.impressions <= 0 || base.clicks / base.impressions < D2_CTR_SIGNAL_FLOOR) return false
  return true
}

function evaluateD2(ctx: AccountContext, c: AdCase): RuleResult {
  if (c.learningNow) {
    if (c.ownBaseRaw === null) return {}
    const raw = sumDays(c.ownBaseRaw)
    if (!d2BaseUsable(raw)) return {}
    if (c.recentTotals.impressions < D2_MIN_RECENT_IMPRESSIONS) return {}
    if (!passesCostFloor(c.recentTotals, raw)) return {}
    if (d2Verdict(c, raw).reason !== 'ok') return {}
    return { note: recentlyChangedNote(ctx, c, 'D2') }
  }
  if (c.ownBase === null) return {}
  const base = sumDays(c.ownBase)
  if (!d2BaseUsable(base)) return {}
  if (c.recentTotals.impressions < D2_MIN_RECENT_IMPRESSIONS) return {}
  if (!passesCostFloor(c.recentTotals, base)) return {}
  const v = d2Verdict(c, base)
  if (v.reason !== 'ok') return {}
  return { candidate: { code: 'D2', p: v.p, build: adj => d2Hit(ctx, c, base, v, adj) } }
}

function ownBaselineUsable(base: FunnelTotals): boolean {
  return base.results >= D10_MIN_BASE_RESULTS && base.linkClicks >= D10_MIN_BASE_LINK_CLICKS
}

function peerBaseline(ctx: AccountContext, input: DiagnosisInput, c: AdCase, rowsByAd: Map<string, DailyRow[]>, baseline: readonly string[], recent: readonly string[]): { base: FunnelTotals; source: 'same_adset_peers'; peerCount: number } | null {
  const allDays = [...baseline, ...recent]
  const peerDays: FunnelDay[] = []
  let peerCount = 0
  for (const peer of ctx.ads) {
    if (peer.entity_id === c.ad.entity_id) continue
    if (peer.adset_id !== c.ad.adset_id) continue
    if (peer.creative_page_id !== input.clientPageId) continue
    const rows = rowsByAd.get(peer.entity_id) ?? []
    const s = series(rows, allDays, c.metric, c.opts)
    if (s.days.length > 0) peerCount++
    peerDays.push(...s.days)
  }
  const base = sumDays(peerDays)
  // 同组对照只用来抓「新广告抢了老广告的钱」（手册 §18）：这条广告在这 17 天里花得比同组其他广告合计还多，
  // 它自己就是这个组的主力，拿组里被饿着的小广告当对照会把主力判成坏的（2026-09-26 生产回放：组里花费第一的广告被误报）。
  // 🔴 不能只比「两边同时在花钱的日子」：新广告抢钱时那几天按定义就花得比老广告多，会把要抓的案例本身挡掉；
  //    主力 vs 新测试的区分另由 evaluateD10 里「上线至今整体成本」那道闸兜。
  const own = sumDays(series(rowsByAd.get(c.ad.entity_id) ?? [], allDays, c.metric, c.opts).days)
  if (own.spend > base.spend) return null
  if (!ownBaselineUsable(base)) return null
  return { base, source: 'same_adset_peers', peerCount }
}

function learningWouldHit(c: AdCase): boolean {
  if (c.ownBaseRaw === null) return false
  const raw = sumDays(c.ownBaseRaw)
  if (!ownBaselineUsable(raw)) return false
  const v = d10Verdict(c, raw)
  if (v.reason !== 'ok') return false
  const costMultiple = costMultipleOf(raw, c.recentTotals)
  if (costMultiple === null || costMultiple < D10_MIN_COST_MULTIPLE) return false
  return impressionResultDrop(raw, c.recentTotals) >= D10_MIN_CVR_DROP
}

function chooseBaseline(ctx: AccountContext, input: DiagnosisInput, c: AdCase, rowsByAd: Map<string, DailyRow[]>, baseline: readonly string[], recent: readonly string[]): BaselineChoice | null {
  if (!c.learningNow && c.ownBase !== null) {
    const base = sumDays(c.ownBase)
    if (ownBaselineUsable(base)) return { kind: 'base', base, source: 'own_history', peerCount: null }
  }
  if (c.learningNow && learningWouldHit(c)) return { kind: 'learning' }
  // 自身历史不可用（天数不够或量不够）才退到同组对照。同期同组的结构改动对两边一样，所以不挂「最近改过」闸。
  const peers = peerBaseline(ctx, input, c, rowsByAd, baseline, recent)
  if (peers === null) return null
  return { kind: 'base', base: peers.base, source: peers.source, peerCount: peers.peerCount }
}

function d10Verdict(c: AdCase, base: FunnelTotals): StepVerdict {
  return judgeStep({
    recentSuccess: c.recentTotals.results,
    recentTrials: c.recentTotals.linkClicks,
    baseSuccess: base.results,
    baseTrials: base.linkClicks,
    recentDaily: c.recent.map(d => ({ success: d.results ?? 0, trials: d.linkClicks })),
    minRelativeDrop: D10_MIN_CVR_DROP,
  })
}

function costMultipleOf(base: FunnelTotals, recentTotals: FunnelTotals): number | null {
  const baseCpr = costPerResult(base)
  if (baseCpr === null) return null
  const recentCpr = costPerResult(recentTotals)
  if (recentCpr === null) return Infinity
  return recentCpr / baseCpr
}

/**
 * 曝光→结果的相对降幅（1 - 近期每曝光结果率 / 对照每曝光结果率）。对照为 0 时返回 0。
 * D10 除了「点击→结果」显著变差，还要求这一步也降够——点击率高一倍、转化低一截但每次曝光换来的结果差不多的广告，不算坏。
 */
function impressionResultDrop(base: FunnelTotals, recentTotals: FunnelTotals): number {
  const baseRate = base.impressions > 0 ? base.results / base.impressions : 0
  if (baseRate <= 0) return 0
  const recentRate = recentTotals.impressions > 0 ? recentTotals.results / recentTotals.impressions : 0
  return 1 - recentRate / baseRate
}

function lifetimeCostMultiple(ctx: AccountContext, c: AdCase, rowsByAd: Map<string, DailyRow[]>, baseCpr: number | null): number | null {
  if (baseCpr === null) return null
  const days = windowDays(ctx.date, 28).filter(d => d >= c.firstDelivery)
  const lifetime = sumDays(series(rowsByAd.get(c.ad.entity_id) ?? [], days, c.metric, c.opts).days)
  const cpr = costPerResult(lifetime)
  if (cpr === null) return Infinity
  return cpr / baseCpr
}

function evaluateD10(ctx: AccountContext, input: DiagnosisInput, c: AdCase, rowsByAd: Map<string, DailyRow[]>, recent: readonly string[], baseline: readonly string[]): RuleResult {
  if (c.metric === null) return {}
  const choice = chooseBaseline(ctx, input, c, rowsByAd, baseline, recent)
  if (choice === null) return {}
  if (choice.kind === 'learning') return { note: recentlyChangedNote(ctx, c, 'D10') }
  const { base, source, peerCount } = choice
  if (!passesCostFloor(c.recentTotals, base)) return {}
  const v = d10Verdict(c, base)
  const costMultiple = costMultipleOf(base, c.recentTotals)
  const perImpressionDrop = impressionResultDrop(base, c.recentTotals)
  if (v.reason === 'ok' && costMultiple !== null && costMultiple >= D10_MIN_COST_MULTIPLE && perImpressionDrop >= D10_MIN_CVR_DROP) {
    const baseCpr = costPerResult(base)
    let lifetimeMultiple: number | null = null
    if (source === 'same_adset_peers') {
      // 同组对照时，这条从上线到现在的整体成本也要明显更贵——只是这 3 天运气差、整体仍划算的主力广告不报；2026-09-26 生产回放误报过一次。
      lifetimeMultiple = lifetimeCostMultiple(ctx, c, rowsByAd, baseCpr)
      if (lifetimeMultiple === null || lifetimeMultiple < D10_MIN_COST_MULTIPLE) return {}
    }
    const extra: Record<string, string | number | boolean | null> = lifetimeMultiple === null ? {} : { lifetime_cost_multiple: lifetimeMultiple === Infinity ? null : round(lifetimeMultiple, 2) }
    return { candidate: { code: 'D10', p: v.p, build: adj => d10Hit(ctx, c, base, v, adj, source, peerCount, extra) } }
  }
  if (v.reason === 'thin' && costMultiple !== null && costMultiple >= SAMPLE_NOTE_COST_MULTIPLE) {
    return { note: thinSampleNote(ctx, c, v, costMultiple) }
  }
  return {}
}

function d10Title(ctx: AccountContext, c: AdCase, v: StepVerdict, source: 'own_history' | 'same_adset_peers', recentCpr: number | null, baseCpr: number | null): string {
  const name = c.ad.entity_name ?? c.ad.entity_id
  const noun = c.metric ? CORE_METRIC_NOUN[c.metric] : '结果'
  const recentPart = recentCpr === null ? `0 个${noun}` : `每个${noun} ${money(ctx, recentCpr)}`
  if (source === 'own_history') {
    return `点进去之后差了：「${name}」点击→${noun}从自身正常的 ${pct(v.baseRate)} 掉到 ${pct(v.recentRate)}，${recentPart}（正常 ${money(ctx, baseCpr)}）`
  }
  const drop = v.baseRate > 0 ? 1 - v.recentRate / v.baseRate : 0
  return `点进去之后差了：「${name}」点击→${noun} ${pct(v.recentRate)}，比同组其他广告（${pct(v.baseRate)}）低 ${Math.round(drop * 100)}%，${recentPart}（同组 ${money(ctx, baseCpr)}）`
}

function d10CheckBack(ctx: AccountContext, c: AdCase, base: FunnelTotals, source: 'own_history' | 'same_adset_peers', days: number): CheckBack {
  const after = afterText(ctx, days)
  const noun = c.metric ? CORE_METRIC_NOUN[c.metric] : '结果'
  const baseRate = base.linkClicks > 0 ? base.results / base.linkClicks : 0
  const condition = `到时这条的点击→${noun}还低于${sourceLabel(source)}的一半（${pct(baseRate / 2)}）`
  const newAd = source === 'same_adset_peers' && c.isNewAd
  const fallback = newAd ? '停掉这条（新上线或刚重新开投的），同组老广告不动' : '先查表单问题数、落地页、私信开场最近有没有改过，再决定要不要停；先别动预算'
  return { after, condition, fallback }
}

function d10Suggestion(c: AdCase, source: 'own_history' | 'same_adset_peers'): string {
  if (source === 'own_history') return '问题多半在点进去之后（表单问题数 / 落地页 / 私信开场），不是素材。先查这条最近有没有换过表单或开场白，先别动预算。'
  if (c.isNewAd) return '这条新上线或刚重新开投，正在跟同组已验证的广告抢同一份预算，点进去之后却差很多——问题多半在表单 / 落地页 / 私信开场。按手册，测试版应该单独放一个组测，不跟老广告抢钱。'
  return '比同组其他广告点进去之后差很多——问题多半在表单 / 落地页 / 私信开场。先查它跟同组其他广告的表单、开场有什么不同，先别动预算。'
}

function d10Hit(ctx: AccountContext, c: AdCase, base: FunnelTotals, v: StepVerdict, adj: number, source: 'own_history' | 'same_adset_peers', peerCount: number | null, extra: Record<string, string | number | boolean | null>): Diagnosis {
  const noun = c.metric ? CORE_METRIC_NOUN[c.metric] : '结果'
  const baseCpr = costPerResult(base)
  const recentCpr = costPerResult(c.recentTotals)
  const minDays = source === 'same_adset_peers' && c.isNewAd ? 3 : 7
  const days = checkBackDays(v, c.recentTotals.linkClicks, minDays)
  const after = afterText(ctx, days)
  const checkBack = d10CheckBack(ctx, c, base, source, days)
  const title = d10Title(ctx, c, v, source, recentCpr, baseCpr)
  const own = source === 'own_history'
  const basis = `对照：${sourceLabel(source)}（${own ? '前 14 天，已剔除上线头 7 天' : `同组其他 ${peerCount ?? 0} 条广告近 17 天合计`}）· 近 3 天链接点击 ${c.recentTotals.linkClicks}、${noun} ${c.recentTotals.results} · 按对照应有约 ${v.expected.toFixed(1)} 个`
  const suggestion = d10Suggestion(c, source)
  const stopLoss = `止损：${after}回头看——${checkBack.condition}，就${checkBack.fallback}`
  const discipline = '一次只改一处；任何改动都会让系统重新学习，改完别再追着改'
  return {
    code: 'D10',
    status: 'hit',
    title,
    units: unitsFor(ctx, c),
    evidence: baseEvidence(ctx, c, base, source, peerCount, v, adj, 'link_click_to_result', extra),
    sample: sampleFor(c, base, 'link'),
    reasons: [suggestion, stopLoss, basis, discipline],
    // 命中结论可给客户看（Magic Bridge 报告经客户文案模板转写后展示）；判不了的备注仍只内部
    clientVisible: true,
    checkBack,
  }
}

function recentlyChangedNote(ctx: AccountContext, c: AdCase, code: 'D2' | 'D10'): Diagnosis {
  const name = c.ad.entity_name ?? c.ad.entity_id
  const changeDate = c.changeDate ?? ctx.date
  return {
    code,
    status: 'not_comparable',
    notComparableReason: 'recently_changed',
    title: `「${name}」看着在变差，但 ${changeDate} 改过设置或整组停过，还在重新学习，先等到 ${shiftDate(changeDate, RULE_LEARNING_DAYS)} 之后再判`,
    units: unitsFor(ctx, c),
    evidence: { window_end: ctx.date, recent_spend: c.recentTotals.spend, change_date: c.changeDate },
    sample: [{ label: '近 3 天花费', value: c.recentTotals.spend }],
    reasons: ['自身前后比对被改动打断了：改动会让系统重新学习，这时候再改只会更乱'],
    clientVisible: false,
  }
}

function thinSampleNote(ctx: AccountContext, c: AdCase, v: StepVerdict, costMultiple: number): Diagnosis {
  const name = c.ad.entity_name ?? c.ad.entity_id
  const noun = c.metric ? CORE_METRIC_NOUN[c.metric] : '结果'
  const need = v.baseRate > 0 ? Math.ceil(RULE_MIN_EXPECTED / v.baseRate) : 0
  const title = costMultiple === Infinity
    ? `「${name}」近 3 天花了 ${money(ctx, c.recentTotals.spend)} 还没有${noun}，但链接点击才 ${c.recentTotals.linkClicks} 次，还不够判`
    : `「${name}」每个${noun}贵了 ${costMultiple.toFixed(1)} 倍，但链接点击才 ${c.recentTotals.linkClicks} 次，还不够判`
  return {
    code: 'D10',
    status: 'not_comparable',
    notComparableReason: 'below_min_sample',
    title,
    units: unitsFor(ctx, c),
    evidence: { window_end: ctx.date, recent_link_clicks: c.recentTotals.linkClicks, cost_multiple: costMultiple === Infinity ? null : round(costMultiple, 2) },
    sample: [{ label: '近 3 天链接点击', value: c.recentTotals.linkClicks }],
    reasons: [`按对照转化率，要约 ${need} 次链接点击才判得了`],
    clientVisible: false,
  }
}

function clientPageUnknown(ctx: AccountContext, input: DiagnosisInput): Diagnosis {
  return {
    code: 'D10',
    status: 'not_comparable',
    notComparableReason: 'client_page_unknown',
    title: '广告级检查没跑：客户还没登记 Facebook 主页，分不清账户里哪些广告是这个客户的',
    units: [],
    evidence: { window_end: ctx.date },
    sample: [],
    reasons: [
      '一个广告账户里可能投着别的客户的广告，不登记主页就可能把别人的广告算到这个客户头上',
      '没登记主页时，「花钱没结果」的自动暂停建议也一律拦下（确认不了广告组是这个客户的）',
    ],
    clientVisible: false,
    manualTask: {
      what: '客户没登记 Facebook 主页，广告级检查（素材疲劳 / 点进去之后差了）整段没跑',
      how: '打开客户设置页，在 Facebook 主页一栏绑定这个客户自己的主页（系统会先向 Meta 核实）',
      href: `https://app.magicengine.com.au/dashboard/clients/${encodeURIComponent(input.clientId)}/settings`,
    },
  }
}

function hasRecentSpend(rows: readonly DailyRow[], recent: readonly string[]): boolean {
  const inDays = new Set(recent)
  return rows.some(r => inDays.has(r.insight_date) && r.spend > 0)
}

/** 这个账户上广告级规则跑没跑、看了几条广告。条件与 diagnoseAdLevelRules 开头的几道闸一致。 */
export function adLevelCoverage(ctx: AccountContext, input: DiagnosisInput): AdLevelCoverage {
  const base = { adAccountId: ctx.account.adAccountId }
  if (input.clientPageId === undefined || ctx.account.adDaily === undefined) return { ...base, ran: false, reason: 'not_loaded', adsChecked: 0 }
  if (input.clientPageId === null) return { ...base, ran: false, reason: 'client_page_unknown', adsChecked: 0 }
  const adsChecked = ctx.ads.filter(ad => isEligible(ctx, input, ad)).length
  return { ...base, ran: true, reason: 'ok', adsChecked }
}

/**
 * How many eligible ads had enough recent delivery and history to be judged at all (buildAdCase non-null).
 * Read-only companion for Magic Bridge's on-the-spot check: its "looked at N ads" must not count ads the rules
 * could not judge (魏征 2026-09-27). Does not change what diagnoseAdLevelRules reports.
 */
export function adLevelJudgeableCount(ctx: AccountContext, input: DiagnosisInput): number {
  const adDaily = ctx.account.adDaily
  if (input.clientPageId === undefined || input.clientPageId === null || adDaily === undefined) return 0
  const recent = windowDays(ctx.date, RULE_RECENT_DAYS)
  const baseline = windowDays(shiftDate(ctx.date, -RULE_RECENT_DAYS), RULE_BASELINE_DAYS)
  const rowsByAd = dedupeByAd(adDaily)
  const historyStart = historyStartOf(adDaily)
  return ctx.ads.filter(ad => isEligible(ctx, input, ad)
    && buildAdCase(ctx, input, ad, rowsByAd.get(ad.entity_id) ?? [], recent, baseline, historyStart) !== null).length
}

export function diagnoseAdLevelRules(ctx: AccountContext, input: DiagnosisInput): Diagnosis[] {
  if (input.clientPageId === undefined) return []
  const adDaily = ctx.account.adDaily
  if (adDaily === undefined) return []
  const recent = windowDays(ctx.date, RULE_RECENT_DAYS)
  const baseline = windowDays(shiftDate(ctx.date, -RULE_RECENT_DAYS), RULE_BASELINE_DAYS)
  if (input.clientPageId === null) {
    return hasRecentSpend(adDaily, recent) ? [clientPageUnknown(ctx, input)] : []
  }
  const rowsByAd = dedupeByAd(adDaily)
  const historyStart = historyStartOf(adDaily)
  const candidates: Candidate[] = []
  const notes: Diagnosis[] = []
  for (const ad of ctx.ads) {
    if (!isEligible(ctx, input, ad)) continue
    const rows = rowsByAd.get(ad.entity_id) ?? []
    const c = buildAdCase(ctx, input, ad, rows, recent, baseline, historyStart)
    if (c === null) continue
    const d2 = evaluateD2(ctx, c)
    if (d2.candidate) candidates.push(d2.candidate)
    if (d2.note) notes.push(d2.note)
    const d10 = evaluateD10(ctx, input, c, rowsByAd, recent, baseline)
    if (d10.candidate) candidates.push(d10.candidate)
    if (d10.note) notes.push(d10.note)
  }
  const adj = benjaminiHochberg(candidates.map(c => c.p))
  const hits: Diagnosis[] = []
  candidates.forEach((c, i) => {
    const adjusted = adj[i]
    if (adjusted === undefined) return
    if (adjusted <= RULE_BH_Q) hits.push(c.build(adjusted))
  })
  return [...hits, ...notes]
}
