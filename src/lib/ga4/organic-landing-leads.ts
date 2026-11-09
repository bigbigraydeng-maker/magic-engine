/**
 * Organic-search × first landing page × enquiry events, from GA4. Pure summarising;
 * the GA4 reads live in client.ts (fetchGa4OrganicLandingLeadsRaw).
 *
 * Shared logic only: which URL prefixes count as a "product page" or a "guide page" is a
 * per-client configuration (landing-class-config.ts), never a rule in here.
 *
 * Two honest limits are carried in `notes` on every report:
 *  - GA4's `landingPage` is the first page of the SESSION, not of the person's first-ever
 *    visit. Someone who read a guide last week and came back to book is counted under the
 *    page they landed on that day.
 *  - "browsed a product page before submitting" cannot be read from GA4 without the
 *    `viewed_tour_paths` event parameter registered as a custom dimension (see `missing`).
 */

export interface LandingEventRow {
  /** GA4 sessionDefaultChannelGroup, e.g. "Organic Search" */
  channel: string
  /** GA4 landingPage (path, query stripped by GA4) */
  landingPath: string
  /** GA4 eventName, or the literal "thank_you_page_view" for the page-view based count */
  event: string
  events: number
  users: number
}

export interface OrganicLandingLeadsRaw {
  periodStart: string
  periodEnd: string
  rows: LandingEventRow[]
  /** true when GA4 returned the maximum rows asked for, so some landing pages may be missing */
  truncated: boolean
}

export interface LandingClassConfig {
  /** landing path prefixes that count as a product (tour / campaign) page */
  productPrefixes: string[]
  /** substrings of a landing path that mark a guide / content page */
  guideContains: string[]
  /** GA4 event the client's site fires once per accepted enquiry (primary count) */
  enquiryEvent: string
  /** legacy signal: page paths containing this text are "thank-you" pages (comparison only) */
  thankYouPathContains: string
}

export type LandingClass = 'product' | 'guide' | 'other'

export const THANK_YOU_PAGE_EVENT = 'thank_you_page_view'
export const ORGANIC_CHANNEL = 'Organic Search'

export function classifyLanding(path: string, cfg: LandingClassConfig): LandingClass {
  const p = path.split('?')[0]
  if (cfg.productPrefixes.some(x => p.startsWith(x))) return 'product'
  if (cfg.guideContains.some(x => p.includes(x))) return 'guide'
  return 'other'
}

export interface LandingBucket {
  landingClass: LandingClass
  enquiryEvent: number
  thankYouPageView: number
  formSubmit: number
}

export interface OrganicLandingLeadsSummary {
  plain: string
  period: { start: string; end: string }
  channel: string
  buckets: LandingBucket[]
  topLandingPaths: Array<{ path: string; landingClass: string; enquiryEvent: number; thankYouPageView: number }>
  truncated: boolean
  missing: string[]
  notes: string[]
}

const clip = (p: string): string => p.split('?')[0].slice(0, 80)

export function summariseOrganicLandingLeads(
  raw: OrganicLandingLeadsRaw,
  cfg: LandingClassConfig,
): OrganicLandingLeadsSummary {
  const organic = raw.rows.filter(r => r.channel === ORGANIC_CHANNEL)
  const byClass = new Map<string, LandingBucket>()
  const byPath = new Map<string, { path: string; landingClass: string; enquiryEvent: number; thankYouPageView: number }>()
  for (const r of organic) {
    const landingClass = classifyLanding(r.landingPath, cfg)
    const b = byClass.get(landingClass) ?? { landingClass, enquiryEvent: 0, thankYouPageView: 0, formSubmit: 0 }
    const pth = byPath.get(r.landingPath) ?? { path: clip(r.landingPath), landingClass, enquiryEvent: 0, thankYouPageView: 0 }
    if (r.event === cfg.enquiryEvent) { b.enquiryEvent += r.events; pth.enquiryEvent += r.events }
    else if (r.event === THANK_YOU_PAGE_EVENT) { b.thankYouPageView += r.events; pth.thankYouPageView += r.events }
    else if (r.event === 'form_submit') b.formSubmit += r.events
    byClass.set(landingClass, b)
    byPath.set(r.landingPath, pth)
  }
  const buckets = [...byClass.values()]
  const total = (k: 'enquiryEvent' | 'thankYouPageView') => buckets.reduce((s, b) => s + b[k], 0)
  const missing: string[] = []
  missing.push('「提交前浏览过团页」要靠表单事件里的 viewed_tour_paths 参数，需先在 GA4 里把它注册成自定义维度；注册前，「攻略页引导的询盘数」算不出，只能看到攻略页落地的询盘总数。')
  if (raw.truncated) missing.push('GA4 返回行数触到上限，部分落地页没列出来，数字偏小。')
  if (total('enquiryEvent') === 0) missing.push(`统一事件 ${cfg.enquiryEvent} 在这个时间窗里 0 次：官网表单改动还没上线，或上线后还没人提交。此时只有旧口径（感谢页浏览）可参考。`)
  const plain = `自然搜索渠道 ${raw.periodStart}～${raw.periodEnd}：${cfg.enquiryEvent} 共 ${total('enquiryEvent')} 次（主口径）。旧口径与表单提交数只在分类明细里作对照，不要与主口径相加。`
  const topLandingPaths = [...byPath.values()]
    .sort((a, b) => (b.enquiryEvent + b.thankYouPageView) - (a.enquiryEvent + a.thankYouPageView))
    .slice(0, 15)
  return {
    plain, period: { start: raw.periodStart, end: raw.periodEnd }, channel: ORGANIC_CHANNEL,
    buckets, topLandingPaths, truncated: raw.truncated, missing,
    notes: [
      'GA4 的「落地页」是这一次访问的第一页，不是这个人第一次来站的第一页；隔天回来下单的人算在回来那天落地的页上。',
      '感谢页浏览与统一事件在改动上线后会同时存在，同一次询盘可能两边各记一次：不要把两列相加。',
      '数字基数很小，只能当辅助指标，不能当趋势。',
      '联系页提交后是页内显示成功、不跳感谢页，所以旧口径（感谢页浏览）会低估；以人工对账口径为准核对。',
    ],
  }
}
