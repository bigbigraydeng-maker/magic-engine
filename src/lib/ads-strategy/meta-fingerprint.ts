/**
 * Meta 侧设置指纹 —— 用来发现「有人在 Meta 后台偷偷改了设置」。
 *
 * 🔴 为什么要有这个模块：
 *   广告建好后，Meta 后台随时可能被改（预算、定向、文案、视频）。我们账本里
 *   存的是「建草案时的设置」，跟 Meta 上「现在的真实设置」可能已经不一致。
 *   开启前必须比对，否则会拿着过期的假设去操作。
 *
 * 🔴 为什么分组算 hash 而不是整块算：
 *   整块算的话，任何一处改动都会让整个 hash 变，diff 只能告诉你「变了」，
 *   说不出「哪一组变了」。分组（campaign / adSet / 每条 ad）能让 diff 精确
 *   定位到「是 campaign 的预算被改了」还是「某条广告的文案被改了」。
 *
 * 🔴 为什么只挑这些字段：
 *   Meta 会异步补一堆字段（status、effective_status、updated_time、
 *   expanded_implicit_custom_audiences、targeting_relaxation_types 等），
 *   这些不是「有人改了设置」，进了指纹会天天误报。只挑「一变就算实质改动」
 *   的字段。按钮（call_to_action）整体进指纹，是因为改按钮链接能把人引去别处。
 *
 * 🔴 为什么取值要容错：
 *   输入是从 Meta Graph 读回的原始对象，字段类型不可靠 —— 数字常以字符串
 *   出现（如 "500"），时间格式也不统一。所以每个取值都要归一化。
 */

import { canonicalHashOfInput } from '@/lib/kernel/canonical-hash'
import { extractBuyerFacingText } from '@/lib/meta/readback'

export interface MetaFingerprint {
  campaign: string
  adSet: string
  ads: Record<string, string>
}

export interface MetaFingerprintRaw {
  campaign: Record<string, unknown>
  adSet: Record<string, unknown>
  ads: ReadonlyArray<Record<string, unknown>>
}

/** 判断是不是普通对象（非 null、非数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 从对象里安全取一个字段；不是对象就返回 undefined。 */
function pick(source: unknown, key: string): unknown {
  return isRecord(source) ? source[key] : undefined
}

/** 金额类归一化：数字或数字字符串 → String(Number(x))；否则保持原字符串；缺失 → null。 */
function num(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? String(parsed) : value
  }
  return String(value)
}

/** 时间归一化：能 Date.parse 的统一成毫秒时间戳字符串；否则保持原字符串；缺失 → null。 */
function time(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? value : String(parsed)
  }
  return String(value)
}

/** 字符串数组归一化：缺失 → []；非字符串元素丢掉；排序。 */
function sortedStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item === 'string') out.push(item)
  }
  return out.sort()
}

/** 从数组里每项取字符串 key/id，丢掉不合格的，排序。 */
function keysOf(value: unknown, key: string): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const k = pick(item, key)
    if (typeof k === 'string') out.push(k)
  }
  return out.sort()
}

/** 原样透传（缺失 → null）。用于 frequency_control_specs、url_tags 等结构字段。 */
function orNull(value: unknown): unknown {
  return value === undefined ? null : value
}

/** 取对象的键并排序；不是对象就返回 []。 */
function keysOfRecord(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value).sort() : []
}

/** campaign 组：只取「一变就算实质改动」的字段。 */
function normalizeCampaign(campaign: Record<string, unknown>): Record<string, unknown> {
  return {
    objective: orNull(campaign.objective),
    spend_cap: num(campaign.spend_cap),
    bid_strategy: orNull(campaign.bid_strategy),
    daily_budget: num(campaign.daily_budget),
    lifetime_budget: num(campaign.lifetime_budget),
  }
}

