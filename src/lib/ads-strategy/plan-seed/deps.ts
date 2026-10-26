import { supabaseAdmin } from '@/lib/supabase'
import { loadOwnedAccounts } from '@/lib/marketing-plan/promo/facts'
import { resolvePromoPlaybook } from '@/lib/marketing-plan/promo/playbooks'
import { loadAdsDraftFacts } from '@/lib/ads-strategy/promo-draft-facts'
import { fetchPageLeadForms } from '@/lib/meta/lead-forms'
import { GRAPH_BASE } from '@/lib/meta/graph-base'
import { getPageAccessToken } from '@/lib/meta/page-posts'
import { getStoredPageToken, resolveMetaTokenForClient } from '@/lib/meta/token-manager'
import { readHeartbeatAccount, type HeartbeatFetchers } from '@/lib/ads-strategy/heartbeat/read'
import type { PlanSeedDeps } from './build'
import type { ReadState } from './eligibility'
import { LIVE_READ_TIMEOUT_MS } from './constants'
import { liveDeliveringFromRead, type LiveDelivering } from './live-delivering'

/** 一次 Graph GET 的结果：成功带 JSON，失败带中文原因（不含 URL / token）。 */
type GraphResult = { ok: true; json: unknown } | { ok: false; reason: string }

/** 抓取时间读取的层级（两个层级都要新鲜才算新鲜）。 */
const CAPTURE_LEVELS = ['campaign', 'adset'] as const

/** 单次 Graph 请求超时（毫秒）。 */
const GRAPH_TIMEOUT_MS = 6000

/** 从 Graph 错误响应体里取出 error.code（不是数字则返回 null）。 */
function extractErrorCode(body: unknown): number | null {
  if (typeof body !== 'object' || body === null) return null
  const error = (body as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'number' ? code : null
}

/** 把 Graph 错误状态码 / 错误码归类成中文原因（绝不包含响应体 / URL / token）。 */
function classifyGraphError(status: number, body: unknown): string {
  const code = extractErrorCode(body)
  if (status === 429 || code === 4 || code === 17 || code === 32 || code === 613) {
    return 'Meta 限流，稍后再试'
  }
  if (code === 190) return '令牌失效，需要重新连接'
  if (code === 10 || code === 200) return '缺少权限'
  return 'Meta 接口返回错误'
}

/** 清洗原因字符串，抹掉可能泄露的 token / 长串。 */
function sanitizeReason(reason: string): string {
  return reason
    .replace(/access_token=[^&\s]+/gi, 'access_token=***')
    .replace(/Bearer\s+[A-Za-z0-9._~+\/=-]+/gi, 'Bearer ***')
    .replace(/[A-Za-z0-9_-]{20,}/g, '***')
}

/** 只读 GET 一个 Graph URL；失败时返回中文原因，绝不泄露 URL / token。 */
export async function graphGetJson(url: string, token: string): Promise<GraphResult> {
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    })
    if (!res.ok) {
      const body: unknown = await res.json().catch(() => null)
      return { ok: false, reason: sanitizeReason(classifyGraphError(res.status, body)) }
    }
    const json: unknown = await res.json()
    return { ok: true, json }
  } catch (err) {
    const isTimeout =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return { ok: false, reason: sanitizeReason(isTimeout ? '读取超时' : '网络错误') }
  }
}

/** 从 Graph 响应里取出 data 数组（不是数组则返回空数组）。 */
function extractData(json: unknown): unknown[] {
  if (typeof json !== 'object' || json === null) return []
  const data = (json as { data?: unknown }).data
  return Array.isArray(data) ? data : []
}

/** 解析 /me/permissions 响应，只保留 status === 'granted' 的权限名。 */
function parseScopes(json: unknown): string[] {
  const out: string[] = []
  for (const item of extractData(json)) {
    if (typeof item !== 'object' || item === null) continue
    const rec = item as { permission?: unknown; status?: unknown }
    if (rec.status !== 'granted') continue
    if (typeof rec.permission === 'string' && rec.permission !== '') out.push(rec.permission)
  }
  return out
}

/** 判断响应里是否有 paging.next（非空字符串）。 */
function hasNextPage(json: unknown): boolean {
  if (typeof json !== 'object' || json === null) return false
  const paging = (json as { paging?: unknown }).paging
  if (typeof paging !== 'object' || paging === null) return false
  const next = (paging as { next?: unknown }).next
  return typeof next === 'string' && next !== ''
}

