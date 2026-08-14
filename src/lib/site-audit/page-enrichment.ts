/**
 * 单页富集：分类 + GEO 块检测 + 词数。
 *
 * 这段逻辑原本长在 `job-executor.crawlAndClassifyPages()` 里，与「立刻 upsert」写死在一起。
 * Issue #930 的台账激活需要**先富集、全部成功了再决定写不写**，所以把这一段原样抽出来
 * （行为逐字保留：分类失败退回 `other` 且不计入 classified，GEO 失败退回默认值）。
 *
 * 🔴 抽取只是搬家，不是重写 —— job-executor 的既有行为一个字都没变。
 */

import { classifyPage } from './classifier'
import { detectGEOBlock } from './geo-detector'

/** 分类失败时的兜底页面类型（与 job-executor 原值一致）。 */
export const FALLBACK_PAGE_TYPE = 'other'

export interface EnrichedPage {
  readonly pageType: string
  readonly topics: string[]
  readonly primaryKeyword: string | null
  readonly classificationConfidence: number
  /** 分类是否真的成功。job-executor 的 `classifiedCount` 只数这一项为 true 的。 */
  readonly classified: boolean
  /** 分类失败时的原因；成功为 `null`。台账激活拿它判「这一页够不够格写进去」。 */
  readonly classificationError: string | null
  readonly hasGeoBlock: boolean
  readonly geoDetectionMethod: string | null
  readonly geoConfidence: number
  readonly wordCount: number
}

/**
 * 富集一个已抓取成功的页面。**永不抛错** —— 失败以字段形式如实返回，由调用方决定怎么办。
 */
export async function enrichCrawledPage(page: {
  url: string
  title: string
  markdown: string
}): Promise<EnrichedPage> {
  const classification = await classifyOrFallback(page)
  const geo = detectGeoOrDefault(page.markdown)
  const wordCount = page.markdown ? page.markdown.trim().split(/\s+/).filter(Boolean).length : 0
  return { ...classification, ...geo, wordCount }
}

type ClassificationPart = Pick<
  EnrichedPage,
  'pageType' | 'topics' | 'primaryKeyword' | 'classificationConfidence' | 'classified' | 'classificationError'
>

/** 分类失败退回未分类默认值并留下原因，**不抛** —— 与 job-executor 原行为逐字一致。 */
async function classifyOrFallback(page: {
  url: string
  title: string
  markdown: string
}): Promise<ClassificationPart> {
  try {
    const c = await classifyPage(page.url, page.title, page.markdown)
    return {
      pageType: c.page_type,
      topics: c.topics,
      primaryKeyword: c.primary_keyword,
      classificationConfidence: c.confidence,
      classified: true,
      classificationError: null,
    }
  } catch (err) {
    return {
      pageType: FALLBACK_PAGE_TYPE,
      topics: [],
      primaryKeyword: null,
      classificationConfidence: 0,
      classified: false,
      classificationError: err instanceof Error ? err.message : String(err),
    }
  }
}

type GeoPart = Pick<EnrichedPage, 'hasGeoBlock' | 'geoDetectionMethod' | 'geoConfidence'>

/** GEO 检测失败不影响这一页。 */
function detectGeoOrDefault(markdown: string): GeoPart {
  try {
    const geo = detectGEOBlock(markdown)
    return {
      hasGeoBlock: geo.has_geo_block,
      geoDetectionMethod: geo.detection_method,
      geoConfidence: geo.confidence,
    }
  } catch {
    return { hasGeoBlock: false, geoDetectionMethod: null, geoConfidence: 0 }
  }
}
