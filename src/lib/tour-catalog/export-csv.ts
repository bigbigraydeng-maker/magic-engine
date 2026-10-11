import type { CatalogDeparture, CatalogTour } from './types'
import { STATUS_LABELS } from './departures-csv'

const BOM = '\uFEFF'
const ROW_SEPARATOR = '\r\n'
const LIST_SEPARATOR = '；'
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r']

const HEADERS: readonly string[] = [
  '团名',
  '对外标题',
  '目的地',
  '档次',
  '网址标识',
  '天数',
  '展示价',
  '单房差',
  '单房差说明',
  '人数上限',
  '是否在售',
  '整团售罄',
  '出发班期数',
  '未来班期数',
  '下一个出发日',
  '全部班期',
  '简介',
  '亮点',
  '包含',
  '不含',
  '途经城市',
  '主图',
  '图集张数',
  '标签',
  'SEO标题',
  'SEO描述',
  '评分',
  '评价数',
  '行程天数',
  '最近更新',
]

/** Escape a cell for Excel: guard formula prefixes, then quote when needed. */
export function csvCell(value: string): string {
  const guarded = value !== '' && FORMULA_PREFIXES.includes(value[0]) ? `'${value}` : value
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`
  }
  return guarded
}

/** Render a nullable value as a cell string; null/undefined become empty. */
function text(value: string | null | undefined): string {
  return value === null || value === undefined ? '' : value
}

/** Render a nullable number as a cell string; null/undefined become empty. */
function num(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value)
}

/** Render a boolean as 是/否. */
function bool(value: boolean): string {
  return value ? '是' : '否'
}

/** Join a string array with the Chinese semicolon separator. */
function list(values: readonly string[]): string {
  return values.join(LIST_SEPARATOR)
}

/** Departures belonging to a tour, in the given order. */
function departuresFor(
  tour: CatalogTour,
  departures: readonly CatalogDeparture[],
): CatalogDeparture[] {
  return departures.filter((departure) => departure.tourId === tour.id)
}

/** The earliest upcoming, bookable departure date, or empty when there is none. */
function nextDeparture(own: readonly CatalogDeparture[], today: string): string {
  const upcoming = own
    .filter((d) => d.departOn >= today && d.status !== 'cancelled' && d.status !== 'closed')
    .map((d) => d.departOn)
    .sort()
  return upcoming.length > 0 ? upcoming[0] : ''
}

/** All departures as "date status-label" pairs, sorted by date ascending. */
function allDepartures(own: readonly CatalogDeparture[]): string {
  return own
    .slice()
    .sort((a, b) => (a.departOn < b.departOn ? -1 : a.departOn > b.departOn ? 1 : 0))
    .map((d) => `${d.departOn} ${STATUS_LABELS[d.status]}`)
    .join(LIST_SEPARATOR)
}

/** Build the ordered cell values for one tour row. */
function tourRow(
  tour: CatalogTour,
  departures: readonly CatalogDeparture[],
  today: string,
): string[] {
  const own = departuresFor(tour, departures)
  const upcoming = own.filter(
    (d) => d.departOn >= today && d.status !== 'cancelled' && d.status !== 'closed',
  )
  return [
    tour.name,
    text(tour.title),
    tour.destination,
    tour.tier,
    tour.slug,
    text(tour.durationText),
    text(tour.displayPriceText),
    text(tour.singleSupplement),
    text(tour.singleSupplementNote),
    num(tour.maxGroupSize),
    bool(tour.isActive),
    bool(tour.soldOut),
    String(own.length),
    String(upcoming.length),
    nextDeparture(own, today),
    allDepartures(own),
    text(tour.shortDescription),
    list(tour.highlights),
    list(tour.inclusions),
    list(tour.exclusions),
    list(tour.tourCities),
    text(tour.heroImage),
    String(tour.gallery.length),
    list(tour.tags),
    text(tour.metaTitle),
    text(tour.metaDescription),
    num(tour.rating),
    num(tour.reviewCount),
    String(tour.itinerary.length),
    tour.updatedAt.slice(0, 10),
  ]
}

/** Serialise tours and their departures into a BOM-prefixed Excel CSV string. */
export function toursToCsv(
  tours: readonly CatalogTour[],
  departures: readonly CatalogDeparture[],
  today: string,
): string {
  const lines: string[] = [HEADERS.map(csvCell).join(',')]
  for (const tour of tours) {
    lines.push(tourRow(tour, departures, today).map(csvCell).join(','))
  }
  return BOM + lines.join(ROW_SEPARATOR) + ROW_SEPARATOR
}