/** 解析 promote_pages 响应，取出 data[].id。 */
function parseIds(json: unknown): string[] {
  const out: string[] = []
  for (const item of extractData(json)) {
    if (typeof item !== 'object' || item === null) continue
    const id = (item as { id?: unknown }).id
    if (typeof id === 'string' && id !== '') out.push(id)
  }
  return out
}

/** 读客户行业；出错或没有记录都返回 null。 */
async function queryIndustry(clientId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('industry')
      .eq('id', clientId)
      .maybeSingle()
    if (error !== null || data === null) return null
    const industry = (data as { industry?: unknown }).industry
    return typeof industry === 'string' && industry.trim() !== '' ? industry : null
  } catch {
    return null
  }
}

/** 读客户主页 ID；出错或没有记录都返回 null。 */
async function queryPageId(clientId: string): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('clients')
      .select('facebook_page_id')
      .eq('id', clientId)
      .maybeSingle()
    if (error !== null || data === null) return null
    const pageId = (data as { facebook_page_id?: unknown }).facebook_page_id
    if (typeof pageId !== 'string') return null
    const trimmed = pageId.trim()
    return trimmed !== '' ? trimmed : null
  } catch {
    return null
  }
}

/** 读某一层级最新一次完整抓取的 captured_at；出错或没有行返回 null。 */
async function queryCaptureAt(
  clientId: string,
  adAccountId: string,
  level: string,
): Promise<string | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('ad_snapshot_captures')
      .select('captured_at')
      .eq('client_id', clientId)
      .eq('ad_account_id', adAccountId)
      .eq('level', level)
      .eq('complete', true)
      .eq('skipped_shared', false)
      .order('captured_at', { ascending: false })
      .limit(1)
    if (error !== null || data === null || data.length === 0) return null
    const capturedAt = (data[0] as { captured_at?: unknown }).captured_at
    return typeof capturedAt === 'string' && capturedAt !== '' ? capturedAt : null
  } catch {
    return null
  }
}

/** 两个时间取较早的那个（按 Date.parse 比较）；任一解析失败返回 null。 */
function olderOf(a: string, b: string): string | null {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null
  return ta <= tb ? a : b
}

/** 读抓取时间：campaign 与 adset 都要有，取较早的那个。 */
async function loadCaptureAt(clientId: string, adAccountId: string): Promise<string | null> {
  const [campaignAt, adsetAt] = await Promise.all(
    CAPTURE_LEVELS.map((level) => queryCaptureAt(clientId, adAccountId, level)),
  )
  if (campaignAt === null || adsetAt === null) return null
  return olderOf(campaignAt, adsetAt)
}

/** 读主页访问令牌：先读已存的，再退回用户令牌换主页令牌。 */
async function loadPageToken(clientId: string, pageId: string): Promise<string | null> {
  const stored = await getStoredPageToken(clientId, pageId)
  if (stored !== null && stored !== '') return stored
  const resolved = await resolveMetaTokenForClient(clientId)
  if (resolved === null) return null
  return getPageAccessToken(resolved.token, pageId)
}

/** 读即时表单列表，把结果映射成 ReadState。 */
async function loadForms(
  pageId: string,
  pageToken: string,
): Promise<ReadState<{ id: string; active: boolean }[]>> {
  const res = await fetchPageLeadForms(pageId, pageToken)
  if (res.error !== null && res.rows.length === 0) {
    return { state: 'failed', reason: res.error }
  }
  if (res.error !== null) {
    return { state: 'failed', reason: `只读到一部分表单：${res.error}` }
  }
  if (res.rows.length === 0) return { state: 'empty' }
  return {
    state: 'ok',
    value: res.rows.map((r) => ({
      id: r.formId,
      active: (r.status ?? '').toUpperCase() === 'ACTIVE',
    })),
  }
}

/** 读令牌权限（/me/permissions，只读 GET）。 */
export async function loadScopes(
  clientId: string,
): Promise<{ source: string; scopes: ReadState<string[]> } | null> {
  const resolved = await resolveMetaTokenForClient(clientId)
  if (resolved === null) return null
  const url = `${GRAPH_BASE}/me/permissions`
  const res = await graphGetJson(url, resolved.token)
  if (!res.ok) {
    return { source: resolved.source, scopes: { state: 'failed', reason: res.reason } }
  }
  const scopes = parseScopes(res.json)
  if (scopes.length === 0) return { source: resolved.source, scopes: { state: 'empty' } }
  return { source: resolved.source, scopes: { state: 'ok', value: scopes } }
}

