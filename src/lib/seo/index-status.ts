/**
 * 收录状态的本地判据与分类 —— 单一真相源。
 *
 * 「未收录」的权威信号是 `client_site_pages.first_not_indexed_at` 非空：
 * 每日 URL 收录轮检（`seo-patrol/index-check.ts`）在页面翻回已收录时会把它清成
 * null，所以「非空 ⟺ 当前未被谷歌收录」始终成立。
 *
 * 分类不再只看字数，而是顺着谷歌自己给的原因（`index_verdict`，即 GSC 原样回写的
 * `coverageState`）走一张有序规则表，第一条命中即定类。顺序不能改：duplicate 要排在
 * alternate 之前，redirect error 要排在 page with redirect 之前；ME 自己在 GSC 没给
 * coverageState 时写的 'UNKNOWN' 是「还没结论」，不是谷歌说「不认识这个网址」。
 *
 * `thin` 只在「我们自己爬干净了（crawl_status='crawled'）且爬取够新（≤ CRAWL_FRESH_DAYS）」
 * 时才成立 —— 被防火墙挡住 / 数据过期的行带着假字数，不能据此说人内容薄。
 * 2026-09-26 生产上某客户 46/46 行被判 thin，全是防火墙挑战页。
 *
 * `not_a_problem` 与 `no_verdict` 不是待办，不得当成要干的活报出去。
 * 本模块必须保持无服务端专用 import（有 'use client' 页面引用它）。
 */

/** 正文字数低于此值算「内容太薄」。改这里，待办和清单页同步生效。 */
export const THIN_WORD_COUNT_THRESHOLD = 300

/** 谷歌 coverageState 里「压根不认识这个网址」的原文（verbatim from GSC）。 */
export const UNKNOWN_TO_GOOGLE = 'URL is unknown to Google'

/** 我们自己的爬取数据多久算新鲜。单一真相源：pm-todo 的 CRAWL_STALE_DAYS 复用此值，判 thin 也要求爬取不超过这么久。 */
export const CRAWL_FRESH_DAYS = 14

/** 未收录页面的分类。 */
export type IndexClass =
  | 'unknown'
  | 'discovered'
  | 'crawled'
  | 'thin'
  | 'noindex'
  | 'duplicate'
  | 'error'
  | 'not_a_problem'
  | 'no_verdict'
  | 'other'

/** 分类所需的一行输入。 */
export interface NotIndexedClassInput {
  index_verdict: string | null
  word_count: number | null
  /** 我们自己爬取的结果。只有 'crawled' 才代表存下来的正文 / 字数是真实的。 */
  crawl_status: string | null
  /** 我们上次抓这个 URL 的时间（ISO 字符串）。 */
  crawled_at: string | null
}

/** 权威判据：`first_not_indexed_at` 非空 ⟺ 当前未被谷歌收录。 */
export function isNotIndexed(firstNotIndexedAt: string | null | undefined): boolean {
  return !!firstNotIndexedAt
}

/**
 * 归一化谷歌的 coverageState 文本：去首尾空格、转小写、弯引号转直引号、
 * en/em dash 转 `-`、连续空白压成一个空格。
 */
export function normalizeVerdict(raw: string | null): string {
  return (raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\s+/g, ' ')
}

/** 有序规则表：第一条命中即定类。`crawled` 那条要额外看爬取状态，单独处理。 */
const RULES: Array<{ test: (v: string) => boolean; cls: IndexClass }> = [
  { test: (v) => v === '' || v === 'unknown', cls: 'no_verdict' },
  { test: (v) => v === 'url is unknown to google', cls: 'unknown' },
  { test: (v) => v.startsWith('discovered'), cls: 'discovered' },
  { test: (v) => v.startsWith('crawled'), cls: 'crawled' },
  { test: (v) => v.includes('duplicate'), cls: 'duplicate' },
  { test: (v) => v.includes('alternate page'), cls: 'not_a_problem' },
  { test: (v) => v.includes('redirect error'), cls: 'error' },
  { test: (v) => v.includes('page with redirect'), cls: 'not_a_problem' },
  { test: (v) => v.includes('noindex'), cls: 'noindex' },
  { test: (v) => v.includes('page removal tool'), cls: 'other' },
  {
    test: (v) => /\b(404|5xx|server error|blocked|unauthorized|forbidden|4xx|crawl anomaly|crawl issue)\b/.test(v),
    cls: 'error',
  },
]

