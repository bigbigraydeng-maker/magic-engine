/**
 * DataForSEO Business Data API — GMB + Google Reviews + Tripadvisor.
 *
 * Reference: ROADMAP.md P8.13.C.1
 *
 * Replaces the SerpAPI google_maps engine in local-reviews/client.ts:
 *   - getGmbInfo:           GMB place card (rating, review count, address, phone)
 *   - getGoogleReviews:     Individual Google reviews (text + rating + author)
 *   - getTripadvisorInfo:   Tripadvisor listing (rating, review count, URL)
 *
 * All functions return null on "not found" — non-fatal for 张骞.
 * Authentication: Basic Auth (DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD).
 *
 * Estimated cost:
 *   - getGmbInfo:         ~$0.002 per call
 *   - getGoogleReviews:   ~$0.005 per call (1 depth unit = 10 reviews)
 *   - getTripadvisorInfo: ~$0.002 per call
 */

import { validateEnvVar } from '@/lib/validation-utils'

const DATAFORSEO_API_BASE = 'https://api.dataforseo.com/v3'

// ─── Return types ─────────────────────────────────────────────────────────────

export interface GmbInfo {
  /** Google Maps place_id (used for review lookups). null if not found. */
  place_id:     string | null
  name:         string
  address:      string | null
  phone:        string | null
  website:      string | null
  /** Overall star rating (1–5). null if no reviews. */
  rating:       number | null
  /** Total review count. null if unavailable. */
  review_count: number | null
  /** Google Maps URL for this listing. */
  maps_url:     string | null
}

export interface GoogleReview {
  rating: number
  text:   string
  date:   string | null
  author: string | null
}

