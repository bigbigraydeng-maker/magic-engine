/**
 * Meta Graph 只读读取器：把官方账户的数据集、事件统计、匹配质量和账户状态读成事实。
 *
 * 🔴 只读：只发 GET，redirect 为 error，令牌只进 Authorization 头，绝不进 URL。
 * 🔴 每个子读取互相独立：一个失败只降级它自己，readMetaFacts 永不 reject。
 * 🔴 灰（没读到）永不等于 0：读不到时事件统计 / 质量保持 null。
 */

import { GRAPH_BASE } from '@/lib/meta/graph-base'
import type { MetaAccountFact, MetaDatasetFact, MetaFacts } from './types'
import { sanitizeError } from './sanitize'
import { retryOnce, type Sleep } from './retry'

/** 事件统计分页的硬上限：防止游标永不结束。 */
export const MAX_STATS_PAGES = 6

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const REQUEST_TIMEOUT_MS = 15_000
const MAX_DATASET_PAGES = 3
const MISSING_EVENT = '__missing_event'

const ACCOUNT_ID_RE = /^act_\d{6,20}$/
const PATH_ALLOWLIST_RE = /^(act_\d{6,20}(\/(adspixels|insights|campaigns))?|\d{6,20}\/stats|dataset_quality)$/

export interface MetaReadInput {
  adAccountId: string
  focusPixelIds: readonly string[]
  token: string
  fetcher: typeof fetch
  now: Date
  /** 单测里换成不真等的版本；不传就真等 */
  sleep?: Sleep
}

export interface MetaReadResult {
  facts: MetaFacts
  errors: string[]
}

// ─── 时间解析 ───────────────────────────────────────────────────────────────

/** 把 Meta 的无冒号时区偏移（+1300 / -0700）解析成 UTC ISO；纪元值 / 乱码 → null。 */
export function parseGraphTime(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')
  const ms = Date.parse(normalized)
  if (Number.isNaN(ms)) return null
  if (ms <= 0) return null
  return new Date(ms).toISOString()
}

// ─── 事件统计折叠 ───────────────────────────────────────────────────────────

interface ParsedBucket {
  start: number
  counts: { value: string; count: number }[]
}

function parseBucket(raw: unknown): ParsedBucket | null {
  if (typeof raw !== 'object' || raw === null) return null
  const record = raw as Record<string, unknown>
  const timeRaw = record.start_time ?? record.timestamp
  const iso = parseGraphTime(timeRaw)
  if (iso === null) return null
  const data = record.data
  if (!Array.isArray(data)) return null
  const counts: { value: string; count: number }[] = []
  for (const entry of data) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (typeof e.value !== 'string') continue
    if (typeof e.count !== 'number' || !Number.isFinite(e.count)) continue
    counts.push({ value: e.value, count: e.count })
  }
  return { start: Date.parse(iso), counts }
}

function addCounts(
  target: Record<string, number>,
  counts: { value: string; count: number }[],
): void {
  for (const { value, count } of counts) {
    if (value === MISSING_EVENT) continue
    target[value] = (target[value] ?? 0) + count
  }
}

/** 把统计桶按「与窗口重叠」折叠成 24 小时和 7 天的计数。 */
export function foldStatsBuckets(
  buckets: readonly unknown[],
  now: Date,
): { events_24h: Record<string, number>; events_7d: Record<string, number> } {
  const nowMs = now.getTime()
  const start24 = nowMs - DAY_MS
  const start7d = nowMs - 7 * DAY_MS
  const events_24h: Record<string, number> = {}
  const events_7d: Record<string, number> = {}

  for (const raw of buckets) {
    const bucket = parseBucket(raw)
    if (!bucket) continue
    const end = bucket.start + HOUR_MS
    if (bucket.start > nowMs) continue
    if (end > start7d) addCounts(events_7d, bucket.counts)
    if (end > start24) addCounts(events_24h, bucket.counts)
  }

  return { events_24h, events_7d }
}

// ─── 质量 / 账户解析 ────────────────────────────────────────────────────────

