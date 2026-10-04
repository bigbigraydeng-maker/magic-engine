/**
 * 从 Meta 现场读回一套「暂停广告草案」的整体状态。
 *
 * 🔴 为什么放在 ads-strategy/ 而不是 capabilities/：
 *   「建草案时记下 Meta 指纹」和「开启前重新读现场算指纹」必须用**同一份读取
 *   代码、同一批字段**。两边字段一旦不一致，指纹就会天天误报。所以它放在中立
 *   位置，建草案侧和开启侧都 import 它。
 *
 * 🔴 为什么 fail-closed：
 *   这个读取层的产物会被拿去算指纹、做开启前预检。任何一处「读不出来」或
 *   「读不全」如果被当成空值/默认值往下走，就会变成「拿不完整的事实去开广告」。
 *   所以任何一步失败一律返回 { ok:false }，绝不返回半成品。
 *
 * 🔴 为什么错误信息里绝不能出现 URL：
 *   access_token 是放在查询串里的，URL 一旦进了错误信息就可能被日志/上报带出去。
 *   错误信息只写「哪一步 + HTTP 状态码 + Meta 的 error.message」。
 *
 * 纯 IO 层：只负责取数、收窄、组装，不做业务判断。
 */

import type { MetaFingerprintRaw } from './meta-fingerprint'
import type {
  RawMetaAdCreative,
  RawMetaAdSet,
  RawMetaTargeting,
} from './meta-readback-adapter'
import { extractBuyerFacingText } from '@/lib/meta/readback'

const GRAPH_BASE = 'https://graph.facebook.com/v21.0'

/** 单次请求超时（毫秒）。 */
const REQUEST_TIMEOUT_MS = 15_000

/** 列表翻页上限。到顶还有 next 视为「读不全」。 */
const MAX_PAGES = 25

/** Meta 的 error.message 截断长度。 */
const ERROR_MESSAGE_MAX = 200

/** Meta 上某一层对象的现场状态。 */
export interface LiveObject {
  id: string
  accountId: string | null // Meta 返回的 account_id（可能带 act_）；读不到是 null
  status: string | null // 配置状态 ACTIVE/PAUSED/…；读不到是 null
}

/** 开启前从 Meta 现场读回的整套草案状态。 */
export interface LiveDraftState {
  campaign: LiveObject
  adSet: LiveObject & { endTimeMs: number | null; dailyBudgetCents: number | null }
  ads: LiveObject[]
  siblingAdSetIds: string[] // 该系列下**全部**广告组 id
  siblingAdIds: string[] // 该广告组下**全部**广告 id
  fingerprintRaw: MetaFingerprintRaw // 供 computeMetaFingerprint
  adSetReadback: RawMetaAdSet // 供 checkLaunch
  adsReadback: RawMetaAdCreative[] // 供 checkLaunch 与红线重扫（texts 为买家可见文字）
}

/** 要读的 id 集合。 */
export interface LiveStateIds {
  campaignId: string
  adSetId: string
  adIds: readonly string[]
}

/** 统一的「成功或失败」返回。失败带一句给人看的中文原因。 */
export type LiveStateResult =
  | { ok: true; value: LiveDraftState }
  | { ok: false; error: string }

/** 普通对象（非 null、非数组）。 */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 字符串或 null（缺失/非字符串 → null）。 */
function strOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

/** 截断 Meta 的 error.message，避免超长。 */
function truncate(v: unknown): string {
  const s = typeof v === 'string' ? v : ''
  return s.length > ERROR_MESSAGE_MAX ? s.slice(0, ERROR_MESSAGE_MAX) : s
}

/** 从返回体里摘出 Meta 的 error.message（没有就空串）。 */
function metaErrorMessage(body: unknown): string {
  if (!isRecord(body)) return ''
  const err = body.error
  if (!isRecord(err)) return ''
  return truncate(err.message)
}

/**
 * 发一次 GET 并解析 JSON。
 * 失败信息只含 step + HTTP 状态码 + Meta error.message，**绝不含 URL**。
 */