/** 读 targeting 里进指纹的字段。 */
function readTargeting(targeting: unknown): Record<string, unknown> {
  const geo = pick(targeting, 'geo_locations')
  const automation = pick(targeting, 'targeting_automation')
  return {
    countries: sortedStrings(pick(geo, 'countries')),
    cities: keysOf(pick(geo, 'cities'), 'key'),
    regions: keysOf(pick(geo, 'regions'), 'key'),
    age_min: orNull(pick(targeting, 'age_min')),
    age_max: orNull(pick(targeting, 'age_max')),
    advantage_audience: orNull(pick(automation, 'advantage_audience')),
    custom_audiences: keysOf(pick(targeting, 'custom_audiences'), 'id'),
    publisher_platforms: sortedStrings(pick(targeting, 'publisher_platforms')),
    facebook_positions: sortedStrings(pick(targeting, 'facebook_positions')),
    instagram_positions: sortedStrings(pick(targeting, 'instagram_positions')),
    messenger_positions: sortedStrings(pick(targeting, 'messenger_positions')),
    audience_network_positions: sortedStrings(pick(targeting, 'audience_network_positions')),
  }
}

/** adSet 组：预算/出价/定向/排期等。 */
function normalizeAdSet(adSet: Record<string, unknown>): Record<string, unknown> {
  const promoted = pick(adSet, 'promoted_object')
  return {
    daily_budget: num(adSet.daily_budget),
    lifetime_budget: num(adSet.lifetime_budget),
    billing_event: orNull(adSet.billing_event),
    bid_amount: num(adSet.bid_amount),
    bid_strategy: orNull(adSet.bid_strategy),
    optimization_goal: orNull(adSet.optimization_goal),
    destination_type: orNull(adSet.destination_type),
    start_time: time(adSet.start_time),
    end_time: time(adSet.end_time),
    page_id: orNull(pick(promoted, 'page_id')),
    frequency_control_specs: orNull(adSet.frequency_control_specs),
    targeting: readTargeting(adSet.targeting),
  }
}

/** 读 creative.object_story_spec.video_data 里进指纹的字段。 */
function readVideoData(creative: unknown): Record<string, unknown> {
  const story = pick(creative, 'object_story_spec')
  const video = pick(story, 'video_data')
  return {
    video_id: orNull(pick(video, 'video_id')),
    image_hash: orNull(pick(video, 'image_hash')),
    image_url: orNull(pick(video, 'image_url')),
    call_to_action: orNull(pick(video, 'call_to_action')),
    page_welcome_message: orNull(pick(video, 'page_welcome_message')),
  }
}

/** 单条 ad 组：创意内容 + 买家可见文字 + 结构字段。 */
function normalizeAd(ad: Record<string, unknown>): Record<string, unknown> {
  const creative = ad.creative
  const story = pick(creative, 'object_story_spec')
  return {
    page_id: orNull(pick(story, 'page_id')),
    story_keys: keysOfRecord(story),
    video_data_keys: keysOfRecord(pick(story, 'video_data')),
    video_data: readVideoData(creative),
    buyer_facing_text: extractBuyerFacingText(creative),
    degrees_of_freedom_spec: orNull(pick(creative, 'degrees_of_freedom_spec')),
    creative_url_tags: orNull(pick(creative, 'url_tags')),
    creative_tracking_specs: orNull(pick(creative, 'tracking_specs')),
    ad_tracking_specs: orNull(pick(ad, 'tracking_specs')),
  }
}

/** 给 Meta 上的设置算指纹：分组各算一个 hash。 */
export function computeMetaFingerprint(raw: MetaFingerprintRaw): MetaFingerprint {
  const ads: Record<string, string> = {}
  for (const ad of raw.ads) {
    const id = ad.id
    if (typeof id !== 'string') {
      throw new Error('computeMetaFingerprint: ad 缺少字符串 id')
    }
    ads[id] = canonicalHashOfInput(normalizeAd(ad))
  }
  return {
    campaign: canonicalHashOfInput(normalizeCampaign(raw.campaign)),
    adSet: canonicalHashOfInput(normalizeAdSet(raw.adSet)),
    ads,
  }
}

/** 两份指纹哪些组不同；全相同返回 []。结果按字符串升序。 */
export function diffMetaFingerprint(a: MetaFingerprint, b: MetaFingerprint): string[] {
  const diffs: string[] = []
  if (a.campaign !== b.campaign) diffs.push('campaign')
  if (a.adSet !== b.adSet) diffs.push('adSet')
  const ids = new Set<string>([...Object.keys(a.ads), ...Object.keys(b.ads)])
  for (const id of ids) {
    if (a.ads[id] !== b.ads[id]) diffs.push(`ad:${id}`)
  }
  return diffs.sort()
}
