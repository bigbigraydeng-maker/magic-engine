/**
 * DataForSEO Labs API — keyword intelligence.
 *
 * Split out of labs.ts (2026-09-23). labs.ts remains the barrel.
 */

import {
  DATAFORSEO_API_BASE,
  DEFAULT_LOCATION_CODE,
  DEFAULT_LANGUAGE_CODE,
  DataForSeoTaskError,
  authHeader,
  deriveIntent,
  normalizeDataForSeoIntent,
  type LabsKeyword,
} from './labs-types'

/**
 * Fetch the top organic keywords that a domain ranks for.
 *
 * DataForSEO endpoint: /dataforseo_labs/google/keywords_for_site/live
 *
 * @param domain        Target domain, e.g. "oztop.com.au"
 * @param locationCode  DataForSEO location_code (default 2036 = AU)
 * @param limit         Max keywords to return (default 50, max 1000)
 */
export async function getKeywordsForSite(
  domain: string,
  locationCode: number = DEFAULT_LOCATION_CODE,
  limit: number = 50,
): Promise<LabsKeyword[]> {
  const res = await fetch(`${DATAFORSEO_API_BASE}/dataforseo_labs/google/keywords_for_site/live`, {
    method:  'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify([
      {
        target:         domain,
        location_code:  locationCode,
        language_code:  DEFAULT_LANGUAGE_CODE,
        limit,
        order_by:       ['keyword_info.search_volume,desc'],
      },
    ]),
  })

  if (!res.ok) throw new Error(`DataForSEO Labs keywords_for_site error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      result?: Array<{
        items?: Array<{
          keyword?: string
          keyword_info?: {
            search_volume?: number | null
            cpc?:           number | null
            competition?:   number | null
          }
          keyword_properties?: {
            keyword_difficulty?: number | null
          }
          search_intent_info?: {
            main_intent?: string | null
          }
        }>
      }>
    }>
  }

  const items = json.tasks?.[0]?.result?.[0]?.items ?? []

  // keywords_for_site returns FLAT items (keyword / keyword_info /
  // keyword_properties at the top level), matching the response type above.
  // A 2026 bulk edit wrongly switched this to a nested `it.keyword_data` that
  // the type never had — tsc flagged it (TS2339) but `ignoreBuildErrors` hid it,
  // so at runtime every item was dropped and this returned []. Read flat.
  return items
    .filter(it => it.keyword)
    .map(it => {
      const cpc = it.keyword_info?.cpc ?? null
      return {
        keyword:            it.keyword ?? '',
        search_volume:      it.keyword_info?.search_volume ?? null,
        keyword_difficulty: it.keyword_properties?.keyword_difficulty ?? null,
        cpc,
        competition:        it.keyword_info?.competition ?? null,
        intent:             deriveIntent(cpc),
        position:           null,
      }
    })
}

/**
 * Batch search volume + difficulty for a list of keywords.
 * Replaces: SEMrush batchKeywordOverview
 *
 * DataForSEO endpoint: /dataforseo_labs/google/keyword_overview/live
 *
 * ⚠️ 2026-08-26：这里原本打的是 `/dataforseo_labs/google/bulk_keyword_search_volume/live`,
 * 而**该端点在 DataForSEO 根本不存在**（实测恒定 404）。唯一的调用方
 * （zhangqian/discover 路由的关键词补数据）把它包在空 catch 里当作"非致命"，
 * 于是这个函数**从上线起就没有成功过一次** —— 历史上每一份 discovery 报告的
 * seed_keywords 里 volume / KD / CPC 全是 null，客户看到的报告满屏是「—」。
 * 换成实测可用的 keyword_overview/live；注意它把 KD 放在 keyword_properties 下，
 * 不是顶层。改端点前请先用真实凭据打一次，不要只看文档。
 *
 * @param keywords     Up to 1 000 keywords
 * @param locationCode DataForSEO location_code (default 2036 = AU)
 */
export async function bulkKeywordVolume(
  keywords: string[],
  locationCode: number = DEFAULT_LOCATION_CODE,
): Promise<LabsKeyword[]> {
  if (keywords.length === 0) return []

  const res = await fetch(
    `${DATAFORSEO_API_BASE}/dataforseo_labs/google/keyword_overview/live`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          keywords:      keywords,
          location_code: locationCode,
          language_code: DEFAULT_LANGUAGE_CODE,
        },
      ]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO keyword_overview error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      status_code?:    number
      status_message?: string
      result?: Array<{
        items?: Array<{
          keyword?:            string
          keyword_info?: {
            search_volume?: number | null
            cpc?:           number | null
            competition?:   number | null
          }
          // keyword_overview 把难度放在这里，不是顶层
          keyword_properties?: {
            keyword_difficulty?: number | null
          }
        }>
      }>
    }>
  }

  const task = json.tasks?.[0]
  // 采严格路径：status_code 缺失（畸形响应/网关抢答）也抛错，避免踩回 Codex 原本挑的坑。
  // 跟仓库另一个先例 business-listings.ts:224 反向选择：那处是历史遗留宽处理，
  // 我们跟 popular-products.ts:166 / business-data.ts 保持一致。
  if ((task?.status_code ?? 0) !== 20000) {
    throw new DataForSeoTaskError(
      task?.status_code,
      `DataForSEO keyword_overview task error ${task?.status_code ?? 'missing'}: ${task?.status_message ?? 'unknown'}`,
    )
  }

  const items = task?.result?.[0]?.items ?? []

  return items
    .filter(it => it.keyword)
    .map(it => {
      const cpc = it.keyword_info?.cpc ?? null
      return {
        keyword:            it.keyword ?? '',
        search_volume:      it.keyword_info?.search_volume ?? null,
        keyword_difficulty: it.keyword_properties?.keyword_difficulty ?? null,
        cpc,
        competition:        it.keyword_info?.competition ?? null,
        intent:             deriveIntent(cpc),
        position:           null,
      }
    })
}

/**
 * Keyword ideas for a seed term — related keywords with volume, difficulty, CPC.
 * Replaces: SEMrush getRelatedKeywords + getQuestionKeywords
 *
 * DataForSEO endpoint: /dataforseo_labs/google/keyword_ideas/live
 *
 * @param seed         Seed keyword, e.g. "vinyl flooring"
 * @param locationCode DataForSEO location_code (default 2036 = AU)
 * @param limit        Max keywords to return (default 50)
 * @param questionsOnly If true, filters for question-form keywords (who/what/how…)
 */
export async function getKeywordIdeas(
  seed: string,
  locationCode: number = DEFAULT_LOCATION_CODE,
  limit: number = 50,
  questionsOnly = false,
): Promise<LabsKeyword[]> {
  const res = await fetch(
    `${DATAFORSEO_API_BASE}/dataforseo_labs/google/keyword_ideas/live`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([
      {
        keywords:      [seed],
        location_code: locationCode,
        language_code: DEFAULT_LANGUAGE_CODE,
        limit,
      },
      ]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO keyword_ideas error: ${res.status}`)

  // keyword_ideas returns FLAT items, same shape as keywords_for_site and
  // keyword_suggestions. Only the *_intersection / related_keywords endpoints
  // nest under keyword_data — see the note above getKeywordsForSite.
  const json = await res.json() as {
    tasks?: Array<{
      result?: Array<{
        items?: Array<{
          keyword?: string
          keyword_info?: {
            search_volume?: number | null
            cpc?:           number | null
            competition?:   number | null
          }
          keyword_properties?: {
            keyword_difficulty?: number | null
          }
          search_intent_info?: {
            main_intent?: string | null
          }
        }>
      }>
    }>
  }

  const QUESTION_STARTERS = /^(who|what|where|when|why|how|can|is|are|does|do|will|should|which)\b/i

  const items = json.tasks?.[0]?.result?.[0]?.items ?? []

  return items
    .filter(it => it.keyword)
    .filter(it => !questionsOnly || QUESTION_STARTERS.test(it.keyword!))
    .map(it => {
      const cpc = it.keyword_info?.cpc ?? null
      const intent = normalizeDataForSeoIntent(it.search_intent_info?.main_intent, cpc)
      return {
        keyword:            it.keyword ?? '',
        search_volume:      it.keyword_info?.search_volume ?? null,
        keyword_difficulty: it.keyword_properties?.keyword_difficulty ?? null,
        cpc,
        competition:        it.keyword_info?.competition ?? null,
        intent,
        position:           null,
      }
    })
}

