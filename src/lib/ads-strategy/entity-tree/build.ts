/**
 * Pure builder: stored daily insight rows + latest entity snapshots → campaign → adset → ad tree.
 * Read-only, no I/O, no clock, no randomness.
 */

import { pickWinnerBaseline, type FunnelRates } from './funnel-baseline'
import { audienceChangedOn, judgeCreatives, type AudienceSnapshot, type CreativeVerdict } from './creative-compare'
import { resolveCoreMetric, type CoreMetric } from '../rules/core-metric'
import type { OutcomeStep } from '../portfolio/outcome-ladder'

export interface InsightRow {
  level: 'campaign' | 'adset' | 'ad'
  entityId: string
  entityName: string | null
  parentId: string | null
  date: string
  spend: number
  impressions: number
  clicks: number
  leads: number
  messagingConversations: number
  /** Link clicks from actions. Null = this row did not store actions (do not treat as zero). */
  linkClicks?: number | null
  video3sViews?: number | null
}

export interface SnapshotRow {
  level: 'campaign' | 'adset' | 'ad'
  entityId: string
  entityName: string | null
  campaignId: string | null
  adsetId: string | null
  effectiveStatus: string | null
  dailyBudgetMinor: number | null
  currency: string | null
  capturedAt: string
  /** ads only: Facebook page the ad's creative posts from (tells whose ad it is in a shared account) */
  creativePageId?: string | null
  /** ad sets only: Meta destination_type / optimization_goal, used to pick the ad set's own result type */
  destinationType?: string | null
  optimizationGoal?: string | null
  /** ad sets only: stable key of audience + placements (creative-compare audienceKeyOf); null = not stored */
  audienceKey?: string | null
}

export interface TreeOptions {
  endDate: string
  days: number
  /** campaigns whose campaign-level totals include another client's ad sets: totals are not shown */
  sharedCampaignIds?: ReadonlySet<string>
  /** client's configured primary result; only breaks the messaging + lead-form tie (rules/core-metric) */
  clientPrimary?: OutcomeStep | null
  /** industry playbook creativeCompareMinLinkClicks; null/undefined = no threshold */
  minLinkClicks?: number | null
  /** wider snapshot list used only for audience-change detection (defaults to `snapshots`) */
  audienceSnapshots?: SnapshotRow[]
  /** IANA zone used to bucket audience-change days (defaults to UTC) */
  timeZone?: string
}

export type DeliveryState = 'running' | 'stopped' | 'unknown'

export interface EntityMetrics {
  spend: number
  impressions: number
  clicks: number
  leads: number
  messagingConversations: number
  linkClicks: number
  video3sViews: number
  costPerLead: number | null
  /** Link clicks ÷ impressions. Null when link clicks were not stored. */
  ctr: number | null
  activeDays: number
  /** true when at least one row stored link clicks */
  linkClicksStored: boolean
}

export interface AdNode {
  id: string
  name: string
  state: DeliveryState
  effectiveStatus: string | null
  metrics: EntityMetrics
  creative: CreativeVerdict
}

export interface AdsetNode {
  id: string
  name: string
  state: DeliveryState
  effectiveStatus: string | null
  dailyBudget: number | null
  currency: string | null
  metrics: EntityMetrics
  ads: AdNode[]
  /** the one result this ad set is judged on (rules/core-metric); null = video views / reach / other */
  resultType: CoreMetric | null
  /** false = no snapshot ever stored a destination or optimization goal for this ad set */
  targetKnown: boolean
  /** first day inside the window on which audience or placements changed; null = no change seen */
  audienceChangedOn: string | null
}

export interface CampaignNode {
  id: string
  name: string
  state: DeliveryState
  effectiveStatus: string | null
  metrics: EntityMetrics
  adsets: AdsetNode[]
  runningAdsets: number
  runningAds: number
  /** true = the campaign-level totals also contain ad sets that are not this client's, so metrics are zeroed and must not be shown */
  metricsShared: boolean
  /** ads with spend that could not be placed under an ad set (deleted ads have no ad set in the snapshots) */
  unplacedAds: { count: number; spend: number; leads: number }
}

