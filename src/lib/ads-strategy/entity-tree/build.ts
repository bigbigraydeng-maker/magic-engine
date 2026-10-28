/**
 * Pure builder: stored daily insight rows + latest entity snapshots → campaign → adset → ad tree.
 * Read-only, no I/O, no clock, no randomness.
 */

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
}

export interface TreeOptions {
  endDate: string
  days: number
}

export type DeliveryState = 'running' | 'stopped' | 'unknown'

export interface EntityMetrics {
  spend: number
  impressions: number
  clicks: number
  leads: number
  messagingConversations: number
  costPerLead: number | null
  ctr: number | null
  activeDays: number
}

export interface AdNode {
  id: string
  name: string
  state: DeliveryState
  effectiveStatus: string | null
  metrics: EntityMetrics
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
}

export interface EntityTree {
  window: { since: string; until: string; days: number }
  snapshotAt: string | null
  campaigns: CampaignNode[]
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
    costPerLead: null,
    ctr: null,
    activeDays: 0,
  }
}

function metricsOf(rows: InsightRow[]): EntityMetrics {
  const m = emptyMetrics()
  const dates = new Set<string>()
  for (const r of rows) {
    m.spend += r.spend
    m.impressions += r.impressions
    m.clicks += r.clicks
    m.leads += r.leads
    m.messagingConversations += r.messagingConversations
    if (r.spend > 0) dates.add(r.date)
  }
  m.activeDays = dates.size
  m.costPerLead = m.leads > 0 ? m.spend / m.leads : null
  m.ctr = m.impressions > 0 ? m.clicks / m.impressions : null
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
  let latest: InsightRow | null = null
  for (const r of rows) {
    if (r.parentId !== null) {
      if (latest === null || r.date > latest.date) latest = r
    }
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

function buildAd(info: EntityInfo, rows: InsightRow[]): AdNode {
  return {
    id: info.id,
    name: info.name,
    state: info.state,
    effectiveStatus: info.effectiveStatus,
    metrics: metricsOf(rows),
  }
}

function buildAdset(info: EntityInfo, rows: InsightRow[], ads: AdNode[]): AdsetNode {
  return {
    id: info.id,
    name: info.name,
    state: info.state,
    effectiveStatus: info.effectiveStatus,
    dailyBudget: info.dailyBudget,
    currency: info.currency,
    metrics: metricsOf(rows),
    ads: sortByStateThenSpend(ads),
  }
}

function buildCampaign(info: EntityInfo, rows: InsightRow[], adsets: AdsetNode[]): CampaignNode {
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
    metrics: metricsOf(rows),
    adsets: sortedAdsets,
    runningAdsets,
    runningAds,
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
    if (a.parentId !== null && !campaigns.has(a.parentId)) {
      campaigns.set(a.parentId, {
        id: a.parentId,
        level: 'campaign',
        name: a.parentId,
        state: 'unknown',
        effectiveStatus: null,
        dailyBudget: null,
        currency: null,
        parentId: null,
      })
    }
  }

  const adsByAdset = new Map<string, AdNode[]>()
  for (const ad of ads.values()) {
    if (ad.parentId === null || !adsets.has(ad.parentId)) continue
    const node = buildAd(ad, rowsByEntity.get(`ad|${ad.id}`) ?? [])
    const arr = adsByAdset.get(ad.parentId)
    if (arr) arr.push(node)
    else adsByAdset.set(ad.parentId, [node])
  }

  const adsetsByCampaign = new Map<string, AdsetNode[]>()
  for (const a of adsets.values()) {
    if (a.parentId === null || !campaigns.has(a.parentId)) continue
    const node = buildAdset(a, rowsByEntity.get(`adset|${a.id}`) ?? [], adsByAdset.get(a.id) ?? [])
    const arr = adsetsByCampaign.get(a.parentId)
    if (arr) arr.push(node)
    else adsetsByCampaign.set(a.parentId, [node])
  }

  const campaignNodes: CampaignNode[] = []
  for (const c of campaigns.values()) {
    campaignNodes.push(buildCampaign(c, rowsByEntity.get(`campaign|${c.id}`) ?? [], adsetsByCampaign.get(c.id) ?? []))
  }

  return {
    window,
    snapshotAt,
    campaigns: sortByStateThenSpend(campaignNodes),
  }
}