/** 爬取是否干净且够新 —— 只有这时存下来的字数才可信。 */
function hasFreshCleanCrawl(row: NotIndexedClassInput, now: Date): boolean {
  if (row.crawl_status !== 'crawled') return false
  if (!row.crawled_at) return false
  const crawledAt = new Date(row.crawled_at)
  if (Number.isNaN(crawledAt.getTime())) return false
  const ageMs = now.getTime() - crawledAt.getTime()
  return ageMs <= CRAWL_FRESH_DAYS * 24 * 60 * 60 * 1000
}

/**
 * 未收录页面的分类。顺着谷歌给的原因走有序规则表，第一条命中即定类。
 *
 * ⚠️ 只对确认未收录（isNotIndexed 为真）的行调用；已收录 / 未检查的行没有分类语义。
 */
export function classifyNotIndexed(row: NotIndexedClassInput, now: Date = new Date()): IndexClass {
  const v = normalizeVerdict(row.index_verdict)
  for (const rule of RULES) {
    if (!rule.test(v)) continue
    if (rule.cls === 'crawled') {
      const thin =
        hasFreshCleanCrawl(row, now) &&
        typeof row.word_count === 'number' &&
        row.word_count < THIN_WORD_COUNT_THRESHOLD
      return thin ? 'thin' : 'crawled'
    }
    return rule.cls
  }
  return 'other'
}

/** 每个分类的展示文案与建议动作。 */
export const INDEX_CLASS_META: Record<IndexClass, { label: string; action: string; hint: string }> = {
  unknown: {
    label: '谷歌还不认识这个网址',
    hint: '可请求收录（限量）',
    action:
      '确认它在站点地图里、有别的页面链到它；最想被搜到的几页可以去 Search Console 点「请求编入索引」（每天限量，不保证收）',
  },
  discovered: {
    label: '谷歌发现了但还没来爬',
    hint: '等谷歌来爬 · 加内链',
    action: '谷歌自己在排队，别反复点「请求编入索引」；多从别的页面链到它',
  },
  crawled: {
    label: '谷歌爬过但暂不收',
    hint: '不用重交 · 看内容和内链',
    action: '这是谷歌自己的质量判断，不用重新提交；看内容有没有独到信息、有没有页面链到它',
  },
  thin: {
    label: '谷歌爬过没收且正文可能偏薄',
    hint: '补内容 · 加内链',
    action: `正文不到 ${THIN_WORD_COUNT_THRESHOLD} 词；补有用的内容、加内链（新增内容要人点头）。电商分类页、房源列表页字数少不一定是问题`,
  },
  noindex: {
    label: '页面自己写了「别收录」',
    hint: '确认是否故意',
    action:
      '先确认是不是故意的（购物车、账户页这类本来就不该收）：要被搜到就去掉这个设置，不要就从站点地图里拿掉',
  },
  duplicate: {
    label: '谷歌判成了重复页',
    hint: '做出区别或接受',
    action: '谷歌只收了内容相同的另一页，流量在那一页上；要这一页单独被搜到就把内容做出区别，否则不用处理',
  },
  error: {
    label: '页面打不开或被挡',
    hint: '先修好',
    action: '先修好：打不开、报错、被网站设置挡住的页面谷歌收不了；报 403 常见是网站防火墙把谷歌也挡了',
  },
  not_a_problem: {
    label: '跳转页或备用页，本来就不收',
    hint: '不用处理',
    action: '这个网址会跳到别的页或者指向正本页，不用处理',
  },
  no_verdict: {
    label: '还没拿到谷歌的结论',
    hint: '等下一轮检查',
    action:
      '每天的收录检查这次没从谷歌拿到明确结论，下一轮会重查；连续多天都这样，再去 Search Console 用网址检查看',
  },
  other: {
    label: '谷歌给了少见的原因',
    hint: '去 GSC 查原因',
    action: '去 Search Console 用网址检查看具体原因',
  },
}

/** 这个分类是否算「要干的活」。`not_a_problem` 与 `no_verdict` 不算。 */
export function isActionableNotIndexed(cls: IndexClass): boolean {
  return cls !== 'not_a_problem' && cls !== 'no_verdict'
}
