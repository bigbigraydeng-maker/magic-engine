import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ViralRef } from './topic-agent'

const m = vi.hoisted(() => ({
  intakeConfig: {
    enabled: true,
    keywords: ['AI'],
    platforms: ['xiaohongshu'] as string[],
    cadence: 'weekly' as const,
    scrapePerPlatform: 20,
    rewriteCount: 5,
    preferences: '',
    news_feeds: [] as string[],
  },
  apify: vi.fn(),
  newsFetch: vi.fn(),
  generate: vi.fn(),
  existingSources: [] as string[],
  inserts: [] as unknown[],
}))

vi.mock('./intake-config', () => ({
  getIntakeConfig: vi.fn(async () => m.intakeConfig),
}))

vi.mock('@/lib/apify/client', () => ({
  runActorAndGetResults: (...args: unknown[]) => m.apify(...args),
}))

vi.mock('./intake-news-feeds', () => ({
  fetchNewsViralsForIntake: (...args: unknown[]) => m.newsFetch(...args),
}))

vi.mock('./topic-agent', () => ({
  generateCandidate: (...args: unknown[]) => m.generate(...args),
}))

vi.mock('@/lib/supabase', () => {
  const chain = (): Record<string, unknown> => {
    const c: Record<string, unknown> = {}
    const pass = () => c
    c.select = pass
    c.eq = pass
    c.not = pass
    c.order = pass
    c.limit = pass
    c.insert = async (row: unknown) => {
      m.inserts.push(row)
      return { error: null }
    }
    c.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: m.existingSources.map((source) => ({ source })), error: null })
    return c
  }
  return { supabaseAdmin: { from: () => chain() } }
})

import { mixIntakePicks } from './intake-pick-mix'
import { runIntakeForClient } from './intake-runner'

const viral = (title: string): ViralRef => ({
  title,
  transcript: `body-${title}`,
  engagement: '100赞',
})

beforeEach(() => {
  m.intakeConfig = {
    enabled: true,
    keywords: ['AI'],
    platforms: ['xiaohongshu'],
    cadence: 'weekly',
    scrapePerPlatform: 20,
    rewriteCount: 5,
    preferences: '',
    news_feeds: [],
  }
  m.existingSources = []
  m.inserts = []
  m.apify.mockReset()
  m.newsFetch.mockReset()
  m.generate.mockReset()
  m.apify.mockResolvedValue({
    success: true,
    data: [{ title: 'V1', desc: 'd1', engagement: { liked_count: 1 } }],
  })
  m.generate.mockImplementation(async (_clientId: string, v: ViralRef) => ({
    title: `gen-${v.title}`,
    hook: 'hook',
    script: 'script',
    pillar: 'p',
    platforms: [],
    source: v.title,
  }))
  m.newsFetch.mockResolvedValue({ items: [], warnings: [] })
})

describe('mixIntakePicks', () => {
  it('reserves one news slot when rewriteCount > 1', () => {
    const virals = ['v1', 'v2', 'v3', 'v4', 'v5'].map(viral)
    const news = [viral('news-fresh')]
    const mixed = mixIntakePicks(virals, news, 5)
    expect(mixed).toHaveLength(5)
    expect(mixed[0].title).toBe('news-fresh')
    expect(mixed.slice(1).map((x) => x.title)).toEqual(['v1', 'v2', 'v3', 'v4'])
  })

  it('does not reserve news when rewriteCount is 1', () => {
    const mixed = mixIntakePicks([viral('v1')], [viral('news')], 1)
    expect(mixed.map((x) => x.title)).toEqual(['v1'])
  })
})

describe('runIntakeForClient news hotspot', () => {
  it('does not fetch news when platform news is off', async () => {
    m.intakeConfig.platforms = ['xiaohongshu']
    await runIntakeForClient('client-1')
    expect(m.newsFetch).not.toHaveBeenCalled()
  })

  it('fetches and rewrites deduped news when platform news is on', async () => {
    m.intakeConfig.platforms = ['news']
    m.intakeConfig.news_feeds = ['https://example.com/feed.xml']
    m.intakeConfig.rewriteCount = 2
    m.apify.mockResolvedValue({ success: true, data: [] })
    m.newsFetch.mockResolvedValue({
      items: [viral('AI headline'), viral('AI headline')],
      warnings: [],
    })
    const result = await runIntakeForClient('client-1')
    expect(m.newsFetch).toHaveBeenCalledOnce()
    expect(m.newsFetch.mock.calls[0][0]).toMatchObject({
      feedUrls: ['https://example.com/feed.xml'],
    })
    expect(m.generate).toHaveBeenCalledTimes(1)
    expect(result.created).toBe(1)
    expect(m.inserts[0]).toMatchObject({ source: '抓自：AI headline' })
  })

  it('does not waste the news slot on an already-seen headline before mix', async () => {
    m.existingSources = ['抓自：News1']
    m.intakeConfig.platforms = ['xiaohongshu', 'news']
    m.intakeConfig.news_feeds = ['https://example.com/feed.xml']
    m.intakeConfig.rewriteCount = 3
    m.apify.mockResolvedValue({
      success: true,
      data: [
        { title: 'V1', desc: 'd', engagement: { liked_count: 1 } },
        { title: 'V2', desc: 'd', engagement: { liked_count: 1 } },
        { title: 'V3', desc: 'd', engagement: { liked_count: 1 } },
      ],
    })
    m.newsFetch.mockResolvedValue({ items: [viral('News1')], warnings: [] })
    await runIntakeForClient('client-1')
    expect(m.generate.mock.calls.map((c) => (c[1] as ViralRef).title)).toEqual(['V1', 'V2', 'V3'])
  })

  it('skips news fetch when news is on but news_feeds is empty', async () => {
    m.intakeConfig.platforms = ['news']
    m.intakeConfig.news_feeds = []
    m.apify.mockResolvedValue({ success: true, data: [] })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await runIntakeForClient('client-1')
    expect(m.newsFetch).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('news_feeds'))
    warn.mockRestore()
  })

  it('uses mix so one news slot plus viral slots within rewriteCount', async () => {
    m.intakeConfig.platforms = ['xiaohongshu', 'news']
    m.intakeConfig.news_feeds = ['https://example.com/feed.xml']
    m.intakeConfig.rewriteCount = 3
    m.apify.mockResolvedValue({
      success: true,
      data: [
        { title: 'V1', desc: 'd', engagement: { liked_count: 1 } },
        { title: 'V2', desc: 'd', engagement: { liked_count: 1 } },
      ],
    })
    m.newsFetch.mockResolvedValue({ items: [viral('News1')], warnings: [] })
    await runIntakeForClient('client-1')
    expect(m.generate.mock.calls.map((c) => (c[1] as ViralRef).title)).toEqual(['News1', 'V1', 'V2'])
  })

  it('continues intake when news fetch reports failures', async () => {
    m.intakeConfig.platforms = ['news']
    m.intakeConfig.news_feeds = ['https://example.com/feed']
    m.newsFetch.mockResolvedValue({
      items: [],
      warnings: ['新闻 RSS 跳过 https://example.com/feed：timeout'],
    })
    m.apify.mockResolvedValue({ success: true, data: [] })
    const result = await runIntakeForClient('client-1')
    expect(result.errors).not.toContain(expect.stringContaining('新闻'))
    expect(result.scanned).toBe(0)
    expect(result.created).toBe(0)
  })
})