async function getJson(
  step: string,
  path: string,
  accessToken: string,
  fetchFn: typeof fetch,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  let url: string
  if (path.startsWith('https://')) {
    // 翻页地址是 Meta 返回的完整网址（已含 access_token）。只允许跟随官方域名，
    // 否则会把令牌发给别的域名。错误信息里绝不出现这个网址。
    let parsed: URL
    try {
      parsed = new URL(path)
    } catch {
      return { ok: false, error: `${step}：翻页地址不合法` }
    }
    if (parsed.hostname !== 'graph.facebook.com') {
      return { ok: false, error: `${step}：翻页地址不是 Meta 官方地址，已拒绝跟随` }
    }
    if (!parsed.searchParams.has('access_token')) {
      parsed.searchParams.set('access_token', accessToken)
    }
    url = parsed.toString()
  } else {
    url = `${GRAPH_BASE}${path}${path.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(accessToken)}`
  }
  let res: Response
  try {
    res = await fetchFn(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  } catch {
    return { ok: false, error: `${step}：网络异常或超时` }
  }
  let body: unknown
  try {
    body = await res.json()
  } catch {
    return { ok: false, error: `${step}：返回体不是 JSON（HTTP ${res.status}）` }
  }
  if (!res.ok) {
    const msg = metaErrorMessage(body)
    return { ok: false, error: `${step}：HTTP ${res.status}${msg ? ` ${msg}` : ''}` }
  }
  if (!isRecord(body)) {
    return { ok: false, error: `${step}：返回体不是 JSON 对象` }
  }
  if (body.error !== undefined) {
    const msg = metaErrorMessage(body)
    return { ok: false, error: `${step}：Meta 报错${msg ? ` ${msg}` : ''}` }
  }
  return { ok: true, body }
}

/** 读单个对象，并校验返回的 id 与请求一致。 */
async function readObject(
  step: string,
  path: string,
  expectedId: string,
  accessToken: string,
  fetchFn: typeof fetch,
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  const got = await getJson(step, path, accessToken, fetchFn)
  if (!got.ok) return got
  if (got.body.id !== expectedId) {
    return { ok: false, error: `${step}：返回的 id 与请求不一致` }
  }
  return { ok: true, body: got.body }
}

/** 读一个列表，沿 paging.next 翻页；超页数上限或 data 非数组 → 失败。 */
async function readList(
  step: string,
  path: string,
  accessToken: string,
  fetchFn: typeof fetch,
): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false; error: string }> {
  const rows: Record<string, unknown>[] = []
  let next: string | null = path
  let pages = 0
  while (next !== null) {
    if (pages >= MAX_PAGES) {
      return { ok: false, error: `${step}：翻页超过 ${MAX_PAGES} 页，读不全` }
    }
    pages += 1
    const got = await getJson(step, next, accessToken, fetchFn)
    if (!got.ok) return got
    const data = got.body.data
    if (!Array.isArray(data)) {
      return { ok: false, error: `${step}：返回体里 data 不是数组` }
    }
    for (const row of data) {
      if (isRecord(row)) rows.push(row)
    }
    const paging = got.body.paging
    const rawNext = isRecord(paging) ? paging.next : undefined
    next = typeof rawNext === 'string' && rawNext.length > 0 ? rawNext : null
  }
  return { ok: true, rows }
}

/** 逐个挑已知键、收窄后复制成 RawMetaTargeting；不是对象 → undefined。 */
function toRawTargeting(v: unknown): RawMetaTargeting | undefined {
  if (!isRecord(v)) return undefined
  const out: RawMetaTargeting = {}
  if (isRecord(v.geo_locations)) {
    const g = v.geo_locations
    const geo: NonNullable<RawMetaTargeting['geo_locations']> = {}
    if (Array.isArray(g.regions)) {
      geo.regions = g.regions.filter(isRecord).map((r) => ({ name: r.name }))
    }
    if (Array.isArray(g.cities)) {
      geo.cities = g.cities.filter(isRecord).map((c) => ({ name: c.name }))
    }
    if (Array.isArray(g.countries)) geo.countries = g.countries
    out.geo_locations = geo
  }
  if (Array.isArray(v.custom_audiences)) {
    out.custom_audiences = v.custom_audiences
      .filter(isRecord)
      .map((a) => ({ id: a.id, name: a.name }))
  }
  if (Array.isArray(v.expanded_implicit_custom_audiences)) {
    out.expanded_implicit_custom_audiences = v.expanded_implicit_custom_audiences
      .filter(isRecord)
      .map((a) => ({ id: a.id }))
  }
  if (isRecord(v.targeting_relaxation_types)) {
    out.targeting_relaxation_types = v.targeting_relaxation_types
  }
  if (isRecord(v.targeting_automation)) {
    out.targeting_automation = v.targeting_automation
  }
  return out
}

/** 原始行 → LiveObject。 */
function toLiveObject(row: Record<string, unknown>): LiveObject {
  return {
    id: typeof row.id === 'string' ? row.id : '',
    accountId: strOrNull(row.account_id),
    status: strOrNull(row.status),
  }
}

