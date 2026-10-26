import type { CatalogDepartureView, CatalogTourView } from './types'
import type { PublishChange } from '@/lib/tour-catalog/publish-contract'

export interface TourGroup {
  key: string
  title: string
  tours: CatalogTourView[]
}

export type TourFilter = 'all' | 'changed' | 'has_departures' | 'inactive'

export const TOUR_FILTERS: Array<{ id: TourFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'changed', label: '有改动未上架' },
  { id: 'has_departures', label: '有班期' },
  { id: 'inactive', label: '停售' },
]

/** "china" -> "China"; "new-zealand" or "new_zealand" -> "New Zealand"; trims; '' -> ''. */
export function titleCase(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  return trimmed
    .split(/[\s\-_]+/)
    .filter(part => part.length > 0)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
}

/** destination + tier, each title-cased, joined by a space. tier empty or 'unknown' (any case) -> destination only. Both empty -> '其他'. */
export function groupTitle(destination: string, tier: string): string {
  const dest = titleCase(destination)
  const tierTrimmed = tier.trim()
  const tierIsUnknown = tierTrimmed.toLowerCase() === 'unknown'
  const tierText = tierIsUnknown ? '' : titleCase(tierTrimmed)
  if (!dest && !tierText) return '其他'
  if (!tierText) return dest
  if (!dest) return tierText
  return `${dest} ${tierText}`
}

/** Group by `${destination}|${tier}` (lower-cased, trimmed) — keep first-appearance order of groups and of tours inside a group. */
export function groupTours(tours: CatalogTourView[]): TourGroup[] {
  const groups: TourGroup[] = []
  const index = new Map<string, TourGroup>()
  for (const tour of tours) {
    const dest = (tour.destination ?? '').trim().toLowerCase()
    const tier = (tour.tier ?? '').trim().toLowerCase()
    const key = `${dest}|${tier}`
    let group = index.get(key)
    if (!group) {
      group = { key, title: groupTitle(tour.destination, tour.tier), tours: [] }
      index.set(key, group)
      groups.push(group)
    }
    group.tours.push(tour)
  }
  return groups
}

export interface TourTierGroup {
  key: string
  title: string
  /** Same title the flat list used ("China Signature"): what a tour name may start with. */
  nameTitle: string
  tours: CatalogTourView[]
  departureCount: number
}

export interface TourRegionGroup {
  key: string
  title: string
  tiers: TourTierGroup[]
  tourCount: number
  departureCount: number
}

const REGION_ZH: Record<string, string> = {
  china: '中国',
  japan: '日本',
  vietnam: '越南',
  'new-zealand': '新西兰',
  'new zealand': '新西兰',
  australia: '澳大利亚',
  korea: '韩国',
  thailand: '泰国',
}

/** "china" -> "中国 China"; unknown regions keep the title-cased English; empty -> '其他'. */
export function regionTitle(destination: string): string {
  const dest = titleCase(destination)
  if (!dest) return '其他'
  const zh = REGION_ZH[destination.trim().toLowerCase()]
  return zh ? `${zh} ${dest}` : dest
}

/** "signature" -> "Signature"; empty or 'unknown' -> '未分档'. */
export function tierTitle(tier: string): string {
  const text = tier.trim().toLowerCase() === 'unknown' ? '' : titleCase(tier)
  return text || '未分档'
}

/** Series (destination) -> tier -> tours, in first-appearance order, with tour and departure counts. */
export function groupToursByRegion(
  tours: CatalogTourView[],
  departures: CatalogDepartureView[],
): TourRegionGroup[] {
  const perTour = new Map<string, number>()
  for (const d of departures) perTour.set(d.tourId, (perTour.get(d.tourId) ?? 0) + 1)
  const regions: TourRegionGroup[] = []
  const regionIndex = new Map<string, TourRegionGroup>()
  const tierIndex = new Map<string, TourTierGroup>()
  for (const tour of tours) {
    const dest = (tour.destination ?? '').trim().toLowerCase()
    const tier = (tour.tier ?? '').trim().toLowerCase()
    let region = regionIndex.get(dest)
    if (!region) {
      region = { key: dest, title: regionTitle(tour.destination), tiers: [], tourCount: 0, departureCount: 0 }
      regionIndex.set(dest, region)
      regions.push(region)
    }
    const tierKey = `${dest}|${tier}`
    let tierGroup = tierIndex.get(tierKey)
    if (!tierGroup) {
      tierGroup = {
        key: tierKey,
        title: tierTitle(tour.tier),
        nameTitle: groupTitle(tour.destination, tour.tier),
        tours: [],
        departureCount: 0,
      }
      tierIndex.set(tierKey, tierGroup)
      region.tiers.push(tierGroup)
    }
    const count = perTour.get(tour.id) ?? 0
    tierGroup.tours.push(tour)
    tierGroup.departureCount += count
    region.tourCount += 1
    region.departureCount += count
  }
  return regions
}