export interface EntityTree {
  window: { since: string; until: string; days: number }
  snapshotAt: string | null
  campaigns: CampaignNode[]
  /** Account winner (an ad with at least 20 leads). Null = 样本不足. */
  winnerBaseline: FunnelRates | null
}

type Level = 'campaign' | 'adset' | 'ad'

const DAY_MS = 86_400_000

function dayNumber(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS)
}

function formatDay(n: number): string {
  const dt = new Date(n * DAY_MS)
  const y = dt.getUTCFullYear()
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const d = String(dt.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function windowOf(opts: TreeOptions): { since: string; until: string; days: number } {
  const until = opts.endDate
  const since = formatDay(dayNumber(until) - (opts.days - 1))
  return { since, until, days: opts.days }
}

function stateOf(effectiveStatus: string | null): DeliveryState {
  if (effectiveStatus === null) return 'unknown'
  if (effectiveStatus === 'ACTIVE') return 'running'
  if (effectiveStatus === 'IN_PROCESS' || effectiveStatus === 'PENDING_REVIEW' || effectiveStatus === 'WITH_ISSUES') {
    return 'unknown'
  }
  return 'stopped'
}

function emptyMetrics(): EntityMetrics {
  return {
    spend: 0,
    impressions: 0,
    clicks: 0,
    leads: 0,
    messagingConversations: 0,
    linkClicks: 0,
    video3sViews: 0,
    costPerLead: null,
    ctr: null,
    activeDays: 0,
    linkClicksStored: false,
  }
}

function metricsOf(rows: InsightRow[]): EntityMetrics {
  const m = emptyMetrics()
  const dates = new Set<string>()
  let sawLink = false
  for (const r of rows) {
    m.spend += r.spend
    m.impressions += r.impressions
    m.clicks += r.clicks
    m.leads += r.leads
    m.messagingConversations += r.messagingConversations
    if (r.linkClicks != null) {
      m.linkClicks += r.linkClicks
      sawLink = true
    }
    m.video3sViews += r.video3sViews ?? 0
    if (r.spend > 0) dates.add(r.date)
  }
  m.activeDays = dates.size
  m.costPerLead = m.leads > 0 ? m.spend / m.leads : null
  m.ctr = m.impressions > 0 && sawLink ? m.linkClicks / m.impressions : null
  m.linkClicksStored = sawLink
  return m
}

function latestSnapshots(snapshots: SnapshotRow[]): Map<string, SnapshotRow> {
  const map = new Map<string, SnapshotRow>()
  for (const s of snapshots) {
    const key = `${s.level}|${s.entityId}`
    const prev = map.get(key)
    if (!prev || s.capturedAt > prev.capturedAt) map.set(key, s)
  }
  return map
}

function snapshotAtOf(snapshots: SnapshotRow[]): string | null {
  let max: string | null = null
  for (const s of snapshots) {
    if (max === null || s.capturedAt > max) max = s.capturedAt
  }
  return max
}

interface EntityInfo {
  id: string
  level: Level
  name: string
  state: DeliveryState
  effectiveStatus: string | null
  dailyBudget: number | null
  currency: string | null
  parentId: string | null
  campaignHint: string | null
}

function nameOf(snap: SnapshotRow | undefined, rows: InsightRow[], id: string): string {
  if (snap && snap.entityName !== null && snap.entityName !== '') return snap.entityName
  let latest: InsightRow | null = null
  for (const r of rows) {
    if (r.entityName !== null && r.entityName !== '') {
      if (latest === null || r.date > latest.date) latest = r
    }
  }
  if (latest !== null && latest.entityName !== null) return latest.entityName
  return id
}

function parentOf(snap: SnapshotRow | undefined, rows: InsightRow[], level: Level): string | null {
  if (level === 'campaign') return null
  if (snap) {
    if (level === 'adset' && snap.campaignId !== null) return snap.campaignId
    if (level === 'ad' && snap.adsetId !== null) return snap.adsetId
  }
  // An ad's insight rows carry the CAMPAIGN as parent (not the ad set), so an ad is never placed by them.
  if (level === 'ad') return null
  let latest: InsightRow | null = null
  for (const r of rows) {
    if (r.parentId !== null) {
      if (latest === null || r.date > latest.date) latest = r
    }
  }
  return latest !== null ? latest.parentId : null
}

function campaignHintOf(snap: SnapshotRow | undefined, rows: InsightRow[]): string | null {
  if (snap && snap.campaignId !== null) return snap.campaignId
  let latest: InsightRow | null = null
  for (const r of rows) {
    if (r.parentId !== null && (latest === null || r.date > latest.date)) latest = r
  }
  return latest !== null ? latest.parentId : null
}

function collectEntities(
  snapshots: Map<string, SnapshotRow>,
  rowsByEntity: Map<string, InsightRow[]>,
): Map<string, EntityInfo> {
  const ids = new Set<string>()
  for (const s of snapshots.values()) ids.add(`${s.level}|${s.entityId}`)
  for (const key of rowsByEntity.keys()) ids.add(key)

  const out = new Map<string, EntityInfo>()
  for (const key of ids) {
    const [level, id] = key.split('|') as [Level, string]
    const snap = snapshots.get(key)
    const rows = rowsByEntity.get(key) ?? []
    out.set(key, {
      id,
      level,
      name: nameOf(snap, rows, id),
      state: stateOf(snap ? snap.effectiveStatus : null),
      effectiveStatus: snap ? snap.effectiveStatus : null,
      dailyBudget: snap && snap.dailyBudgetMinor !== null ? snap.dailyBudgetMinor / 100 : null,
      currency: snap ? snap.currency : null,
      parentId: parentOf(snap, rows, level),
      campaignHint: campaignHintOf(snap, rows),
    })
  }
  return out
}

function sortByStateThenSpend<T extends { state: DeliveryState; metrics: EntityMetrics; name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ra = a.state === 'running' ? 0 : 1
    const rb = b.state === 'running' ? 0 : 1
    if (ra !== rb) return ra - rb
    if (b.metrics.spend !== a.metrics.spend) return b.metrics.spend - a.metrics.spend
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
}

function buildAd(info: EntityInfo, metrics: EntityMetrics, creative: CreativeVerdict): AdNode {
  return {
    id: info.id,
    name: info.name,
    state: info.state,
    effectiveStatus: info.effectiveStatus,
    metrics,
    creative,
  }
}

interface KnownTargets {
  destinationType: string | null
  optimizationGoal: string | null
}

/** Latest snapshot per ad set that stored a non-null destination OR optimization goal (any capture time). */
function lastKnownTargets(snapshots: SnapshotRow[]): Map<string, KnownTargets> {
  const latestAt = new Map<string, string>()
  const out = new Map<string, KnownTargets>()
  for (const s of snapshots) {
    if (s.level !== 'adset') continue
    const dest = s.destinationType ?? null
    const goal = s.optimizationGoal ?? null
    if (dest === null && goal === null) continue
    const prev = latestAt.get(s.entityId)
    if (prev !== undefined && s.capturedAt <= prev) continue
    latestAt.set(s.entityId, s.capturedAt)
    out.set(s.entityId, { destinationType: dest, optimizationGoal: goal })
  }
  return out
}

function buildAdsForAdset(
  adset: EntityInfo,
  infos: EntityInfo[],
  rowsByEntity: Map<string, InsightRow[]>,
  opts: TreeOptions,
  targets: Map<string, KnownTargets>,
): { ads: AdNode[]; resultType: CoreMetric | null; targetKnown: boolean } {
  const known = targets.get(adset.id)
  const targetKnown = known !== undefined
  const resultType = targetKnown
    ? resolveCoreMetric({
        destinationType: known.destinationType,
        optimizationGoal: known.optimizationGoal,
        clientPrimary: opts.clientPrimary ?? null,
      })
    : null
  const metrics = infos.map((i) => metricsOf(rowsByEntity.get(`ad|${i.id}`) ?? []))
  const verdicts = judgeCreatives(metrics, resultType, opts.minLinkClicks ?? null, targetKnown)
  const ads = infos.map((i, k) => buildAd(i, metrics[k], verdicts[k]))
  return { ads, resultType, targetKnown }
}

function audienceChangesByAdset(
  snapshots: SnapshotRow[],
  since: string,
  until: string,
  timeZone: string,
): Map<string, string | null> {
  const byAdset = new Map<string, AudienceSnapshot[]>()
  for (const s of snapshots) {
    if (s.level !== 'adset') continue
    const row: AudienceSnapshot = { capturedAt: s.capturedAt, audienceKey: s.audienceKey ?? null }
    const arr = byAdset.get(s.entityId)
    if (arr) arr.push(row)
    else byAdset.set(s.entityId, [row])
  }
  const out = new Map<string, string | null>()
  for (const [id, rows] of byAdset) out.set(id, audienceChangedOn(rows, since, until, timeZone))
  return out
}

function buildAdset(
  info: EntityInfo,
  rows: InsightRow[],
  ads: AdNode[],
  resultType: CoreMetric | null,
  targetKnown: boolean,
  audienceChange: string | null,
): AdsetNode {
  return {
    id: info.id,
    name: info.name,
    state: info.state,
    effectiveStatus: info.effectiveStatus,
    dailyBudget: info.dailyBudget,
    currency: info.currency,
    metrics: metricsOf(rows),
    ads: sortByStateThenSpend(ads),
    resultType,
    targetKnown,
    audienceChangedOn: audienceChange,
  }
}

function buildCampaign(
  info: EntityInfo,
  rows: InsightRow[],
  adsets: AdsetNode[],
  shared: boolean,
  unplacedAds: { count: number; spend: number; leads: number },
): CampaignNode {
  const sortedAdsets = sortByStateThenSpend(adsets)
  let runningAdsets = 0
  let runningAds = 0
  for (const a of sortedAdsets) {
    if (a.state === 'running') runningAdsets++
    for (const ad of a.ads) if (ad.state === 'running') runningAds++
  }
  return {
    id: info.id,
    name: info.name,
    state: info.state,
    effectiveStatus: info.effectiveStatus,
    metrics: metricsOf(shared ? [] : rows),
    adsets: sortedAdsets,
    runningAdsets,
    runningAds,
    metricsShared: shared,
    unplacedAds,
  }
}

function groupRowsByEntity(insights: InsightRow[], since: string, until: string): Map<string, InsightRow[]> {
  const map = new Map<string, InsightRow[]>()
  for (const r of insights) {
    if (r.date < since || r.date > until) continue
    const key = `${r.level}|${r.entityId}`
    const arr = map.get(key)
    if (arr) arr.push(r)
    else map.set(key, [r])
  }
  return map
}

function buildAdsetsByCampaign(
  adsets: Map<string, EntityInfo>,
  campaigns: Map<string, EntityInfo>,
  adInfosByAdset: Map<string, EntityInfo[]>,
  rowsByEntity: Map<string, InsightRow[]>,
  audienceChanges: Map<string, string | null>,
  targets: Map<string, KnownTargets>,
  opts: TreeOptions,
): Map<string, AdsetNode[]> {
  const out = new Map<string, AdsetNode[]>()
  for (const a of adsets.values()) {
    if (a.parentId === null || !campaigns.has(a.parentId)) continue
    const built = buildAdsForAdset(a, adInfosByAdset.get(a.id) ?? [], rowsByEntity, opts, targets)
    const node = buildAdset(
      a,
      rowsByEntity.get(`adset|${a.id}`) ?? [],
      built.ads,
      built.resultType,
      built.targetKnown,
      audienceChanges.get(a.id) ?? null,
    )
    const arr = out.get(a.parentId)
    if (arr) arr.push(node)
    else out.set(a.parentId, [node])
  }
  return out
}

function placeholderCampaign(id: string): EntityInfo {
  return {
    id,
    level: 'campaign',
    name: id,
    state: 'unknown',
    effectiveStatus: null,
    dailyBudget: null,
    currency: null,
    parentId: null,
    campaignHint: null,
  }
}

function unplacedByCampaign(
  ads: Map<string, EntityInfo>,
  adsets: Map<string, EntityInfo>,
  campaigns: Map<string, EntityInfo>,
  rowsByEntity: Map<string, InsightRow[]>,
): Map<string, { count: number; spend: number; leads: number }> {
  const unplaced = new Map<string, { count: number; spend: number; leads: number }>()
  for (const ad of ads.values()) {
    if (ad.parentId !== null && adsets.has(ad.parentId)) continue
    if (ad.campaignHint === null || !campaigns.has(ad.campaignHint)) continue
    const m = metricsOf(rowsByEntity.get(`ad|${ad.id}`) ?? [])
    if (m.spend <= 0) continue
    const cur = unplaced.get(ad.campaignHint) ?? { count: 0, spend: 0, leads: 0 }
    unplaced.set(ad.campaignHint, { count: cur.count + 1, spend: cur.spend + m.spend, leads: cur.leads + m.leads })
  }
  return unplaced
}

export function buildEntityTree(insights: InsightRow[], snapshots: SnapshotRow[], opts: TreeOptions): EntityTree {
  const window = windowOf(opts)
  const snapshotAt = snapshotAtOf(snapshots)
  const rowsByEntity = groupRowsByEntity(insights, window.since, window.until)
  const latest = latestSnapshots(snapshots)
  const entities = collectEntities(latest, rowsByEntity)

  const campaigns = new Map<string, EntityInfo>()
  const adsets = new Map<string, EntityInfo>()
  const ads = new Map<string, EntityInfo>()
  for (const e of entities.values()) {
    if (e.level === 'campaign') campaigns.set(e.id, e)
    else if (e.level === 'adset') adsets.set(e.id, e)
    else ads.set(e.id, e)
  }

  // Placeholder campaigns for orphan adsets.
  for (const a of adsets.values()) {
    if (a.parentId !== null && !campaigns.has(a.parentId)) campaigns.set(a.parentId, placeholderCampaign(a.parentId))
  }

  const adInfosByAdset = new Map<string, EntityInfo[]>()
  for (const ad of ads.values()) {
    if (ad.parentId === null || !adsets.has(ad.parentId)) continue
    const arr = adInfosByAdset.get(ad.parentId)
    if (arr) arr.push(ad)
    else adInfosByAdset.set(ad.parentId, [ad])
  }

  const audienceSource = opts.audienceSnapshots ?? snapshots
  const audienceChanges = audienceChangesByAdset(audienceSource, window.since, window.until, opts.timeZone ?? 'UTC')
  const targets = lastKnownTargets(audienceSource)
  const adsetsByCampaign = buildAdsetsByCampaign(adsets, campaigns, adInfosByAdset, rowsByEntity, audienceChanges, targets, opts)

  const unplaced = unplacedByCampaign(ads, adsets, campaigns, rowsByEntity)

  const campaignNodes: CampaignNode[] = []
  for (const c of campaigns.values()) {
    campaignNodes.push(buildCampaign(
      c,
      rowsByEntity.get(`campaign|${c.id}`) ?? [],
      adsetsByCampaign.get(c.id) ?? [],
      opts.sharedCampaignIds?.has(c.id) ?? false,
      unplaced.get(c.id) ?? { count: 0, spend: 0, leads: 0 },
    ))
  }

  const ranked = sortByStateThenSpend(campaignNodes)
  const adMetrics = ranked.flatMap((c) => c.adsets.flatMap((s) => s.ads.map((a) => a.metrics)))
  return { window, snapshotAt, campaigns: ranked, winnerBaseline: pickWinnerBaseline(adMetrics) }
}