/** 把 dataset_quality 响应解析成事件名 → 分数；没有 web 数组 → null。 */
export function parseQualityBody(body: unknown): Record<string, number> | null {
  if (typeof body !== 'object' || body === null) return null
  const web = (body as Record<string, unknown>).web
  if (!Array.isArray(web)) return null
  const out: Record<string, number> = {}
  for (const entry of web) {
    if (typeof entry !== 'object' || entry === null) continue
    const e = entry as Record<string, unknown>
    if (typeof e.event_name !== 'string') continue
    const quality = e.event_match_quality
    if (typeof quality !== 'object' || quality === null) continue
    const score = (quality as Record<string, unknown>).composite_score
    if (typeof score !== 'number' || !Number.isFinite(score)) continue
    out[e.event_name] = score
  }
  return out
}

function toMinor(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** 把 Graph 广告账户对象解析成账户事实。 */
export function parseAccountBody(body: unknown): MetaAccountFact {
  const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  let hasFunding: boolean | null
  if (!('funding_source' in record)) {
    hasFunding = null
  } else {
    const fs = record.funding_source
    hasFunding = typeof fs === 'number' ? true : typeof fs === 'string' && fs.length > 0
  }
  return {
    status: toNumberOrNull(record.account_status),
    disable_reason: toNumberOrNull(record.disable_reason),
    has_funding_source: hasFunding,
    spend_cap_minor: toMinor(record.spend_cap),
    amount_spent_minor: toMinor(record.amount_spent),
    currency: typeof record.currency === 'string' ? record.currency : null,
  }
}

// ─── Graph 传输 ─────────────────────────────────────────────────────────────

type GraphParams = Record<string, string>

interface GraphErrorBody {
  message?: unknown
  code?: unknown
  is_transient?: unknown
}

function extractError(body: unknown): GraphErrorBody | null {
  if (typeof body !== 'object' || body === null) return null
  const err = (body as Record<string, unknown>).error
  if (typeof err !== 'object' || err === null) return null
  return err as GraphErrorBody
}

/** Meta 自己标的瞬时错误码：限流 / 服务暂时不可用 / 用户请求过多 / 未知错误。 */
const TRANSIENT_GRAPH_CODES: ReadonlySet<number> = new Set([1, 2, 4, 17, 32, 613])

/**
 * 这个响应值得再试一次吗？只认瞬时故障：429 / 5xx / Meta 自己标了 is_transient / 瞬时错误码。
 * 永久性错误（令牌失效 190、参数错 100、没权限 200 等）返回 false，不重试。
 */
function isTransientGraphResult(result: { status: number; body: unknown }): boolean {
  if (result.status === 429 || result.status >= 500) return true
  const err = extractError(result.body)
  if (err === null) return false
  if (err.is_transient === true) return true
  return typeof err.code === 'number' && TRANSIENT_GRAPH_CODES.has(err.code)
}

function buildUrl(path: string, params: GraphParams): string {
  const qs = new URLSearchParams(params).toString()
  return qs ? `${GRAPH_BASE}/${path}?${qs}` : `${GRAPH_BASE}/${path}`
}

async function doFetch(
  fetcher: typeof fetch,
  url: string,
  token: string,
): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetcher(url, {
      method: 'GET',
      redirect: 'error',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: controller.signal,
    })
    let body: unknown
    try {
      body = await res.json()
    } catch {
      throw new Error(`Meta ${res.status}：响应不是 JSON`)
    }
    return { status: res.status, body }
  } finally {
    clearTimeout(timer)
  }
}

