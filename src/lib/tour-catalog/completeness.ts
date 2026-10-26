/**
 * Tour catalog — "is this tour filled in enough to publish" checklist.
 * Mirrors docs/sops/2026-10-26-tour-catalog-new-tour-complete-before-publish.md; only what a machine can read
 * from the draft is checked here, the rest is listed as manual confirmations.
 * Pure and type-light on purpose: works on both the server tour type and the admin page's tour view.
 */

export interface CompletenessTour {
  managesDepartures: boolean
  durationText?: string | null
  displayPriceText?: string | null
  singleSupplement?: string | null
  highlights?: string[]
  itinerary?: Array<{ day: number; description: string; accommodation?: string }>
  inclusions?: string[]
  exclusions?: string[]
  tourCities?: string[]
  heroImage?: string | null
  gallery?: string[]
  metaTitle?: string | null
  metaDescription?: string | null
  faqs?: unknown[]
  quickAnswer?: string | null
}

export interface CompletenessItem {
  key: string
  label: string
  ok: boolean
  /** What is missing, in plain Chinese; empty when ok. */
  detail: string
}

export const META_TITLE_MAX = 60
export const META_DESCRIPTION_MAX = 160
export const MIN_GALLERY = 3
export const MIN_FAQS = 3
export const MIN_HIGHLIGHTS = 3

/** Things only a person can confirm before publishing (SOP checklist + SEO check). */
export const MANUAL_CONFIRMATIONS: readonly string[] = [
  '每晚酒店是客户给的名字，不是编的',
  '图片和景点对得上，酒店/车辆/客户真实产品的图是客户自己提供的',
  '官网详情页上的地图能出来',
  '主关键词有 DataForSEO 真数据，没有和官网同城市、同线路的页抢词',
  '常见问题的答案在行程或客户资料里有出处',
]

function filled(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== ''
}

function count(list: readonly unknown[] | undefined): number {
  return Array.isArray(list) ? list.length : 0
}

function item(key: string, label: string, ok: boolean, detail: string): CompletenessItem {
  return { key, label, ok, detail: ok ? '' : detail }
}

function itineraryItems(tour: CompletenessTour): CompletenessItem[] {
  const days = tour.itinerary ?? []
  const emptyDays = days.filter(d => !filled(d.description)).map(d => d.day)
  const stayDays = days.slice(1, -1).filter(d => !filled(d.accommodation)).map(d => d.day)
  const promised = Number(tour.durationText?.match(/\d+/)?.[0])
  const mismatch = Number.isFinite(promised) && promised > 0 && days.length > 0 && promised !== days.length
  return [
    item('itinerary', '每天行程', days.length > 0 && emptyDays.length === 0, days.length === 0 ? '还没有行程' : `第 ${emptyDays.join('、')} 天没有内容`),
    item('duration', '天数和行程一致', !mismatch, `「天数」写 ${promised} 天，行程有 ${days.length} 天`),
    item('stay', '每晚酒店', days.length > 0 && stayDays.length === 0, days.length === 0 ? '还没有行程' : `第 ${stayDays.join('、')} 天没填酒店`),
  ]
}

function contentItems(tour: CompletenessTour): CompletenessItem[] {
  const title = tour.metaTitle?.trim() ?? ''
  const description = tour.metaDescription?.trim() ?? ''
  return [
    item('hero', '主图', filled(tour.heroImage), '没有主图'),
    item('gallery', `相册（至少 ${MIN_GALLERY} 张）`, count(tour.gallery) >= MIN_GALLERY, `现在 ${count(tour.gallery)} 张`),
    item(
      'metaTitle',
      `网页标题（${META_TITLE_MAX} 字符内）`,
      title !== '' && title.length <= META_TITLE_MAX,
      title === '' ? '没填' : `${title.length} 个字符，超了会被谷歌截断`,
    ),
    item(
      'metaDescription',
      `搜索描述（${META_DESCRIPTION_MAX} 字符内）`,
      description !== '' && description.length <= META_DESCRIPTION_MAX,
      description === '' ? '没填' : `${description.length} 个字符，太长`,
    ),
    item('faqs', `常见问题（至少 ${MIN_FAQS} 条）`, count(tour.faqs) >= MIN_FAQS, `现在 ${count(tour.faqs)} 条`),
    item('quickAnswer', '一句话快答', filled(tour.quickAnswer), '没填'),
  ]
}

function basicsItems(tour: CompletenessTour, departureCount: number): CompletenessItem[] {
  return [
    item('departures', '出发日', !tour.managesDepartures || departureCount > 0, '还没有出发日'),
    item(
      'price',
      '展示价',
      filled(tour.displayPriceText) && !/tbc/i.test(tour.displayPriceText ?? ''),
      filled(tour.displayPriceText) ? '价格还是 TBC' : '没填',
    ),
    item('singleSupplement', '单房差', filled(tour.singleSupplement), '没填'),
    item('highlights', `亮点（至少 ${MIN_HIGHLIGHTS} 条）`, count(tour.highlights) >= MIN_HIGHLIGHTS, `现在 ${count(tour.highlights)} 条`),
    item('inclusions', '包含项', count(tour.inclusions) > 0, '没填'),
    item('exclusions', '不含项', count(tour.exclusions) > 0, '没填'),
    item('cities', '途经城市', count(tour.tourCities) > 0, '没填（官网地图可能靠它）'),
  ]
}

export function checkTourCompleteness(tour: CompletenessTour, departureCount: number): CompletenessItem[] {
  return [...basicsItems(tour, departureCount), ...itineraryItems(tour), ...contentItems(tour)]
}

export function missingItems(items: readonly CompletenessItem[]): CompletenessItem[] {
  return items.filter(i => !i.ok)
}
