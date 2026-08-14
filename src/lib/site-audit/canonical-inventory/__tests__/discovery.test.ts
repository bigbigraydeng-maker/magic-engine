/**
 * 逐主机发现（Issue #930）。
 *
 * 🔴 盯的是一种**缺页**的静默失败：批准清单里有两个互不链接的独立站点时，
 *    只跑第一个的 robots / sitemap / 首页，第二个站的页面根本不会进候选，
 *    复核和激活照样成功 —— 产出一份缺页的台账。
 *    缺页比多页危险：多的会被人看见并拒掉，缺的没人会发现。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { discoverCandidateUrls } from '../adapters'
import { discoverSitemapUrls } from '../../crawler'

vi.mock('../../crawler', () => ({
  crawlPages: vi.fn(),
  discoverSitemapUrls: vi.fn(),
}))

/** 假件收到的是 `https://host`，这里还原成裸主机名再匹配。 */
const bare = (input: string): string => input.replace(/^https:\/\//, '')

beforeEach(() => {
  vi.clearAllMocks()
})

describe('discoverCandidateUrls', () => {
  it('🔴 每个批准主机各发现一遍，结果合并去重', async () => {
    vi.mocked(discoverSitemapUrls).mockImplementation(async (input) =>
      bare(input) === 'example.com'
        ? ['https://example.com/a', 'https://example.com/b']
        : ['https://shop.example.com/x'],
    )
    const outcome = await discoverCandidateUrls(['example.com', 'shop.example.com'])

    expect(vi.mocked(discoverSitemapUrls).mock.calls.map((c) => bare(c[0]))).toEqual([
      'example.com',
      'shop.example.com',
    ])
    expect(outcome.urls).toEqual([
      'https://example.com/a',
      'https://example.com/b',
      'https://shop.example.com/x',
    ])
  })

  it('同一个 URL 被两个主机发现时只留一条', async () => {
    vi.mocked(discoverSitemapUrls).mockResolvedValue(['https://example.com/a'])
    const outcome = await discoverCandidateUrls(['example.com', 'www.example.com'])
    expect(outcome.urls).toEqual(['https://example.com/a'])
  })

  it('🔴 逐主机条数原样返回 —— 某个站 0 条不许被合并结果盖住', async () => {
    vi.mocked(discoverSitemapUrls).mockImplementation(async (input) =>
      bare(input) === 'example.com' ? ['https://example.com/a'] : [],
    )
    const outcome = await discoverCandidateUrls(['example.com', 'legacy.example.com'])
    expect(outcome.perHost).toEqual([
      { host: 'example.com', count: 1, foreignCount: 0, error: null },
      { host: 'legacy.example.com', count: 0, foreignCount: 0, error: null },
    ])
  })

  it('🔴 只返回了别的主机的 URL → 本主机记 0 条（「找到东西」≠「找到这个站的东西」）', async () => {
    // crawler 的同源过滤是宽松的（剥 www + 前缀比较），跑 A 主机时可能只带回 B 的 URL。
    // 按返回总条数记账，A 就被记成「有页面」，那道「0 条必须有人认」的闸永远不响。
    vi.mocked(discoverSitemapUrls).mockImplementation(async (input) =>
      bare(input) === 'www.example.com'
        ? ['https://example.com/a', 'https://example.com/b'] // 全是裸域的页面
        : ['https://example.com/a'],
    )
    const outcome = await discoverCandidateUrls(['example.com', 'www.example.com'])
    const www = outcome.perHost.find((h) => h.host === 'www.example.com')
    expect(www).toMatchObject({ count: 0, foreignCount: 2 })
  })

  it('🔴 主机名字面量以 http 开头（httpbin.org）也能正常发现', async () => {
    // crawler 的 normaliseDomain 用 startsWith('http') 判有没有 scheme，
    // 裸传 httpbin.org 会被当成已带 scheme，直接 new URL() 抛错 —— 那个站一次请求都发不出去。
    vi.mocked(discoverSitemapUrls).mockResolvedValue(['https://httpbin.org/a'])
    const outcome = await discoverCandidateUrls(['httpbin.org'])
    expect(vi.mocked(discoverSitemapUrls).mock.calls[0][0]).toBe('https://httpbin.org')
    expect(outcome.perHost[0]).toMatchObject({ host: 'httpbin.org', count: 1, error: null })
  })

  it('🔴 批准主机带大写也照常统计（否则会要求人去认一个不存在的「发现不完整」）', async () => {
    // new URL() 给回来的 hostname 永远是小写，拿原串 `Example.com` 去比就永远不等，
    // 真找到的页面会被记成 count 0 / foreignCount > 0。
    vi.mocked(discoverSitemapUrls).mockResolvedValue(['https://example.com/a', 'https://example.com/b'])
    const outcome = await discoverCandidateUrls(['Example.COM'])
    expect(outcome.perHost).toEqual([{ host: 'example.com', count: 2, foreignCount: 0, error: null }])
  })

  it('🔴 返回的是 sitemap 文件而不是页面 → 不算页面，并记成结果不完整', async () => {
    // /sitemap.xml 本身是索引时，crawler 的 Level 1 只做一次 <loc> 解析就返回，
    // 拿到的是 page-sitemap.xml 之类的子索引 —— 当页面记账会得到「正数、无错误」的漂亮账，
    // 而真实页面全部静默缺席。
    vi.mocked(discoverSitemapUrls).mockResolvedValue([
      'https://example.com/page-sitemap.xml',
      'https://example.com/post-sitemap.xml',
    ])
    const outcome = await discoverCandidateUrls(['example.com'])
    expect(outcome.perHost[0].count).toBe(0)
    expect(outcome.perHost[0].error).toContain('sitemap 文件')
    expect(outcome.urls).toEqual([])
  })

  it('🔴 发现过程中被吞掉的失败要记成 error（部分结果不许当完整结果）', async () => {
    // discoverSitemapUrls 每一级回退都会吞掉失败继续走：一棵子 sitemap 取不到、
    // 其余还有结果时它正常返回 —— 部分结果长得跟完整结果一模一样。
    vi.mocked(discoverSitemapUrls).mockImplementation(async (input, opts) => {
      opts?.onIssue?.({ stage: 'child-sitemap', url: `${input}/sitemap-2.xml`, error: 'HTTP 503' })
      return [`${input}/a`]
    })
    const outcome = await discoverCandidateUrls(['example.com'])
    expect(outcome.perHost[0].count).toBe(1)
    expect(outcome.perHost[0].error).toContain('被吞掉')
    expect(outcome.perHost[0].error).toContain('sitemap-2.xml')
  })

  it('一个主机挂掉不影响别的主机，但必须留痕（否则跟「没有页面」长得一样）', async () => {
    vi.mocked(discoverSitemapUrls).mockImplementation(async (input) => {
      if (bare(input) === 'broken.example.com') throw new Error('DNS lookup failed')
      return ['https://example.com/a']
    })
    const outcome = await discoverCandidateUrls(['broken.example.com', 'example.com'])
    expect(outcome.urls).toEqual(['https://example.com/a'])
    expect(outcome.perHost[0]).toMatchObject({ host: 'broken.example.com', count: 0 })
    expect(outcome.perHost[0].error).toContain('DNS lookup failed')
  })

  it('主机名带大写也要数得对 —— 用的是计划那边同一个归一函数', async () => {
    // 归属比对拿的是解析后的小写 hostname。这里不先归一的话，`Example.COM`
    // 一条都对不上、记成 0 条，然后要求人去认一个其实好端端的站 ——
    // 方向是安全的，但假警报会训练人闭眼点「认了」。
    vi.mocked(discoverSitemapUrls).mockResolvedValue(['https://example.com/a'])
    const outcome = await discoverCandidateUrls([' Example.COM '])
    expect(outcome.perHost[0]).toMatchObject({ host: 'example.com', count: 1, foreignCount: 0, error: null })
  })

  it('同一个主机写两遍只发现一次（归一顺带去重）', async () => {
    vi.mocked(discoverSitemapUrls).mockResolvedValue(['https://example.com/a'])
    const outcome = await discoverCandidateUrls(['example.com', 'EXAMPLE.com'])
    expect(vi.mocked(discoverSitemapUrls)).toHaveBeenCalledTimes(1)
    expect(outcome.perHost).toHaveLength(1)
  })

  it('畸形的批准主机在发一次请求之前就抛（不许先跑一轮再报错）', async () => {
    await expect(discoverCandidateUrls(['https://example.com/path'])).rejects.toThrow()
    expect(vi.mocked(discoverSitemapUrls)).not.toHaveBeenCalled()
  })
})
