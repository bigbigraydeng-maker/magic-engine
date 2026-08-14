/**
 * page-enrichment：从 job-executor 抽出来的富集逻辑（Issue #930）。
 *
 * 抽取的前提是「行为逐字不变」，所以这里把原来的三条兜底行为钉死：
 * 分类失败退回 other 且 `classified=false`、GEO 失败退回默认值、词数按空白切分。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enrichCrawledPage, FALLBACK_PAGE_TYPE } from '../page-enrichment'
import { classifyPage } from '../classifier'
import { detectGEOBlock } from '../geo-detector'

vi.mock('../classifier', () => ({ classifyPage: vi.fn() }))
vi.mock('../geo-detector', () => ({ detectGEOBlock: vi.fn() }))

const PAGE = { url: 'https://example.com/a', title: 'A', markdown: 'one two three' }

beforeEach(() => {
  vi.mocked(classifyPage).mockResolvedValue({
    page_type: 'service',
    topics: ['t'],
    primary_keyword: 'kw',
    confidence: 0.8,
  })
  vi.mocked(detectGEOBlock).mockReturnValue({ has_geo_block: false, detection_method: null, confidence: 0 })
})

describe('enrichCrawledPage', () => {
  it('成功路径带回分类 + GEO + 词数', async () => {
    const result = await enrichCrawledPage(PAGE)
    expect(result).toMatchObject({
      pageType: 'service',
      topics: ['t'],
      primaryKeyword: 'kw',
      classificationConfidence: 0.8,
      classified: true,
      classificationError: null,
      wordCount: 3,
    })
  })

  it('分类失败：退回 other，`classified=false`，原因留痕，**不抛错**', async () => {
    vi.mocked(classifyPage).mockRejectedValue(new Error('openai down'))
    const result = await enrichCrawledPage(PAGE)
    expect(result.pageType).toBe(FALLBACK_PAGE_TYPE)
    expect(result.classified).toBe(false)
    expect(result.classificationError).toBe('openai down')
    expect(result.classificationConfidence).toBe(0)
  })

  it('GEO 检测抛错也不影响这一页', async () => {
    vi.mocked(detectGEOBlock).mockImplementation(() => {
      throw new Error('boom')
    })
    const result = await enrichCrawledPage(PAGE)
    expect(result.hasGeoBlock).toBe(false)
    expect(result.classified).toBe(true)
  })

  it('空正文词数为 0', async () => {
    const result = await enrichCrawledPage({ ...PAGE, markdown: '' })
    expect(result.wordCount).toBe(0)
  })
})
