/**
 * 复用适配器（Issue #930）。
 *
 * 🔴 这一组盯的是一个只在「被接受清单超过 100 条」时才现形的坑：
 *    `crawlPages` 的默认上限是 100，多出来的 URL 连结果都不会有，
 *    激活方只看得到「抓取器没返回这一条」——跑完 100 次真实网络请求之后整批失败，
 *    而原因看着像抓取挂了，实际上是配置把批准过的清单截断了。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createCrawlAdapter } from '../adapters'
import { crawlPages } from '../../crawler'

vi.mock('../../crawler', () => ({
  crawlPages: vi.fn(),
  discoverSitemapUrls: vi.fn(),
}))

const urls = (n: number): string[] => Array.from({ length: n }, (_, i) => `https://example.com/p${i}`)

beforeEach(() => {
  // 不清的话 mock.calls 会跨用例累积，第三条读到的是第一条留下的调用。
  vi.clearAllMocks()
  vi.mocked(crawlPages).mockImplementation(async (list) =>
    list.map((url) => ({
      url,
      markdown: 'x',
      title: 't',
      statusCode: 200,
      crawledAt: new Date('2026-08-12T00:00:00.000Z'),
    })),
  )
})

describe('createCrawlAdapter', () => {
  it('🔴 上限按被接受的页面数给，不吃 crawlPages 的默认 100', async () => {
    const results = await createCrawlAdapter()(urls(137))
    expect(vi.mocked(crawlPages).mock.calls[0][1]).toMatchObject({ limit: 137 })
    expect(results).toHaveLength(137)
  })

  it('显式给了更小的上限 → 直接抛，不退化成一堆看不懂的失败', () => {
    expect(() => createCrawlAdapter({ limit: 10 })(urls(20))).toThrow(/小于被接受的页面数/)
  })

  it('显式上限只要不小于清单长度就照常跑，其余选项原样透传', async () => {
    await createCrawlAdapter({ limit: 500, rateLimitMs: 2000 })(urls(3))
    expect(vi.mocked(crawlPages).mock.calls[0][1]).toMatchObject({ limit: 3, rateLimitMs: 2000 })
  })
})
