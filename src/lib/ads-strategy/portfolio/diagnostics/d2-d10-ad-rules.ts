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
import type { CheckBack, DailyRow, Diagnosis, DiagnosisInput, DiagnosisUnit } from './types'
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
  ownBase: FunnelDay[] | null
  changed: boolean
}

interface Candidate {
  code: 'D2' | 'D10'
  p: number
  build: (adjustedP: number) => Diagnosis
}

interface D2Result {
  candidate?: Candidate
  note?: Diagnosis
}

interface D10Result {
  candidate?: Candidate
  note?: Diagnosis
}

interface BaselineChoice {
  base: FunnelTotals
  source: 'own_history' | 'same_adset_peers'
  peerCount: number | null
}

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

function recentlyChanged(ctx: AccountContext, ad: EntitySnapshotRow, from: string, firstDelivery: string): boolean {
  const ids = new Set([ad.entity_id, ad.adset_id, ad.campaign_id].filter((x): x is string => !!x))
  const changes = ctx.account.settingChanges ?? []
  for (const change of changes) {
    if (ids.has(change.entity_id) && change.captured_at.slice(0, 10) >= from) return true
  }
  return adsetStopped(ctx, ad.adset_id, firstDelivery)
}

function adsetStopped(ctx: AccountContext, adsetId: string | null, firstDelivery: string): boolean {
  if (!adsetId) return false
  const days = windowDays(ctx.date, RULE_BASELINE_DAYS + RULE_RECENT_DAYS)
  const adsetSpendByDay = new Map<string, number>()
  const accountSpendByDay = new Map<string, number>()
  for (const row of ctx.account.daily) {
    if (row.level !== 'adset') continue
    if (row.entity_id === adsetId) adsetSpendByDay.set(row.insight_date, (adsetSpendByDay.get(row.insight_date) ?? 0) + row.spend)
    accountSpendByDay.set(row.insight_date, (accountSpendByDay.get(row.insight_date) ?? 0) + row.spend)
  }
  for (const day of days) {
    if (day < firstDelivery) continue
    const adsetSpend = adsetSpendByDay.get(day) ?? 0
    const accountSpend = accountSpendByDay.get(day) ?? 0
    if (adsetSpend <= 0 && accountSpend > 0) return true
  }
  return false
}

function passesCostFloor(recentTotals: FunnelTotals, base: FunnelTotals): boolean {
  const cpr = costPerResult(base)
  if (cpr === null) return true
  return recentTotals.spend >= cpr
}