/** 读可推广主页（/act_xxx/promote_pages，只读 GET）。 */
export async function loadPromotePages(
  clientId: string,
  adAccountId: string,
): Promise<ReadState<string[]>> {
  const resolved = await resolveMetaTokenForClient(clientId)
  if (resolved === null) return { state: 'failed', reason: '没有可用令牌' }
  const url = `${GRAPH_BASE}/${adAccountId}/promote_pages?fields=id&limit=100`
  const res = await graphGetJson(url, resolved.token)
  if (!res.ok) return { state: 'failed', reason: res.reason }
  if (hasNextPage(res.json)) {
    return { state: 'failed', reason: '可推广主页超过 100 个，只读了前 100 个' }
  }
  const ids = parseIds(res.json)
  if (ids.length === 0) return { state: 'empty' }
  return { state: 'ok', value: ids }
}

export interface LiveReadOverrides {
  timeoutMs?: number
  resolveToken?: (clientId: string) => Promise<{ token: string } | null>
  fetchers?: HeartbeatFetchers
}

/** Live read of one account's delivering budget. Never throws; any failure or timeout -> null. The token never leaves this function. */
export async function readLiveDeliveringProd(
  clientId: string,
  adAccountId: string,
  overrides: LiveReadOverrides = {},
): Promise<LiveDelivering | null> {
  const timeoutMs = overrides.timeoutMs ?? LIVE_READ_TIMEOUT_MS
  const resolveToken = overrides.resolveToken ?? resolveMetaTokenForClient
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs)
  })
  const work = (async (): Promise<LiveDelivering | null> => {
    const resolved = await resolveToken(clientId)
    if (resolved === null) return null
    const read = await readHeartbeatAccount({
      adAccountId,
      accessToken: resolved.token,
      now: new Date(),
      accountHasActiveCampaigns: true,
      fetchers: overrides.fetchers,
    })
    return liveDeliveringFromRead(read)
  })()
  // swallow a late rejection after the race is decided
  work.catch(() => undefined)
  try {
    return await Promise.race([work, timeout])
  } catch {
    return null
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

/** 生产依赖：每个 productionDeps() 实例内按 clientId 记忆化行业读取。 */
export function productionDeps(): PlanSeedDeps {
  const industryCache = new Map<string, Promise<string | null>>()

  /** 记忆化读行业：同一个 clientId 只查一次。 */
  function loadIndustry(clientId: string): Promise<string | null> {
    const cached = industryCache.get(clientId)
    if (cached !== undefined) return cached
    const pending = queryIndustry(clientId)
    industryCache.set(clientId, pending)
    return pending
  }

  /** 读快照事实：行业 -> 剧本 -> loadAdsDraftFacts。 */
  async function loadFacts(clientId: string, adAccountId: string) {
    const industry = await loadIndustry(clientId)
    const playbook = resolvePromoPlaybook(industry)
    return loadAdsDraftFacts({
      clientId,
      adAccountId,
      // required by loadAdsDraftFacts; plan seed does not deduct human-filled plan steps.
      committedMinor: 0,
      playbook,
    })
  }

  /** 读剧本里的预算比例。 */
  async function playbookShare(clientId: string): Promise<number> {
    const industry = await loadIndustry(clientId)
    return resolvePromoPlaybook(industry).draftBudgetShareOfHeadroom
  }

  return {
    now: () => new Date(),
    loadOwnedAccounts,
    loadFacts,
    loadCaptureAt,
    loadClientPageId: queryPageId,
    getPageToken: loadPageToken,
    readForms: loadForms,
    readScopes: loadScopes,
    readPromotePages: loadPromotePages,
    playbookShare,
    readLiveDelivering: (clientId, adAccountId) =>
      readLiveDeliveringProd(clientId, adAccountId),
  }
}

/** 读目标周期；没有目标、出错或字段缺失都返回 null。永不抛错。 */
export async function loadGoalPeriod(
  goalId: string | null,
): Promise<{ start_date: string; end_date: string } | null> {
  if (goalId === null || goalId === '') return null
  try {
    const { data, error } = await supabaseAdmin
      .from('goals')
      .select('period_start, period_end')
      .eq('id', goalId)
      .maybeSingle()
    if (error !== null || data === null) return null
    const rec = data as { period_start?: unknown; period_end?: unknown }
    if (rec.period_start === null || rec.period_start === undefined) return null
    if (rec.period_end === null || rec.period_end === undefined) return null
    return {
      start_date: String(rec.period_start).slice(0, 10),
      end_date: String(rec.period_end).slice(0, 10),
    }
  } catch {
    return null
  }
}