export interface TripadvisorInfo {
  name:         string | null
  url:          string | null
  rating:       number | null
  review_count: number | null
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

function authHeader(): string {
  const login    = validateEnvVar('DATAFORSEO_LOGIN')
  const password = validateEnvVar('DATAFORSEO_PASSWORD')
  return `Basic ${Buffer.from(`${login}:${password}`).toString('base64')}`
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch a Google My Business place card for a business keyword.
 *
 * DataForSEO endpoint: /business_data/google/my_business_info/live
 *
 * @param keyword  Business search term, e.g. "Oztop Building Supplies Slacks Creek QLD"
 * @returns        GMB place card, or null if no match found.
 */
export async function getGmbInfo(keyword: string): Promise<GmbInfo | null> {
  const res = await fetch(
    `${DATAFORSEO_API_BASE}/business_data/google/my_business_info/live`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([{ keyword, language_code: 'en' }]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO GMB info error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      status_code?: number
      result?: Array<{
        items?: Array<{
          place_id?:  string | null
          title?:     string | null
          address?:   string | null
          phone?:     string | null
          url?:       string | null
          maps_url?:  string | null
          rating?: {
            value?:       number | null
            votes_count?: number | null
          } | null
        }>
      }>
    }>
  }

  const item = json.tasks?.[0]?.result?.[0]?.items?.[0]
  if (!item) return null

  return {
    place_id:     item.place_id     ?? null,
    name:         item.title        ?? keyword,
    address:      item.address      ?? null,
    phone:        item.phone        ?? null,
    website:      item.url          ?? null,
    rating:       item.rating?.value       ?? null,
    review_count: item.rating?.votes_count ?? null,
    maps_url:     item.maps_url     ?? null,
  }
}

/**
 * Fetch individual Google reviews for a business keyword.
 *
 * DataForSEO endpoint: /business_data/google/reviews/live
 *
 * @param keyword  Same business search term as getGmbInfo
 * @param limit    Max reviews to return (default 10; each 10 = 1 depth unit)
 * @returns        Parsed review list, or null if not found.
 */
export async function getGoogleReviews(
  keyword: string,
  limit: number = 10,
): Promise<GoogleReview[] | null> {
  const depth = Math.max(1, Math.ceil(limit / 10))

  const res = await fetch(
    `${DATAFORSEO_API_BASE}/business_data/google/reviews/live`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([{ keyword, depth, language_code: 'en', sort_by: 'newest' }]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO Google reviews error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      result?: Array<{
        items?: Array<{
          rating?: {
            value?: number | null
          } | null
          review_text?: string | null
          timestamp?:   string | null
          author_name?: string | null
        }>
      }>
    }>
  }

  const items = json.tasks?.[0]?.result?.[0]?.items
  if (!items || items.length === 0) return null

  return items
    .filter(it => typeof it.rating?.value === 'number')
    .slice(0, limit)
    .map(it => ({
      rating: it.rating!.value as number,
      text:   it.review_text?.trim() ?? '',
      date:   it.timestamp ?? null,
      author: it.author_name ?? null,
    }))
}

// ─── Reputation monitoring (DataForSEO 计划 阶段 2) ──────────────────────────

export interface GbpReviewItem extends GoogleReview {
  /** DataForSEO review_id — dedup key for review_items. null when absent. */
  review_id: string | null
}

export interface GbpReviewsWithProfile {
  /** Listing-level rating from the reviews response (saves a my_business_info call). */
  profile: { rating: number | null; review_count: number | null } | null
  reviews: GbpReviewItem[]
}

/**
 * ⚠️ DataForSEO 的 business_data 评论类端点没有 live 模式（实测 404）：
 * google/reviews 和 tripadvisor/search 都只有 task_post → task_get 队列模式。
 * （仓里旧的 getGoogleReviews / getTripadvisorInfo 打的 live URL 是死端点，
 * 一直被调用方的 catch 吞成 null —— 独立修，不在本模块动。）
 */

/** 队列任务默认最多等 4 分钟（实测通常 ~40-60s 完成），每 10s 问一次。 */
const TASK_POLL_INTERVAL_MS = 10_000
const TASK_POLL_TIMEOUT_MS  = 240_000

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/** POST a business_data task, return the DataForSEO task id. */
async function postBusinessDataTask(
  endpoint: string,
  task: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(`${DATAFORSEO_API_BASE}/business_data/${endpoint}/task_post`, {
    method:  'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify([task]),
  })
  if (!res.ok) throw new Error(`DataForSEO ${endpoint} task_post error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{ id?: string; status_code?: number; status_message?: string }>
  }
  const t = json.tasks?.[0]
  // 20100 = Task Created
  if (!t?.id || (t.status_code !== undefined && t.status_code >= 40000)) {
    throw new Error(
      `DataForSEO ${endpoint} task_post rejected: ${t?.status_code} ${t?.status_message}`,
    )
  }
  return t.id
}

/**
 * 排队中（继续等）：40601 Task Handed / 40602 Task In Queue。
 * 官方标注 transient（deadline 内重试，别把已付费任务一炮打死，魏征 🟡1）：
 * 40202 分钟级限流 / 40209 并发过多 / 50301 3rd Party Unavailable / 50401 Timeout。
 */
const TASK_WAIT_CODES = new Set([40601, 40602, 40202, 40209, 50301, 50401])

/** Poll task_get until the task completes; returns result[0] payload. */
async function pollBusinessDataTask<T>(
  endpoint: string,
  taskId: string,
): Promise<T | null> {
  const deadline = Date.now() + TASK_POLL_TIMEOUT_MS
  for (;;) {
    let code = 0
    let message: string | undefined
    let payload: T | null | undefined

    try {
      const res = await fetch(
        `${DATAFORSEO_API_BASE}/business_data/${endpoint}/task_get/${taskId}`,
        { headers: { Authorization: authHeader() } },
      )
      if (res.ok) {
        const json = await res.json() as {
          status_code?: number
          status_message?: string
          tasks?: Array<{ status_code?: number; status_message?: string; result?: T[] | null }>
        }
        const t = json.tasks?.[0]
        if (t) {
          code = t.status_code ?? 0
          message = t.status_message
          payload = t.result?.[0] ?? null
        } else if ((json.status_code ?? 0) >= 40000) {
          // 顶层就挂了（如鉴权失败）—— 别哑等满 240s（魏征 ⚪2）
          throw new Error(
            `DataForSEO ${endpoint} task_get top-level failure: ${json.status_code} ${json.status_message}`,
          )
        }
      }
      // res 非 200 → code 保持 0，按瞬时抖动处理，deadline 内重试
    } catch (err) {
      if (err instanceof Error && /top-level failure/.test(err.message)) throw err
      // 网络级抖动同样在 deadline 内重试
    }

    if (code === 20000) return payload ?? null
    if (code >= 40000 && !TASK_WAIT_CODES.has(code)) {
      throw new Error(`DataForSEO ${endpoint} task failed: ${code} ${message}`)
    }
    if (Date.now() >= deadline) {
      throw new Error(`DataForSEO ${endpoint} task ${taskId} timed out after ${TASK_POLL_TIMEOUT_MS}ms`)
    }
    await sleep(TASK_POLL_INTERVAL_MS)
  }
}

interface GbpReviewsTaskResult {
  rating?: { value?: number | null; votes_count?: number | null } | null
  reviews_count?: number | null
  items?: Array<{
    review_id?:    string | null
    rating?:       { value?: number | null } | null
    review_text?:  string | null
    timestamp?:    string | null
    /** task_get 的作者字段叫 profile_name（不是 author_name，实测确认） */
    profile_name?: string | null
  }>
}

/**
 * Fetch reviews + listing profile for a GBP identity via the task queue.
 * place_id / cid is exact (no wrong-business risk); keyword is the fallback.
 *
 * DataForSEO: /business_data/google/reviews/task_post → task_get
 */
export async function getGbpReviewsByIdentity(
  identity: { place_id?: string | null; keyword?: string | null },
  limit: number = 30,
  options: { locationCode?: number } = {},
): Promise<GbpReviewsWithProfile | null> {
  const task: Record<string, unknown> = {
    depth: Math.max(10, limit),
    language_code: 'en',
    sort_by: 'newest',
    location_code: options.locationCode ?? 2036,
  }
  // GBP 身份两种格式：ChIJ… 是 place_id，纯数字是 cid（GBP OAuth 连接器里
  // 存的就是 cid）—— DataForSEO 是两个不同的 task 字段，塞错查不到
  if (identity.place_id) {
    if (/^\d+$/.test(identity.place_id)) task.cid = identity.place_id
    else task.place_id = identity.place_id
  } else if (identity.keyword) {
    task.keyword = identity.keyword
  } else {
    return null
  }

  const taskId = await postBusinessDataTask('google/reviews', task)
  const result = await pollBusinessDataTask<GbpReviewsTaskResult>('google/reviews', taskId)
  if (!result) return null

  const profile = result.rating
    ? {
        rating:       result.rating.value ?? null,
        review_count: result.reviews_count ?? result.rating.votes_count ?? null,
      }
    : null

  const reviews = (result.items ?? [])
    .filter(it => typeof it.rating?.value === 'number')
    .slice(0, limit)
    .map(it => ({
      review_id: it.review_id ?? null,
      rating:    it.rating!.value as number,
      text:      it.review_text?.trim() ?? '',
      date:      it.timestamp ?? null,
      author:    it.profile_name ?? null,
    }))

  return { profile, reviews }
}

/**
 * Tripadvisor listing snapshot via the task queue（live 端点同样不存在）。
 *
 * DataForSEO: /business_data/tripadvisor/search/task_post → task_get
 * - `location_name` 是 task_post 必填（缺了直接被拒，实测确认）
 * - 返回是搜索结果列表：**必须按名字匹配到目标商家**，盲取第一条会把
 *   竞品的评分记到客户头上（实测 "CTS Tours" 第一条是 Haka Tours）
 * - rating 是对象 {value, votes_count}，不是数字（实测确认）
 */
export async function getTripadvisorSnapshot(
  keyword: string,
  options: { locationName: string },
): Promise<TripadvisorInfo | null> {
  const taskId = await postBusinessDataTask('tripadvisor/search', {
    keyword,
    location_name: options.locationName,
  })
  const result = await pollBusinessDataTask<{
    items?: Array<{
      type?: string | null
      title?: string | null
      url?: string | null
      rating?: { value?: number | null; votes_count?: number | null } | null
      reviews_count?: number | null
    }>
  }>('tripadvisor/search', taskId)

  const normalise = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  const needle = normalise(keyword)

  const item = (result?.items ?? [])
    .filter(it => (it.type ?? 'tripadvisor_search_organic') === 'tripadvisor_search_organic')
    .find(it => {
      const title = normalise(it.title ?? '')
      return title.length > 0 && (title.includes(needle) || needle.includes(title))
    })

  if (!item) return null
  return {
    name:         item.title ?? null,
    url:          item.url   ?? null,
    rating:       item.rating?.value ?? null,
    review_count: item.reviews_count ?? item.rating?.votes_count ?? null,
  }
}

/**
 * Search for a Tripadvisor listing by keyword.
 * Intended for tourism-sector clients (CTS Tours).
 *
 * DataForSEO endpoint: /business_data/tripadvisor/search/live
 *
 * @param keyword  Business or attraction name, e.g. "CTS Tours New Zealand"
 * @returns        First matching Tripadvisor result, or null if not found.
 */
export async function getTripadvisorInfo(keyword: string): Promise<TripadvisorInfo | null> {
  const res = await fetch(
    `${DATAFORSEO_API_BASE}/business_data/tripadvisor/search/live`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([{ keyword, language_name: 'English' }]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO Tripadvisor error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      result?: Array<{
        items?: Array<{
          title?:        string | null
          url?:          string | null
          rating?:       number | null
          reviews_count?: number | null
        }>
      }>
    }>
  }

  const item = json.tasks?.[0]?.result?.[0]?.items?.[0]
  if (!item) return null

  return {
    name:         item.title         ?? null,
    url:          item.url           ?? null,
    rating:       item.rating        ?? null,
    review_count: item.reviews_count ?? null,
  }
}
