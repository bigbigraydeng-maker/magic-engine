import { describe, expect, it } from 'vitest'
import { DEFAULT_SEO_LOOP_CONFIG } from '../config'
import { verifyPlanItem, type CrawledPage, type MetaLogRow, type OpenPlanItem } from '../verify'

const cfg = DEFAULT_SEO_LOOP_CONFIG
const created = '2026-10-05T00:00:00Z'

const changedItem = (over: Partial<OpenPlanItem> = {}): OpenPlanItem => ({
  id: 'i1',
  created_at: created,
  steps_json: {
    url: 'https://x.com/p',
    verify: { type: 'page_changed' },
    baseline: { word_count: 800, crawled_at: '2026-10-04T12:00:00Z' },
  },
  ...over,
})

const strengthenItem = (over: Partial<OpenPlanItem> = {}): OpenPlanItem => ({
  id: 'i2',
  created_at: created,
  steps_json: {
    url: 'https://x.com/p',
    verify: { type: 'page_strengthened' },
    baseline: { word_count: 800, crawled_at: '2026-10-04T12:00:00Z' },
  },
  ...over,
})

const pageNow = (over: Partial<CrawledPage> = {}): CrawledPage => ({
  url: 'https://x.com/p',
  status_code: 200,
  crawl_status: 'crawled',
  crawled_at: '2026-10-12T00:00:00Z',
  word_count: 800,
  ...over,
})

const meta = (over: Partial<MetaLogRow> = {}): MetaLogRow => ({
  page_url: 'https://x.com/p',
  optimised_at: '2026-10-08T00:00:00Z',
  reverted_at: null,
  pr_url: 'https://github.com/x/y/pull/1',
  applied_channel: 'pr',
  ...over,
})

describe('verifyPlanItem page_changed', () => {
  it('a live pr-channel meta row applied after creation → pass, names the date and pr_url, even with no recrawl and no word change', () => {
    const d = verifyPlanItem(changedItem(), {
      blogs: [],
      pages: [pageNow({ crawled_at: '2026-10-04T00:00:00Z', word_count: 800 })],
      config: cfg,
      metaLog: [meta()],
    })
    expect(d.outcome).toBe('pass')
    expect(d.reason).toContain('2026-10-08')
    expect(d.reason).toContain('https://github.com/x/y/pull/1')
  })

  it('a meta row applied BEFORE the item was created is ignored (falls back: no recrawl → not_measured)', () => {
    const d = verifyPlanItem(changedItem(), {
      blogs: [],
      pages: [pageNow({ crawled_at: '2026-10-04T00:00:00Z' })],
      config: cfg,
      metaLog: [meta({ optimised_at: '2026-10-01T00:00:00Z' })],
    })
    expect(d.outcome).toBe('not_measured')
  })

  it('a reverted meta row is ignored for the pass; when the fallback is not a pass the reason ends with the reverted note', () => {
    const d = verifyPlanItem(changedItem(), {
      blogs: [],
      pages: [pageNow({ crawled_at: '2026-10-04T00:00:00Z' })],
      config: cfg,
      metaLog: [meta({ reverted_at: '2026-10-09T00:00:00Z' })],
    })
    expect(d.outcome).toBe('not_measured')
    expect(d.reason.endsWith('（系统改的标题已被撤回）')).toBe(true)
  })

  it('applied_channel other than pr (null or wp) is ignored', () => {
    const pages = [pageNow({ crawled_at: '2026-10-04T00:00:00Z' })]
    const nullChannel = verifyPlanItem(changedItem(), { blogs: [], pages, config: cfg, metaLog: [meta({ applied_channel: null })] })
    expect(nullChannel.outcome).toBe('not_measured')
    const wpChannel = verifyPlanItem(changedItem(), { blogs: [], pages, config: cfg, metaLog: [meta({ applied_channel: 'wp' })] })
    expect(wpChannel.outcome).toBe('not_measured')
  })

  it('a row for a DIFFERENT page url is ignored; urls are compared canonically', () => {
    const pages = [pageNow({ crawled_at: '2026-10-04T00:00:00Z' })]
    const other = verifyPlanItem(changedItem(), {
      blogs: [],
      pages,
      config: cfg,
      metaLog: [meta({ page_url: 'https://x.com/other' })],
    })
    expect(other.outcome).toBe('not_measured')
    const canonical = verifyPlanItem(changedItem(), {
      blogs: [],
      pages,
      config: cfg,
      metaLog: [meta({ page_url: 'https://www.x.com/p/' })],
    })
    expect(canonical.outcome).toBe('pass')
  })

  it('with no metaLog and a page that gained >= strengthenMinWordGain words after a fresh crawl → pass by the word-count path', () => {
    const d = verifyPlanItem(changedItem(), {
      blogs: [],
      pages: [pageNow({ word_count: 800 + cfg.strengthenMinWordGain })],
      config: cfg,
    })
    expect(d.outcome).toBe('pass')
  })

  it('page_strengthened is unchanged: it ignores metaLog completely', () => {
    const d = verifyPlanItem(strengthenItem(), {
      blogs: [],
      pages: [pageNow({ crawled_at: '2026-10-04T00:00:00Z' })],
      config: cfg,
      metaLog: [meta()],
    })
    expect(d.outcome).toBe('not_measured')
  })

  it('the latest of several qualifying rows is the one named in the reason', () => {
    const d = verifyPlanItem(changedItem(), {
      blogs: [],
      pages: [pageNow({ crawled_at: '2026-10-04T00:00:00Z' })],
      config: cfg,
      metaLog: [
        meta({ optimised_at: '2026-10-07T00:00:00Z', pr_url: 'https://github.com/x/y/pull/7' }),
        meta({ optimised_at: '2026-10-09T00:00:00Z', pr_url: 'https://github.com/x/y/pull/9' }),
      ],
    })
    expect(d.outcome).toBe('pass')
    expect(d.reason).toContain('2026-10-09')
    expect(d.reason).toContain('https://github.com/x/y/pull/9')
    expect(d.reason).not.toContain('https://github.com/x/y/pull/7')
  })
})
