/**
 * D11 · 再营销受众池断供（设计 docs/specs/2026-09-27-ads-d11-audience-pool-starved-design.md v2，手册 §二十八）。
 *
 * 只读：只发现 + 建议进 PM 待办；开顶层广告是新增花费，必须人点，系统绝不自动开。
 *
 * 三条同时成立才命中：
 *   ① 视频类池子 7 天没长（中位数口径，缩也算）；
 *   ② 供血太少：创意视频在池子收人规则里、且所在组不用这个池子的广告，近 7 天花费
 *      ≤ 10% × 消耗这个池子的组的花费（直接证据）；
 *   ③ 有在投组在消耗这个池子（不限角色）。
 *
 * 点击率与频次只作说明材料、决定措辞，不作门槛（CTR 3 天噪声约 ±12%，2026-09-27 魏征复算）。
 */

import type { AccountContext } from './context'
import { adsetRows, isDelivering, localDayEndUtc, money, shiftDate, sumSpend, unitOf, windowDays } from './context'
import { campaignFrequency, toLocalDate } from './d2-d10-ad-rules'
import type { AudienceCountPoint, Diagnosis, DiagnosisInput } from './types'
import type { EntitySnapshotRow } from '../snapshot'
import { D4_AUDIENCE_FLOOR, D11_MAX_FEED_SHARE, D11_MIN_SNAPSHOT_DAYS, D11_POOL_FLAT_ABS, D11_POOL_FLAT_PCT, D11_POOL_WINDOW_DAYS } from './thresholds'
import { FATIGUE_FREQUENCY_HIGH } from '../../rules/fatigue'

/**
 * 🔴 候选值（2026-09-27 子牙/魏征）：池子一周缩一成以上，多半是收人规则或 Meta 口径变了，
 * 不开「补新人」的药。只有 CTS 一家的证据，换客户观察后再调。
 */
export const D11_MAX_WEEKLY_SHRINK = 0.1

/**
 * 🔴 候选值（2026-09-27，只有 CTS 证据）：某天供血广告合计花费 ≥ 当期日均消耗的这个比例，才算「像样的供血」。
 * 回放：专门补人的顶层组那天约 44%，冷启动组里顺带喂的一条只有 14–18%——用 10% 会把顺带喂的也算成像样供血（卫青审查窗口）。
 */
export const D11_STRONG_FEED_DAY_SHARE = 0.25

function isVideoPool(a: EntitySnapshotRow): boolean {
  const videoish = a.audience_subtype === 'VIDEO' || a.audience_rule_events.some(e => /video/i.test(e))
  return videoish && (a.audience_count_lower ?? 0) > D4_AUDIENCE_FLOOR && a.audience_rule_object_ids.length > 0
}