/**
 * Keyword suggestions for a seed term - long-tail keywords that contain the
 * specified phrase, useful for service-led opportunity baselines.
 *
 * DataForSEO endpoint: /dataforseo_labs/google/keyword_suggestions/live
 */
export async function getKeywordSuggestions(
  seed: string,
  locationCode: number = DEFAULT_LOCATION_CODE,
  limit: number = 50,
  includeSeedKeyword = false,
): Promise<LabsKeyword[]> {
  const res = await fetch(
    `${DATAFORSEO_API_BASE}/dataforseo_labs/google/keyword_suggestions/live`,
    {
      method:  'POST',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify([
        {
          keyword:              seed,
          location_code:        locationCode,
          language_code:        DEFAULT_LANGUAGE_CODE,
          limit,
          include_seed_keyword: includeSeedKeyword,
        },
      ]),
    },
  )

  if (!res.ok) throw new Error(`DataForSEO keyword_suggestions error: ${res.status}`)

  const json = await res.json() as {
    tasks?: Array<{
      result?: Array<{
        items?: Array<{
          keyword?: string
          keyword_info?: {
            search_volume?: number | null
            cpc?:           number | null
            competition?:   number | null
          }
          keyword_properties?: {
            keyword_difficulty?: number | null
          }
          search_intent_info?: {
            main_intent?: string | null
          }
        }>
      }>
    }>
  }

  const items = json.tasks?.[0]?.result?.[0]?.items ?? []

  return items
    .filter(it => it.keyword)
    .map(it => {
      const cpc = it.keyword_info?.cpc ?? null
      const intent = normalizeDataForSeoIntent(it.search_intent_info?.main_intent, cpc)
      return {
        keyword:            it.keyword ?? '',
        search_volume:      it.keyword_info?.search_volume ?? null,
        keyword_difficulty: it.keyword_properties?.keyword_difficulty ?? null,
        cpc,
        competition:        it.keyword_info?.competition ?? null,
        intent,
        position:           null,
      }
    })
}