function campaignFrequency(ctx: AccountContext, campaignId: string | null): number | null {
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

function buildOwnBase(rows: readonly DailyRow[], baseline: readonly string[], metric: CoreMetric | null, opts: OutcomeOpts, firstDelivery: string, historyStart: string | null): FunnelDay[] | null {
  const cut = firstDelivery === historyStart ? null : shiftDate(firstDelivery, RULE_HONEYMOON_DAYS)
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
  const ownBase = buildOwnBase(rows, baseline, metric, opts, firstDelivery, historyStart)
  const isNewAd = firstDelivery !== historyStart && firstDelivery >= shiftDate(ctx.date, -14)
  const changed = recentlyChanged(ctx, ad, baseline[0] ?? ctx.date, firstDelivery)
  return { ad, adset, metric, opts, recent: recentSeries.days, recentTotals, dropped: recentSeries.dropped, firstDelivery, isNewAd, ownBase, changed }
}

function adUnit(ctx: AccountContext, ad: EntitySnapshotRow): DiagnosisUnit {
  const verdict = ad.adset_id ? ctx.roles.get(ad.adset_id) : undefined
  return { level: 'ad', id: ad.entity_id, name: ad.entity_name, adAccountId: ctx.account.adAccountId, role: verdict?.role, roleConfidence: verdict?.confidence }
}

function unitsFor(ctx: AccountContext, c: AdCase): DiagnosisUnit[] {
  return [adUnit(ctx, c.ad), unitOf(ctx, 'adset', c.adset.entity_id)]
}

function checkBackDays(v: StepVerdict, recentTrials: number): number {
  const perDayExpected = (recentTrials / RULE_RECENT_DAYS) * v.baseRate
  const need = perDayExpected > 0 ? Math.ceil(RULE_MIN_EXPECTED / perDayExpected) : 7
  return Math.max(7, need)
}

function afterText(ctx: AccountContext, days: number): string {
  return `${days} 天后（约 ${shiftDate(ctx.date, days)}）`
}

function sourceLabel(source: 'own_history' | 'same_adset_peers'): string {
  return source === 'own_history' ? '自身正常水平' : '同组其他广告'
}

function baseEvidence(ctx: AccountContext, c: AdCase, base: FunnelTotals, source: 'own_history' | 'same_adset_peers', peerCount: number | null, v: StepVerdict, adj: number, extra: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> {
  const baseCpr = costPerResult(base)
  const recentCpr = costPerResult(c.recentTotals)
  const costMultiple = baseCpr === null ? null : recentCpr === null ? null : round(recentCpr / baseCpr, 2)
  return {
    window_start: c.recent[0]?.date ?? null,
    window_end: ctx.date,
    baseline_source: source,
    core_metric: c.metric,
    base_rate: round(v.baseRate, 4),
    recent_rate: round(v.recentRate, 4),
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
    ...extra,
  }
}

function sampleFor(c: AdCase, upstream: string, base: FunnelTotals): { label: string; value: number }[] {
  const recentValue = upstream === '链接点击' ? c.recentTotals.linkClicks : c.recentTotals.impressions
  const baseValue = upstream === '链接点击' ? base.linkClicks : base.impressions
  return [
    { label: `近 3 天${upstream}`, value: recentValue },
    { label: `对照期${upstream}`, value: baseValue },
  ]
}

function d2KindText(kind: FatigueKind, freq: number | null): string {
  if (kind === 'audience') return `同一批人看腻了（所在系列 7 天频次 ${freq === null ? '—' : freq.toFixed(1)}）`
  if (kind === 'creative') return `素材老化（所在系列 7 天频次 ${freq === null ? '—' : freq.toFixed(1)}，不高）`
  return '频次拿不到，分不清是素材老了还是人看腻了'
}

function d2Suggestion(kind: FatigueKind): string {
  if (kind === 'audience') return '考虑扩受众，换素材治不了。'
  return '在同组新增一条广告测新素材，别直接替换这条的素材（替换要重新审核、会重置学习）。'
}

function d2CheckBack(ctx: AccountContext, base: FunnelTotals, kind: FatigueKind, days: number): CheckBack {
  const after = afterText(ctx, days)
  const baseRate = base.impressions > 0 ? base.clicks / base.impressions : 0
  if (kind === 'audience') {
    return { after, condition: `扩受众后到时点击率还没回到正常水平的 75%（${pct(baseRate * 0.75)}）`, fallback: '改回原来的受众' }
  }
  return { after, condition: `到时新素材点击率不到这条正常水平的 75%（${pct(baseRate * 0.75)}）`, fallback: '停掉新加的那条广告，这条不动' }
}

function d2Hit(ctx: AccountContext, c: AdCase, base: FunnelTotals, v: StepVerdict, adj: number): Diagnosis {
  const name = c.ad.entity_name ?? c.ad.entity_id
  const freq = campaignFrequency(ctx, c.ad.campaign_id)
  const kind = classifyFatigue(freq)
  const baseRate = base.impressions > 0 ? base.clicks / base.impressions : 0
  const recentRate = c.recentTotals.impressions > 0 ? c.recentTotals.clicks / c.recentTotals.impressions : 0
  const drop = baseRate > 0 ? 1 - recentRate / baseRate : 0
  const days = checkBackDays(v, c.recentTotals.impressions)
  const after = afterText(ctx, days)
  const suggestion = d2Suggestion(kind)
  const checkBack = d2CheckBack(ctx, base, kind, days)
  const title = `素材疲劳：「${name}」点击率从自身正常的 ${pct(baseRate)} 掉到 ${pct(recentRate)}（降 ${Math.round(drop * 100)}%）——${d2KindText(kind, freq)}`
  const basis = `对照：自身前 14 天（已剔除上线头 7 天）· 近 3 天曝光 ${c.recentTotals.impressions}、点击 ${c.recentTotals.clicks} · 按对照应有约 ${v.expected.toFixed(1)} 次点击 · 校正后 p=${Number(adj.toPrecision(2))}`
  const caliber = `口径：点击率 = 全部点击 ÷ 曝光；频次取所在广告系列 7 天去重值，高于 ${FATIGUE_FREQUENCY_HIGH} 算看腻（广告健康页系列层那套用的是 2.5，口径不同）`
  const stopLoss = `止损：${after}回头看——${checkBack.condition}，就${checkBack.fallback}`
  const discipline = '一次只改一处；任何改动都会让系统重新学习，改完别再追着改'
  return {
    code: 'D2',
    status: 'hit',
    title,
    units: unitsFor(ctx, c),
    evidence: baseEvidence(ctx, c, base, 'own_history', null, v, adj, { frequency_7d: freq, fatigue_kind: kind }),
    sample: sampleFor(c, '曝光', base),
    reasons: [basis, caliber, suggestion, stopLoss, discipline],
    clientVisible: false,
    checkBack,
  }
}

function evaluateD2(ctx: AccountContext, c: AdCase): D2Result {
  if (c.ownBase === null) return {}
  const base = sumDays(c.ownBase)
  if (base.impressions < D2_MIN_BASE_IMPRESSIONS) return {}
  if (base.impressions <= 0 || base.clicks / base.impressions < D2_CTR_SIGNAL_FLOOR) return {}
  if (c.recentTotals.impressions < D2_MIN_RECENT_IMPRESSIONS) return {}
  if (!passesCostFloor(c.recentTotals, base)) return {}
  const v = judgeStep({
    recentSuccess: c.recentTotals.clicks,
    recentTrials: c.recentTotals.impressions,
    baseSuccess: base.clicks,
    baseTrials: base.impressions,
    recentDaily: c.recent.map(d => ({ success: d.clicks, trials: d.impressions })),
    minRelativeDrop: D2_MIN_CTR_DROP,
  })
  if (v.reason !== 'ok') return {}
  if (c.changed) return { note: recentlyChangedNote(ctx, c, 'D2') }
  return { candidate: { code: 'D2', p: v.p, build: adj => d2Hit(ctx, c, base, v, adj) } }
}

function ownBaselineUsable(base: FunnelTotals): boolean {
  return base.results >= D10_MIN_BASE_RESULTS && base.linkClicks >= D10_MIN_BASE_LINK_CLICKS
}

function peerBaseline(ctx: AccountContext, input: DiagnosisInput, c: AdCase, rowsByAd: Map<string, DailyRow[]>, baseline: readonly string[], recent: readonly string[]): BaselineChoice | null {
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
  // 同组对照只用来抓「新广告抢了老广告的钱」（手册 §18）：这条广告在同一段时间里花得比同组其他广告合计还多，
  // 它自己就是这个组的主力，拿组里被饿着的小广告当对照会把主力判成坏的（2026-09-26 生产回放：组里花费第一的广告被误报）。
  const own = sumDays(series(rowsByAd.get(c.ad.entity_id) ?? [], allDays, c.metric, c.opts).days)
  if (own.spend > base.spend) return null
  if (!ownBaselineUsable(base)) return null
  return { base, source: 'same_adset_peers', peerCount }
}

function chooseBaseline(ctx: AccountContext, input: DiagnosisInput, c: AdCase, rowsByAd: Map<string, DailyRow[]>, baseline: readonly string[], recent: readonly string[]): BaselineChoice | null {
  if (c.ownBase !== null) {
    const base = sumDays(c.ownBase)
    if (ownBaselineUsable(base)) return { base, source: 'own_history', peerCount: null }
  }
  // 自身历史不可用（天数不够或量不够）才退到同组对照。同期同组的结构改动对两边一样，所以不挂「最近改过」闸。
  return peerBaseline(ctx, input, c, rowsByAd, baseline, recent)
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

function evaluateD10(ctx: AccountContext, input: DiagnosisInput, c: AdCase, rowsByAd: Map<string, DailyRow[]>, recent: readonly string[], baseline: readonly string[]): D10Result {
  if (c.metric === null) return {}
  const choice = chooseBaseline(ctx, input, c, rowsByAd, baseline, recent)
  if (choice === null) return {}
  const { base, source, peerCount } = choice
  if (!passesCostFloor(c.recentTotals, base)) return {}
  const v = d10Verdict(c, base)
  const costMultiple = costMultipleOf(base, c.recentTotals)
  const perImpressionDrop = impressionResultDrop(base, c.recentTotals)
  if (v.reason === 'ok' && costMultiple !== null && costMultiple >= D10_MIN_COST_MULTIPLE && perImpressionDrop >= D10_MIN_CVR_DROP) {
    if (source === 'own_history' && c.changed) return { note: recentlyChangedNote(ctx, c, 'D10') }
    return { candidate: { code: 'D10', p: v.p, build: adj => d10Hit(ctx, c, base, v, adj, source, peerCount) } }
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
  const fallback = c.isNewAd ? '停掉这条新广告，同组老广告不动' : '先查表单问题数、落地页、私信开场最近有没有改过，再决定要不要停；先别动预算'
  return { after, condition, fallback }
}

function d10Hit(ctx: AccountContext, c: AdCase, base: FunnelTotals, v: StepVerdict, adj: number, source: 'own_history' | 'same_adset_peers', peerCount: number | null): Diagnosis {
  const noun = c.metric ? CORE_METRIC_NOUN[c.metric] : '结果'
  const baseCpr = costPerResult(base)
  const recentCpr = costPerResult(c.recentTotals)
  const days = checkBackDays(v, c.recentTotals.linkClicks)
  const after = afterText(ctx, days)
  const checkBack = d10CheckBack(ctx, c, base, source, days)
  const title = d10Title(ctx, c, v, source, recentCpr, baseCpr)
  const own = source === 'own_history'
  const basis = `对照：${sourceLabel(source)}（${own ? '前 14 天，已剔除上线头 7 天' : `同组其他 ${peerCount ?? 0} 条广告近 17 天合计`}）· 近 3 天链接点击 ${c.recentTotals.linkClicks}、${noun} ${c.recentTotals.results} · 按对照应有约 ${v.expected.toFixed(1)} 个 · 校正后 p=${Number(adj.toPrecision(2))}`
  const suggestion = `问题在点进去之后（表单问题数 / 落地页 / 私信开场），不是素材。` + (c.isNewAd ? '这是新加的广告：测试版不该跟已验证的老广告放在同一个组里一起跑。' : '先查这条最近有没有换过表单或开场白。')
  const stopLoss = `止损：${after}回头看——${checkBack.condition}，就${checkBack.fallback}`
  const discipline = '一次只改一处；任何改动都会让系统重新学习，改完别再追着改'
  return {
    code: 'D10',
    status: 'hit',
    title,
    units: unitsFor(ctx, c),
    evidence: baseEvidence(ctx, c, base, source, peerCount, v, adj, {}),
    sample: sampleFor(c, '链接点击', base),
    reasons: [basis, suggestion, stopLoss, discipline],
    clientVisible: false,
    checkBack,
  }
}

function recentlyChangedNote(ctx: AccountContext, c: AdCase, code: 'D2' | 'D10'): Diagnosis {
  const name = c.ad.entity_name ?? c.ad.entity_id
  return {
    code,
    status: 'not_comparable',
    notComparableReason: 'recently_changed',
    title: `「${name}」看着在变差，但这几天改过设置或整组停过，先等 7 天再判`,
    units: unitsFor(ctx, c),
    evidence: { window_end: ctx.date, recent_spend: c.recentTotals.spend },
    sample: [{ label: '近 3 天花费', value: c.recentTotals.spend }],
    reasons: ['自身前后比对被改动打断了：改动会让系统重新学习，这时候再改只会更乱'],
    clientVisible: false,
  }
}

function thinSampleNote(ctx: AccountContext, c: AdCase, v: StepVerdict, costMultiple: number): Diagnosis {
  const name = c.ad.entity_name ?? c.ad.entity_id
  const noun = c.metric ? CORE_METRIC_NOUN[c.metric] : '结果'
  const multipleText = costMultiple === Infinity ? '很多' : `${costMultiple.toFixed(1)} 倍`
  const need = v.baseRate > 0 ? Math.ceil(RULE_MIN_EXPECTED / v.baseRate) : 0
  return {
    code: 'D10',
    status: 'not_comparable',
    notComparableReason: 'below_min_sample',
    title: `「${name}」每个${noun}贵了 ${multipleText}，但链接点击才 ${c.recentTotals.linkClicks} 次，还不够判`,
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
    reasons: ['一个广告账户里可能投着别的客户的广告，不登记主页就可能把别人的广告算到这个客户头上'],
    clientVisible: false,
    manualTask: {
      what: '客户没登记 Facebook 主页，广告级检查（素材疲劳 / 点进去之后差了）整段没跑',
      how: '打开客户设置页，在 Facebook 主页一栏绑定这个客户自己的主页（系统会先向 Meta 核实）',
      href: `https://app.magicengine.com.au/dashboard/clients/${input.clientId}/settings`,
    },
  }
}

function hasRecentSpend(rows: readonly DailyRow[], recent: readonly string[]): boolean {
  const inDays = new Set(recent)
  return rows.some(r => inDays.has(r.insight_date) && r.spend > 0)
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
