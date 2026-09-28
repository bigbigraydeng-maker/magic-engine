/**
 * 广告级规则 · 核心结果口径（纯函数，无 I/O）。
 *
 * 一个广告单位只认一个「主结果」，跟着广告组的目的地走，不跟客户行业走。
 * 目的地是私信 → 开聊；目的地是表单 → 留资；其余（播放量、触达、主页互动、网站转化）→ 不判定。
 */

import type { OutcomeStep } from '../portfolio/outcome-ladder'

/** The one result an ad is judged on. Follows the ad set's destination, not the client's industry. */
export type CoreMetric = Extract<OutcomeStep, 'messaging_started' | 'lead'>

/** Meta optimization goals that aim at clicks or results (CTR is a meaningful lens for them). */
export const CLICK_DRIVEN_GOALS: ReadonlySet<string> = new Set([
  'LEAD_GENERATION',
  'QUALITY_LEAD',
  'CONVERSATIONS',
  'LINK_CLICKS',
  'LANDING_PAGE_VIEWS',
  'OFFSITE_CONVERSIONS',
])

export function isClickDrivenGoal(goal: string | null | undefined): boolean {
  if (typeof goal !== 'string') return false
  return CLICK_DRIVEN_GOALS.has(goal)
}

/** true for MESSENGER, WHATSAPP, INSTAGRAM_DIRECT, and any value starting with 'MESSAGING_'. null/undefined → false. */
export function isMessagingDestination(destinationType: string | null | undefined): boolean {
  if (typeof destinationType !== 'string') return false
  if (destinationType === 'MESSENGER' || destinationType === 'WHATSAPP' || destinationType === 'INSTAGRAM_DIRECT') return true
  return destinationType.startsWith('MESSAGING_')
}

export interface CoreMetricInput {
  destinationType: string | null
  optimizationGoal: string | null
  /** client's configured primary result (ad_strategy_configs); only consulted for the ambiguous combo below */
  clientPrimary: OutcomeStep | null
}

/** 私信目的地 + 表单目标：同一个人既算开聊又算留资，只能靠客户配置消歧。 */
function resolveAmbiguousMessagingLead(clientPrimary: OutcomeStep | null): CoreMetric {
  return clientPrimary === 'lead' || clientPrimary === 'messaging_started' ? clientPrimary : 'messaging_started'
}

/**
 * Rules, in this exact order:
 *  1. messaging destination AND optimizationGoal === 'CONVERSATIONS' → 'messaging_started'
 *  2. messaging destination AND optimizationGoal in (LEAD_GENERATION, QUALITY_LEAD)  (ambiguous: a lead form
 *     inside Messenger records both a conversation and a lead for the same person) →
 *     clientPrimary if clientPrimary is 'lead' or 'messaging_started', otherwise 'messaging_started'
 *  3. messaging destination with any other goal → 'messaging_started'
 *  4. destinationType in (ON_AD, LEAD_FORM_MESSENGER) → 'lead'
 *  5. optimizationGoal in (LEAD_GENERATION, QUALITY_LEAD) → 'lead'
 *  6. otherwise → null (video views, reach, page engagement, website conversions, unknown)
 */
export function resolveCoreMetric(input: CoreMetricInput): CoreMetric | null {
  const { destinationType, optimizationGoal, clientPrimary } = input
  if (isMessagingDestination(destinationType)) {
    if (optimizationGoal === 'CONVERSATIONS') return 'messaging_started'
    if (optimizationGoal === 'LEAD_GENERATION' || optimizationGoal === 'QUALITY_LEAD') {
      return resolveAmbiguousMessagingLead(clientPrimary)
    }
    return 'messaging_started'
  }
  if (destinationType === 'ON_AD' || destinationType === 'LEAD_FORM_MESSENGER') return 'lead'
  if (optimizationGoal === 'LEAD_GENERATION' || optimizationGoal === 'QUALITY_LEAD') return 'lead'
  return null
}

/** Short Chinese noun for titles: lead → '留资', messaging_started → '开聊'. */
export const CORE_METRIC_NOUN: Readonly<Record<CoreMetric, string>> = {
  lead: '留资',
  messaging_started: '开聊',
}