export function makeGraphGet(fetcher: typeof fetch, token: string, sleep?: Sleep) {
  return async function graphGet(path: string, params: GraphParams): Promise<unknown> {
    // 🔴 这里抛出的任何错误（包括 Meta 把令牌原样回显在报错里的情况）都先用「已知令牌」精确抹一遍，
    //    下游再怎么 catch / 拼接 / 截断，都拿不到令牌。
    try {
      if (!PATH_ALLOWLIST_RE.test(path)) {
        throw new Error(`不允许的 Graph 路径：${path}`)
      }
      // 瞬时故障（网络错误 / 429 / 5xx / Meta 标的瞬时错误）多试一次；永久性错误原样抛出。
      const { status, body } = await retryOnce(
        () => doFetch(fetcher, buildUrl(path, params), token),
        { sleep, retryResult: isTransientGraphResult },
      )
      const err = extractError(body)
      if (!status || status < 200 || status >= 300 || err) {
        const message = typeof err?.message === 'string' ? err.message : '请求失败'
        const code = err?.code ?? '?'
        throw new Error(`Meta ${status}：${message}（code ${code}）`)
      }
      return body
    } catch (error) {
      throw new Error(sanitizeError(error, [token]))
    }
  }
}

export type GraphGet = ReturnType<typeof makeGraphGet>

/**
 * 下一页的翻页游标。Graph 的约定：有下一页才有 paging.next（最后一页即使带 cursors 也没有 next）。
 * 绝不去请求 paging.next 这个网址本身——它里头带着令牌；只拿 cursors.after 回到我们自己的网址上翻页。
 * 返回：游标 / null（没有下一页了）/ 'broken'（说有下一页，却没给游标）。
 */
function nextCursor(body: unknown): string | null | 'broken' {
  const paging = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).paging : undefined
  if (typeof paging !== 'object' || paging === null) return null
  const p = paging as Record<string, unknown>
  if (typeof p.next !== 'string') return null
  const cursors = p.cursors
  const after = typeof cursors === 'object' && cursors !== null ? (cursors as Record<string, unknown>).after : undefined
  return typeof after === 'string' && after !== '' ? after : 'broken'
}

// ─── 数据集列表 ─────────────────────────────────────────────────────────────

interface DatasetRow {
  id: string
  name: string | null
  last_fired_at: string | null
}

function parseDatasetRow(raw: unknown): DatasetRow | null {
  if (typeof raw !== 'object' || raw === null) return null
  const r = raw as Record<string, unknown>
  if (typeof r.id !== 'string') return null
  return {
    id: r.id,
    name: typeof r.name === 'string' ? r.name : null,
    last_fired_at: parseGraphTime(r.last_fired_time),
  }
}

async function readDatasetRows(graphGet: GraphGet, adAccountId: string): Promise<DatasetRow[]> {
  const rows: DatasetRow[] = []
  let after: string | null = null
  for (let page = 0; page < MAX_DATASET_PAGES; page++) {
    const params: GraphParams = {
      fields: 'id,name,last_fired_time,is_unavailable',
      limit: '50',
    }
    if (after) params.after = after
    const body = await graphGet(`${adAccountId}/adspixels`, params)
    const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
    const data = Array.isArray(record.data) ? record.data : []
    for (const raw of data) {
      const row = parseDatasetRow(raw)
      if (row) rows.push(row)
    }
    const cursor = nextCursor(body)
    if (cursor === null || cursor === 'broken') break
    after = cursor
  }
  return rows
}

// ─── 单个数据集的事件统计 / 质量 ─────────────────────────────────────────────

interface StatsResult {
  events_24h: Record<string, number> | null
  events_7d: Record<string, number> | null
  error: string | null
}