const SEPARATORS = ['—', '–', '-', ':', '：', '|']

/** Drop a leading "<group title>" + separator from the tour name. */
export function shortTourName(name: string, title: string): string {
  const trimmedTitle = title.trim()
  if (!trimmedTitle) return name
  const lowerName = name.toLowerCase()
  const lowerTitle = trimmedTitle.toLowerCase()
  if (!lowerName.startsWith(lowerTitle)) return name
  let rest = name.slice(trimmedTitle.length)
  rest = rest.replace(/^\s+/, '')
  const sep = SEPARATORS.find(s => rest.startsWith(s))
  if (!sep) return name
  rest = rest.slice(sep.length).replace(/^\s+/, '')
  if (!rest) return name
  return rest
}

/** Earliest departOn >= today among this tour's departures whose status is 'open' or 'limited'; null if none. */
export function nextDepartOn(
  departures: CatalogDepartureView[],
  tourId: string,
  today: string,
): string | null {
  let best: string | null = null
  for (const d of departures) {
    if (d.tourId !== tourId) continue
    if (d.status !== 'open' && d.status !== 'limited') continue
    if (d.departOn < today) continue
    if (best === null || d.departOn < best) best = d.departOn
  }
  return best
}

export interface TourFilterInput {
  query: string
  filter: TourFilter
  changedTourIds: string[]
  departures: CatalogDepartureView[]
  today: string
}

function searchText(tour: CatalogTourView): string {
  return `${tour.name} ${regionTitle(tour.destination)} ${tierTitle(tour.tier)}`.toLowerCase()
}

/** query: case-insensitive substring of tour name, series or tier (trimmed; empty = all). */
export function filterTours(tours: CatalogTourView[], input: TourFilterInput): CatalogTourView[] {
  const query = input.query.trim().toLowerCase()
  const changed = new Set(input.changedTourIds)
  return tours.filter(tour => {
    if (query && !searchText(tour).includes(query)) return false
    if (input.filter === 'changed') return changed.has(tour.id)
    if (input.filter === 'has_departures') {
      return nextDepartOn(input.departures, tour.id, input.today) !== null
    }
    if (input.filter === 'inactive') return tour.isActive === false
    return true
  })
}

/** One-line price for a narrow list row: drops a leading "From " and a trailing " per person". */
export function compactPrice(text: string): string {
  const short = text.replace(/^from\s+/i, '').replace(/\s+per\s+person$/i, '').trim()
  return short === '' ? text : short
}

/** null -> '（无）', otherwise the string itself. */
export function valueText(value: string | null): string {
  return value === null ? '（无）' : value
}

/** "字段名：旧值 → 新值". When change.departOn is set, prefix it and a space. */
export function changeLine(change: PublishChange): string {
  const prefix = change.departOn ? `${change.departOn} ` : ''
  return `${prefix}${change.fieldLabel}：${valueText(change.before)} → ${valueText(change.after)}`
}

/**
 * For the per-tour box: "展示价：对外现在 X → 草稿 Y" (same departOn prefix rule).
 * While no channel reads the catalog it says "已上架 X" instead: nothing is outward yet.
 */
export function draftChangeLine(change: PublishChange, channelsConnected: boolean): string {
  const prefix = change.departOn ? `${change.departOn} ` : ''
  const live = channelsConnected ? '对外现在' : '已上架'
  return `${prefix}${change.fieldLabel}：${live} ${valueText(change.before)} → 草稿 ${valueText(change.after)}`
}

/** High-risk changes first, otherwise keep the original order (stable). */
export function sortByRisk(changes: PublishChange[]): PublishChange[] {
  const high: PublishChange[] = []
  const normal: PublishChange[] = []
  for (const change of changes) {
    if (change.risk === 'high') high.push(change)
    else normal.push(change)
  }
  return [...high, ...normal]
}

/** Group changes by tourId, keeping tourName; groups that contain any high-risk change come first; inside a group high-risk first. */
export function groupChangesByTour(
  changes: PublishChange[],
): Array<{ tourId: string; tourName: string; changes: PublishChange[] }> {
  const order: string[] = []
  const map = new Map<string, { tourId: string; tourName: string; changes: PublishChange[] }>()
  for (const change of changes) {
    let group = map.get(change.tourId)
    if (!group) {
      group = { tourId: change.tourId, tourName: change.tourName, changes: [] }
      map.set(change.tourId, group)
      order.push(change.tourId)
    }
    group.changes.push(change)
  }
  const groups = order.map(id => {
    const group = map.get(id) as { tourId: string; tourName: string; changes: PublishChange[] }
    return { ...group, changes: sortByRisk(group.changes) }
  })
  const hasHigh = (g: { changes: PublishChange[] }) => g.changes.some(c => c.risk === 'high')
  const highGroups = groups.filter(hasHigh)
  const normalGroups = groups.filter(g => !hasHigh(g))
  return [...highGroups, ...normalGroups]
}