/** end_time → 毫秒时间戳；不是字符串或解析失败 → null。 */
function endTimeMs(v: unknown): number | null {
  if (typeof v !== 'string') return null
  const parsed = Date.parse(v)
  return Number.isNaN(parsed) ? null : parsed
}

/** daily_budget（数字字符串）→ 有限整数；否则 null。 */
function dailyBudgetCents(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null
  const n = Number(v)
  return Number.isFinite(n) && Number.isInteger(n) ? n : null
}

/** 从列表行里挑出字符串 id。 */
function idsOf(rows: readonly Record<string, unknown>[]): string[] {
  const out: string[] = []
  for (const row of rows) {
    if (typeof row.id === 'string') out.push(row.id)
  }
  return out
}

/** 组装 adSetReadback（RawMetaAdSet）。 */
function toAdSetReadback(row: Record<string, unknown>): RawMetaAdSet {
  return {
    id: typeof row.id === 'string' ? row.id : '',
    name: row.name,
    optimization_goal: row.optimization_goal,
    destination_type: row.destination_type,
    status: row.status,
    targeting: toRawTargeting(row.targeting),
  }
}

/** 组装 adsReadback（RawMetaAdCreative[]）。 */
function toAdsReadback(rows: readonly Record<string, unknown>[]): RawMetaAdCreative[] {
  return rows.map((row) => ({
    adId: typeof row.id === 'string' ? row.id : '',
    adName: row.name,
    status: row.status,
    texts: extractBuyerFacingText(row.creative),
  }))
}

/** 把四份原始返回组装成 LiveDraftState。 */
function assemble(
  ids: LiveStateIds,
  campaign: Record<string, unknown>,
  adSet: Record<string, unknown>,
  adSetRows: readonly Record<string, unknown>[],
  adRows: readonly Record<string, unknown>[],
): LiveDraftState {
  const wanted = new Set(ids.adIds)
  const ourAdRows = adRows.filter((row) => typeof row.id === 'string' && wanted.has(row.id))
  const base = toLiveObject(adSet)
  return {
    campaign: toLiveObject(campaign),
    adSet: {
      ...base,
      endTimeMs: endTimeMs(adSet.end_time),
      dailyBudgetCents: dailyBudgetCents(adSet.daily_budget),
    },
    ads: ourAdRows.map(toLiveObject),
    siblingAdSetIds: idsOf(adSetRows),
    siblingAdIds: idsOf(adRows),
    fingerprintRaw: { campaign, adSet, ads: ourAdRows },
    adSetReadback: toAdSetReadback(adSet),
    adsReadback: toAdsReadback(ourAdRows),
  }
}

/**
 * 从 Meta 现场读回一套草案状态。
 * 四个请求并行；任何一步失败 → { ok:false }，绝不返回半成品。
 */
export async function fetchLiveDraftState(
  accessToken: string,
  ids: LiveStateIds,
  fetchFn: typeof fetch = fetch,
): Promise<LiveStateResult> {
  const campaignPath =
    `/${ids.campaignId}?fields=id,account_id,status,objective,spend_cap,bid_strategy,daily_budget,lifetime_budget`
  const adSetPath =
    `/${ids.adSetId}?fields=id,name,account_id,status,campaign_id,optimization_goal,destination_type,billing_event,bid_amount,bid_strategy,daily_budget,lifetime_budget,start_time,end_time,promoted_object,frequency_control_specs,targeting`
  const adSetListPath = `/${ids.campaignId}/adsets?fields=id&limit=100`
  const adListPath =
    `/${ids.adSetId}/ads?fields=id,name,account_id,status,tracking_specs,creative{id,object_story_spec,asset_feed_spec,body,title,degrees_of_freedom_spec,url_tags,tracking_specs,effective_object_story_id}&limit=50`

  const [campaign, adSet, adSetList, adList] = await Promise.all([
    readObject('系列', campaignPath, ids.campaignId, accessToken, fetchFn),
    readObject('广告组', adSetPath, ids.adSetId, accessToken, fetchFn),
    readList('系列下广告组列表', adSetListPath, accessToken, fetchFn),
    readList('广告列表', adListPath, accessToken, fetchFn),
  ])

  if (!campaign.ok) return campaign
  if (!adSet.ok) return adSet
  if (!adSetList.ok) return adSetList
  if (!adList.ok) return adList

  return {
    ok: true,
    value: assemble(ids, campaign.body, adSet.body, adSetList.rows, adList.rows),
  }
}