async function readStats(
  graphGet: GraphGet,
  datasetId: string,
  now: Date,
): Promise<StatsResult> {
  const startTime = String(Math.floor((now.getTime() - 7 * DAY_MS) / 1000))
  const endTime = String(Math.floor(now.getTime() / 1000))
  const buckets: unknown[] = []
  let after: string | null = null

  for (let page = 0; page < MAX_STATS_PAGES; page++) {
    const params: GraphParams = { aggregation: 'event', start_time: startTime, end_time: endTime }
    if (after) params.after = after
    let body: unknown
    try {
      body = await graphGet(`${datasetId}/stats`, params)
    } catch (err) {
      return { events_24h: null, events_7d: null, error: sanitizeError(err) }
    }
    const record = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
    if (Array.isArray(record.data)) buckets.push(...record.data)

    const cursor = nextCursor(body)
    if (cursor === null) {
      const folded = foldStatsBuckets(buckets, now)
      return { events_24h: folded.events_24h, events_7d: folded.events_7d, error: null }
    }
    if (cursor === 'broken') {
      return { events_24h: null, events_7d: null, error: `数据集 ${datasetId} 的事件统计有下一页却没给翻页游标，结果不完整（分页）` }
    }
    after = cursor
  }

  // 翻满上限还有下一页：只拿到了一部分，绝不当成完整结果报出去
  return {
    events_24h: null,
    events_7d: null,
    error: `数据集 ${datasetId} 的事件统计分页超过 ${MAX_STATS_PAGES} 页，结果不完整`,
  }
}

async function readQuality(
  graphGet: GraphGet,
  datasetId: string,
): Promise<{ match_quality: Record<string, number> | null; error: string | null }> {
  try {
    const body = await graphGet('dataset_quality', {
      dataset_id: datasetId,
      fields: 'web{event_name,event_match_quality{composite_score}}',
    })
    return { match_quality: parseQualityBody(body), error: null }
  } catch (err) {
    return { match_quality: null, error: sanitizeError(err) }
  }
}

// ─── 主流程 ─────────────────────────────────────────────────────────────────

function emptyFacts(now: Date): MetaFacts {
  return {
    read: false,
    as_of: now.toISOString(),
    account_dataset_ids: [],
    datasets: [],
    account: null,
  }
}

async function readAccount(
  graphGet: GraphGet,
  adAccountId: string,
  errors: string[],
): Promise<MetaAccountFact | null> {
  try {
    const body = await graphGet(adAccountId, {
      fields: 'account_status,disable_reason,funding_source,currency,spend_cap,amount_spent',
    })
    return parseAccountBody(body)
  } catch (err) {
    errors.push(sanitizeError(err))
    return null
  }
}

async function enrichDataset(
  graphGet: GraphGet,
  base: MetaDatasetFact,
  now: Date,
  errors: string[],
): Promise<MetaDatasetFact> {
  const stats = await readStats(graphGet, base.id, now)
  if (stats.error) errors.push(sanitizeError(stats.error))
  const quality = await readQuality(graphGet, base.id)
  if (quality.error) errors.push(sanitizeError(quality.error))
  return {
    ...base,
    events_24h: stats.events_24h,
    events_7d: stats.events_7d,
    match_quality: quality.match_quality,
  }
}

/** 读取官方账户的数据集、事件统计、匹配质量和账户状态。永不 reject。 */
export async function readMetaFacts(input: MetaReadInput): Promise<MetaReadResult> {
  const { adAccountId, focusPixelIds, token, fetcher, now } = input
  const errors: string[] = []

  if (!ACCOUNT_ID_RE.test(adAccountId)) {
    return { facts: emptyFacts(now), errors: ['广告账户编号格式不对'] }
  }

  const graphGet = makeGraphGet(fetcher, token, input.sleep)

  let rows: DatasetRow[] = []
  let read = true
  try {
    rows = await readDatasetRows(graphGet, adAccountId)
  } catch (err) {
    read = false
    errors.push(sanitizeError(err))
  }

  const account = await readAccount(graphGet, adAccountId, errors)

  const focusSet = new Set(focusPixelIds)
  const datasets: MetaDatasetFact[] = []
  for (const row of rows) {
    const base: MetaDatasetFact = {
      id: row.id,
      name: row.name,
      last_fired_at: row.last_fired_at,
      events_24h: null,
      events_7d: null,
      match_quality: null,
    }
    if (focusSet.has(row.id)) {
      datasets.push(await enrichDataset(graphGet, base, now, errors))
    } else {
      datasets.push(base)
    }
  }

  return {
    facts: {
      read,
      as_of: now.toISOString(),
      account_dataset_ids: rows.map((r) => r.id),
      datasets,
      account,
    },
    errors,
  }
}