export function dailyCounts(history: AudienceCountPoint[], audienceId: string, days: string[], tz: string | null): Array<{ day: string; count: number }> {
  const inDays = new Set(days)
  const earliest = new Map<string, { at: number; count: number }>()
  for (const p of history) {
    if (p.entity_id !== audienceId) continue
    // 显示值 ≤ 1000 是 Meta 的显示下限，不是真实人数：几百人涨到 1400 会被误判成「没长」。
    if (p.audience_count_lower === null || p.audience_count_lower <= D4_AUDIENCE_FLOOR) continue
    const day = toLocalDate(p.captured_at, tz)
    if (!inDays.has(day)) continue
    const at = Date.parse(p.captured_at)
    const prev = earliest.get(day)
    if (!prev || at < prev.at) earliest.set(day, { at, count: p.audience_count_lower })
  }
  return Array.from(earliest.entries())
    .map(([day, v]) => ({ day, count: v.count }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0))
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export interface FlatResult {
  first: number
  last: number
  delta: number
  tolerance: number
  flat: boolean
  days: number
}

export function poolFlat(counts: Array<{ day: string; count: number }>, latest: number): FlatResult | null {
  if (counts.length < D11_MIN_SNAPSHOT_DAYS) return null
  const first = median(counts.slice(0, 3).map(c => c.count))
  const last = median(counts.slice(-3).map(c => c.count))
  const delta = last - first
  const tolerance = Math.max(D11_POOL_FLAT_ABS, D11_POOL_FLAT_PCT * latest)
  return { first, last, delta, tolerance, flat: delta <= tolerance, days: counts.length }
}

function poolRuleChanged(ctx: AccountContext, audienceId: string, days: string[]): boolean {
  const changes = ctx.account.settingChanges
  if (!changes) return false
  const start = days[0]
  const end = ctx.date
  return changes.some(c => {
    if (c.entity_id !== audienceId) return false
    const day = toLocalDate(c.captured_at, ctx.account.timezone)
    return day >= start && day <= end
  })
}

function consumerAdsets(ctx: AccountContext, input: DiagnosisInput, audienceId: string, days: string[]): EntitySnapshotRow[] {
  const out: EntitySnapshotRow[] = []
  for (const adset of Array.from(ctx.adsets.values())) {
    if (!isDelivering(adset)) continue
    if (ctx.experimentIds.has(adset.entity_id)) continue
    if (adset.campaign_id && ctx.experimentIds.has(adset.campaign_id)) continue
    if (!adset.included_audience_ids.includes(audienceId)) continue
    if (sumSpend(adsetRows(ctx, [adset.entity_id], days)) <= 0) continue
    const hasAd = ctx.ads.some(ad =>
      ad.adset_id === adset.entity_id &&
      isDelivering(ad) &&
      ad.creative_page_id === input.clientPageId,
    )
    if (!hasAd) continue
    out.push(adset)
  }
  return out.sort((a, b) => (a.entity_id < b.entity_id ? -1 : a.entity_id > b.entity_id ? 1 : 0))
}

/** 当前在的广告 + 近 35 天出现过、后来被归档/删除的广告（窗口内花过的钱也要算上）。 */
function allAds(ctx: AccountContext): EntitySnapshotRow[] {
  const current = ctx.ads
  const seen = new Set(current.map(a => a.entity_id))
  const archived = (ctx.account.recentAds ?? []).filter(a => !seen.has(a.entity_id))
  return [...current, ...archived]
}

function feederAdIds(ctx: AccountContext, input: DiagnosisInput, pool: EntitySnapshotRow): Set<string> {
  const ruleObjects = new Set(pool.audience_rule_object_ids)
  const ids = new Set<string>()
  for (const ad of allAds(ctx)) {
    if (ad.creative_page_id !== input.clientPageId) continue
    if (!ad.creative_video_ids.some(v => ruleObjects.has(v))) continue
    const adset = ad.adset_id ? ctx.adsets.get(ad.adset_id) : undefined
    // 找不到广告组（已归档）→ 当作「不用这个池子」，算供血。
    const includesPool = !!adset && adset.included_audience_ids.includes(pool.entity_id)
    if (includesPool) continue
    ids.add(ad.entity_id)
  }
  return ids
}

function adSpend(ctx: AccountContext, adIds: Set<string>, days: string[]): number {
  const rows = ctx.account.adDaily ?? []
  const inDays = new Set(days)
  let total = 0
  for (const r of rows) {
    if (r.level !== 'ad') continue
    if (!adIds.has(r.entity_id)) continue
    if (!inDays.has(r.insight_date)) continue
    total += r.spend
  }
  return Math.round(total * 100) / 100
}

/**
 * 像样的供血最后一次是哪天：某天供血广告合计花费 ≥ 25% × 日均消耗池子的花费。
 * 近 28 天都没有 → null。
 */
function lastStrongFeedDate(ctx: AccountContext, feeders: Set<string>, consumerSpend: number, days: string[]): string | null {
  const rows = ctx.account.adDaily ?? []
  const threshold = D11_STRONG_FEED_DAY_SHARE * (consumerSpend / days.length)
  const byDay = new Map<string, number>()
  for (const r of rows) {
    if (r.level !== 'ad') continue
    if (!feeders.has(r.entity_id)) continue
    byDay.set(r.insight_date, (byDay.get(r.insight_date) ?? 0) + r.spend)
  }
  let latest: string | null = null
  for (const [day, spend] of byDay) {
    if (spend < threshold) continue
    if (latest === null || day > latest) latest = day
  }
  return latest
}

function spendingAdCount(ctx: AccountContext, adIds: Set<string>, days: string[]): number {
  const rows = ctx.account.adDaily ?? []
  const inDays = new Set(days)
  const spending = new Set<string>()
  for (const r of rows) {
    if (r.level !== 'ad') continue
    if (!adIds.has(r.entity_id)) continue
    if (!inDays.has(r.insight_date)) continue
    if (r.spend > 0) spending.add(r.entity_id)
  }
  return spending.size
}

function ctrMedians(ctx: AccountContext, adsetId: string): { recent: number | null; base: number | null } {
  const rows = adsetRows(ctx, [adsetId], windowDays(ctx.date, 17))
  const recentDays = new Set(windowDays(ctx.date, 3))
  const recent: number[] = []
  const base: number[] = []
  for (const r of rows) {
    if (r.impressions <= 0) continue
    const ctr = r.clicks / r.impressions
    if (recentDays.has(r.insight_date)) recent.push(ctr)
    else base.push(ctr)
  }
  return {
    recent: recent.length > 0 ? median(recent) : null,
    base: base.length > 0 ? median(base) : null,
  }
}

function saturation28(ctx: AccountContext, adsetIds: string[], latest: number): number {
  if (latest <= 0) return 0
  const rows = adsetRows(ctx, adsetIds, windowDays(ctx.date, 28))
  const impressions = rows.reduce((s, r) => s + r.impressions, 0)
  return Math.round((impressions / latest) * 100) / 100
}

type Impact = 'affecting' | 'early' | 'unknown'

function impactSuffix(main: EntitySnapshotRow, ctr: { recent: number | null; base: number | null }, freq: number | null, impact: Impact): string {
  const pct = (r: number) => (r * 100).toFixed(1) + '%'
  if (impact === 'unknown') return '——对再营销的影响判不了（点击率或频次数据不全），先按断供处理'
  if (impact === 'affecting') {
    const mainName = main.entity_name ?? main.entity_id
    return `——已经开始影响再营销：「${mainName}」点击率从之前两周的 ${pct(ctr.base as number)} 降到 ${pct(ctr.recent as number)}，所在系列 7 天频次只有 ${(freq as number).toFixed(1)}`
  }
  return '——还没明显影响再营销，这是提前提醒'
}

function feedSuffix(ctx: AccountContext, lastStrong: string | null, days: string[]): string {
  if (lastStrong === null) return '；近 28 天都没有像样的供血'
  if (lastStrong >= days[0]) return ''
  const n = Math.round((Date.parse(`${ctx.date}T00:00:00Z`) - Date.parse(`${lastStrong}T00:00:00Z`)) / 86_400_000)
  return `；像样的供血最后一次在 ${lastStrong}（${n} 天前）`
}

function poolAgeSentence(ageDays: number | null, retention: number | null): string {
  if (ageDays !== null && retention !== null && retention > 0 && ageDays < retention) {
    return `池子建了 ${ageDays} 天，保留期 ${retention} 天，还没有人到期被移出——没长就是真的没新人进来。`
  }
  if (ageDays !== null && retention !== null && retention > 0) {
    return `池子已建 ${ageDays} 天，超过保留期 ${retention} 天，没长也可能是进出打平；这条主要依据供血花费。`
  }
  return '拿不到池子建立时间或保留期，没长的含义以供血花费为准。'
}

function buildReasons(ctx: AccountContext, ageDays: number | null, retention: number | null): string[] {
  return [
    '开顶层视频广告给这个池子补新人（新增花费，要你点头才开，系统不会自动开）。开之前两件事：① 要投的视频必须先加进这个池子的收人规则（读回原规则 → 追加 → 写回 → 读回核对，别覆盖原有的）；② 另建独立系列，版位锁 Facebook/Instagram，开后按版位回读，Audience Network 花费应接近 0。挑供血素材看内容对不对、新不新，不看历史完播率。正在跑的再营销组本身不动（一次只改一处）。如果这些广告组里有广告同时报了点击率下降，先补人、再判素材。未证实：改一个正在被在投广告组使用的受众的收人规则，会不会让那个组重新学习，还没验证过。',
    `止损：14 天后（约 ${shiftDate(ctx.date, 14)}）回头看——池子有没有开始长（首要）、要投的视频是否已在收人规则里，再营销点击率只作辅助参考；池子还不长，就先查收人规则和供血广告的版位`,
    poolAgeSentence(ageDays, retention),
  ]
}

function buildDiagnosis(
  ctx: AccountContext,
  pool: EntitySnapshotRow,
  consumers: EntitySnapshotRow[],
  main: EntitySnapshotRow,
  flat: FlatResult,
  feedSpend: number,
  consumerSpend: number,
  feeders: Set<string>,
  ctr: { recent: number | null; base: number | null },
  freq: number | null,
  impact: Impact,
  days: string[],
): Diagnosis {
  const rawAge = pool.audience_created_at
    ? Math.floor((localDayEndUtc(ctx.date, ctx.account.timezone) - Date.parse(pool.audience_created_at)) / 86_400_000)
    : null
  const ageDays = rawAge !== null && Number.isNaN(rawAge) ? null : rawAge
  const retention = pool.audience_retention_days
  const feederSpending = spendingAdCount(ctx, feeders, days)
  const name = pool.entity_name ?? pool.entity_id
  const lastStrong = lastStrongFeedDate(ctx, feeders, consumerSpend, days)
  const title = `再营销受众池断供：「${name}」7 天没长（${Math.round(flat.first)}→${Math.round(flat.last)} 人），给它供人的广告最近 7 天只花了 ${money(ctx, feedSpend)}（在花钱的 ${feederSpending} 条），用它的广告组花了 ${money(ctx, consumerSpend)}`
    + feedSuffix(ctx, lastStrong, days)
    + impactSuffix(main, ctr, freq, impact)

  const reasons = buildReasons(ctx, ageDays, retention)

  const evidence: Record<string, string | number | boolean | null> = {
    audience_id: pool.entity_id,
    audience_name: pool.entity_name,
    window_start: days[0],
    window_end: ctx.date,
    snapshot_days: flat.days,
    pool_first_median: flat.first,
    pool_last_median: flat.last,
    pool_delta: flat.delta,
    pool_tolerance: flat.tolerance,
    pool_latest: pool.audience_count_lower,
    feed_spend: feedSpend,
    consumer_spend: consumerSpend,
    feed_share: consumerSpend > 0 ? Math.round((feedSpend / consumerSpend) * 1000) / 1000 : null,
    feeder_ads: feeders.size,
    feeder_ads_spending: feederSpending,
    last_strong_feed_date: lastStrong,
    pool_age_days: ageDays,
    retention_days: retention ?? null,
    consumer_adsets: consumers.length,
    main_adset_id: main.entity_id,
    ctr_recent_median: ctr.recent === null ? null : Math.round(ctr.recent * 10000) / 10000,
    ctr_base_median: ctr.base === null ? null : Math.round(ctr.base * 10000) / 10000,
    frequency_7d: freq,
    saturation_28d: saturation28(ctx, consumers.map(c => c.entity_id), pool.audience_count_lower ?? 0),
    impact,
  }

  return {
    code: 'D11',
    status: 'hit',
    title,
    units: consumers.map(c => unitOf(ctx, 'adset', c.entity_id)),
    evidence,
    sample: [
      { label: '近 7 天池子快照天数', value: flat.days },
      { label: '规则视频相关广告条数（含没花钱的）', value: feeders.size },
      { label: '其中近 7 天花了钱的', value: feederSpending },
    ],
    reasons,
    clientVisible: false,
    checkBack: {
      after: `14 天后（约 ${shiftDate(ctx.date, 14)}）`,
      condition: '池子有没有开始长；要投的视频是否已在收人规则里',
      fallback: '池子还不长，先查收人规则里有没有这条视频、供血广告的版位是不是只在 Facebook/Instagram',
    },
  }
}

function evaluatePool(ctx: AccountContext, input: DiagnosisInput, pool: EntitySnapshotRow, days: string[]): Diagnosis | null {
  if (!isVideoPool(pool)) return null
  if (poolRuleChanged(ctx, pool.entity_id, days)) return null

  const counts = dailyCounts(ctx.account.audienceHistory ?? [], pool.entity_id, days, ctx.account.timezone)
  const flat = poolFlat(counts, pool.audience_count_lower as number)
  if (!flat || !flat.flat) return null
  // 池子一周缩一成以上，多半是收人规则或 Meta 口径变了，不开「补新人」的药。
  if (flat.delta < -D11_MAX_WEEKLY_SHRINK * flat.first) return null

  const consumers = consumerAdsets(ctx, input, pool.entity_id, days)
  if (consumers.length === 0) return null
  const consumerSpend = sumSpend(adsetRows(ctx, consumers.map(c => c.entity_id), days))
  if (consumerSpend <= 0) return null

  const feeders = feederAdIds(ctx, input, pool)
  const feedSpend = adSpend(ctx, feeders, days)
  if (feedSpend > D11_MAX_FEED_SHARE * consumerSpend) return null

  const spendByAdset = new Map<string, number>()
  for (const c of consumers) {
    spendByAdset.set(c.entity_id, sumSpend(adsetRows(ctx, [c.entity_id], days)))
  }
  let main = consumers[0]
  let mainSpend = spendByAdset.get(main.entity_id) ?? 0
  for (const c of consumers) {
    const s = spendByAdset.get(c.entity_id) ?? 0
    if (s > mainSpend) {
      main = c
      mainSpend = s
    }
  }

  const ctr = ctrMedians(ctx, main.entity_id)
  const freq = main.campaign_id ? campaignFrequency(ctx, main.campaign_id) : null
  const impact = classifyImpact(ctr, freq)

  return buildDiagnosis(ctx, pool, consumers, main, flat, feedSpend, consumerSpend, feeders, ctr, freq, impact, days)
}

function classifyImpact(ctr: { recent: number | null; base: number | null }, freq: number | null): Impact {
  if (ctr.recent === null || ctr.base === null || ctr.base <= 0) return 'unknown'
  if (ctr.recent < ctr.base * 0.9) {
    if (freq === null) return 'unknown'
    return freq < FATIGUE_FREQUENCY_HIGH ? 'affecting' : 'early'
  }
  return 'early'
}

export function diagnoseAudiencePoolStarved(ctx: AccountContext, input: DiagnosisInput): Diagnosis[] {
  if (input.clientPageId === null || input.clientPageId === undefined) return []
  if (ctx.account.adDaily === undefined) return []
  if (ctx.account.audienceHistory === undefined) return []

  const days = windowDays(ctx.date, D11_POOL_WINDOW_DAYS)
  const out: Diagnosis[] = []
  for (const pool of Array.from(ctx.audiences.values())) {
    const d = evaluatePool(ctx, input, pool, days)
    if (d) out.push(d)
  }
  return out.sort((a, b) => {
    const ai = String(a.evidence.audience_id ?? '')
    const bi = String(b.evidence.audience_id ?? '')
    return ai < bi ? -1 : ai > bi ? 1 : 0
  })
}
