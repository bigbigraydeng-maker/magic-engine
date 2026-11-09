import { describe, it, expect } from 'vitest'
import {
  isNotIndexed,
  classifyNotIndexed,
  normalizeVerdict,
  INDEX_CLASS_META,
  isActionableNotIndexed,
  THIN_WORD_COUNT_THRESHOLD,
  UNKNOWN_TO_GOOGLE,
  type IndexClass,
  type NotIndexedClassInput,
} from '../index-status'

describe('isNotIndexed — first_not_indexed_at 非空即未收录', () => {
  it('非空时间戳 → true', () => {
    expect(isNotIndexed('2026-08-01T00:00:00Z')).toBe(true)
  })
  it('null / undefined / 空串 → false', () => {
    expect(isNotIndexed(null)).toBe(false)
    expect(isNotIndexed(undefined)).toBe(false)
    expect(isNotIndexed('')).toBe(false)
  })
})

const NOW = new Date('2026-09-26T00:00:00Z')

const row = (
  index_verdict: string | null,
  over: Partial<NotIndexedClassInput> = {},
): NotIndexedClassInput => ({
  index_verdict,
  word_count: 800,
  crawl_status: 'crawled',
  crawled_at: '2026-09-20T00:00:00Z',
  ...over,
})

describe('classifyNotIndexed — 顺着谷歌给的原因分类', () => {
  it.each<[string, string | null, Partial<NotIndexedClassInput>, IndexClass]>([
    // unknown
    ['unknown 原文', UNKNOWN_TO_GOOGLE, {}, 'unknown'],
    ['unknown 带首尾空格', '  URL is unknown to Google ', {}, 'unknown'],
    ['unknown 即使字数很少也优先', UNKNOWN_TO_GOOGLE, { word_count: 50 }, 'unknown'],

    // discovered
    ['discovered', 'Discovered - currently not indexed', {}, 'discovered'],
    ['discovered（en dash）', 'Discovered – currently not indexed', {}, 'discovered'],
    ['🔴 回归：discovered 字数 299 仍是 discovered（旧行为会判 thin）', 'Discovered - currently not indexed', { word_count: 299 }, 'discovered'],

    // crawled / thin
    ['crawled 字数 120 → thin', 'Crawled - currently not indexed', { word_count: 120 }, 'thin'],
    ['crawled 但被防火墙挡 → crawled', 'Crawled - currently not indexed', { word_count: 120, crawl_status: 'antibot_challenged' }, 'crawled'],
    ['crawled 但 crawl_status 为 null → crawled', 'Crawled - currently not indexed', { word_count: 120, crawl_status: null }, 'crawled'],
    ['crawled 但爬取 25 天前 → crawled', 'Crawled - currently not indexed', { word_count: 120, crawled_at: '2026-09-01T00:00:00Z' }, 'crawled'],
    ['crawled 但 crawled_at 为 null → crawled', 'Crawled - currently not indexed', { word_count: 120, crawled_at: null }, 'crawled'],
    ['crawled 但 crawled_at 非法 → crawled', 'Crawled - currently not indexed', { word_count: 120, crawled_at: 'not-a-date' }, 'crawled'],
    ['crawled 但字数为 null → crawled', 'Crawled - currently not indexed', { word_count: null }, 'crawled'],
    ['字数恰好等于阈值 → crawled', 'Crawled - currently not indexed', { word_count: THIN_WORD_COUNT_THRESHOLD }, 'crawled'],
    ['字数阈值下一位 → thin', 'Crawled - currently not indexed', { word_count: THIN_WORD_COUNT_THRESHOLD - 1 }, 'thin'],

    // noindex
    ['noindex（弯引号）', 'Excluded by ‘noindex’ tag', {}, 'noindex'],
    ['noindex（直引号）', "Excluded by 'noindex' tag", {}, 'noindex'],
    ['noindex submitted', 'Submitted URL marked ‘noindex’', {}, 'noindex'],
    ['noindex url marked', 'URL marked ‘noindex’', {}, 'noindex'],

    // duplicate
    ['duplicate without canonical', 'Duplicate without user-selected canonical', {}, 'duplicate'],
    ['duplicate google chose', 'Duplicate, Google chose different canonical than user', {}, 'duplicate'],
    ['duplicate not selected', 'Duplicate, submitted URL not selected as canonical', {}, 'duplicate'],

    // not_a_problem
    ['alternate page', 'Alternate page with proper canonical tag', {}, 'not_a_problem'],
    ['page with redirect', 'Page with redirect', {}, 'not_a_problem'],

    // error
    ['redirect error', 'Redirect error', {}, 'error'],
    ['404', 'Not found (404)', {}, 'error'],
    ['submitted 404', 'Submitted URL not found (404)', {}, 'error'],
    ['soft 404', 'Soft 404', {}, 'error'],
    ['submitted soft 404', 'Submitted URL seems to be a Soft 404', {}, 'error'],
    ['5xx', 'Server error (5xx)', {}, 'error'],
    ['blocked by robots', 'Blocked by robots.txt', {}, 'error'],
    ['submitted blocked by robots', 'Submitted URL blocked by robots.txt', {}, 'error'],
    ['401', 'Blocked due to unauthorized request (401)', {}, 'error'],
    ['403', 'Blocked due to access forbidden (403)', {}, 'error'],
    ['other 4xx', 'Blocked due to other 4xx issue', {}, 'error'],
    ['crawl anomaly', 'Crawl anomaly', {}, 'error'],
    ['crawl issue', 'Submitted URL has crawl issue', {}, 'error'],

    // other
    ['page removal tool', 'Blocked by page removal tool', {}, 'other'],
    ['少见原因', 'Something new from Google', {}, 'other'],

    // no_verdict
    ['ME 自己的 UNKNOWN 兜底', 'UNKNOWN', {}, 'no_verdict'],
    ['null', null, {}, 'no_verdict'],
    ['空串', '', {}, 'no_verdict'],
  ])('%s', (_name, verdict, over, expected) => {
    expect(classifyNotIndexed(row(verdict, over), NOW)).toBe(expected)
  })
})

describe('INDEX_CLASS_META — 每个分类都有非空文案', () => {
  const classes: IndexClass[] = [
    'unknown',
    'discovered',
    'crawled',
    'thin',
    'noindex',
    'duplicate',
    'error',
    'not_a_problem',
    'no_verdict',
    'other',
  ]

  it.each(classes)('%s 有 label / action / hint', (cls) => {
    const meta = INDEX_CLASS_META[cls]
    expect(meta.label.length).toBeGreaterThan(0)
    expect(meta.action.length).toBeGreaterThan(0)
    expect(meta.hint.length).toBeGreaterThan(0)
  })
})

describe('isActionableNotIndexed — not_a_problem 与 no_verdict 不算待办', () => {
  it('not_a_problem / no_verdict → false', () => {
    expect(isActionableNotIndexed('not_a_problem')).toBe(false)
    expect(isActionableNotIndexed('no_verdict')).toBe(false)
  })

  it('其余 8 类 → true', () => {
    const actionable: IndexClass[] = [
      'unknown',
      'discovered',
      'crawled',
      'thin',
      'noindex',
      'duplicate',
      'error',
      'other',
    ]
    for (const cls of actionable) {
      expect(isActionableNotIndexed(cls)).toBe(true)
    }
  })
})

describe('normalizeVerdict — 归一化谷歌文本', () => {
  it('去空格、转小写、弯引号转直引号、en dash 转 -', () => {
    expect(normalizeVerdict('  Excluded by ‘noindex’ – Tag ')).toBe("excluded by 'noindex' - tag")
  })
})
