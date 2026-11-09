import type { MarketIntelSourceConfig } from './types'

/**
 * 设计文档 §5（2026-08-20 实测，全部返回真实 RSS）—— 每个 URL 逐个用 curl
 * 验证过返回的是真 RSS（不是 HTML SPA 页面伪装成的假 feed），已知死链见文档，
 * 没有列进这里。
 *
 * Hacker News（Algolia API）在设计文档里标注为"交叉验证用"，是关键词查询接口
 * 不是标准 RSS，需要独立于本模块的抓取逻辑，Phase 1 先不接，留给后续版本。
 */
export const MARKET_INTEL_SOURCES: MarketIntelSourceConfig[] = [
  {
    name: 'TechCrunch AI',
    feedUrl: 'https://techcrunch.com/category/artificial-intelligence/feed/',
    categories: ['ai_startup'],
  },
  {
    name: 'VentureBeat AI',
    feedUrl: 'https://venturebeat.com/category/ai/feed/',
    categories: ['ai_startup', 'llm_news'],
  },
  // Search Engine Land（https://searchengineland.com/feed）—— 2026-09-03 停用。
  // 自 2026-08-20 上线起 16/16 次抓取全部 HTTP 403、last_success_at 始终为 null：
  // 生产出口 IP 被站点反爬 WAF 硬拦，不是 feed_url 写错（403 ≠ 404，换 URL 无解），
  // 换 UA 也无法在本环境验证。它的 marketing + Google Ads/SEM 话题已被 Search Engine
  // Journal / SEJ · PPC / Marketing Dive 冗余覆盖，故先在 DB 里 enabled=false 关掉，
  // 停止每日假警报。留在这里而不删除，是为了记录原因、日后找到可抓取方式（如换等价源，
  // 参照下方 MenaBytes→Campaign Middle East 的处理）时能一眼看到并恢复。
  // 恢复方式：确认可抓取后，UPDATE market_intel_sources SET enabled=true WHERE feed_url=...
  // {
  //   name: 'Search Engine Land',
  //   feedUrl: 'https://searchengineland.com/feed',
  //   categories: ['marketing', 'google_ads'],
  // },
  {
    name: 'Search Engine Journal',
    feedUrl: 'https://www.searchenginejournal.com/feed/',
    categories: ['marketing'],
  },
  {
    name: 'SEJ · PPC',
    feedUrl: 'https://www.searchenginejournal.com/category/pay-per-click/feed/',
    categories: ['google_ads', 'meta_ads'],
  },
  {
    name: 'Marketing Dive',
    feedUrl: 'https://www.marketingdive.com/feeds/news/',
    categories: ['marketing'],
  },
  {
    name: 'AdExchanger',
    feedUrl: 'https://www.adexchanger.com/feed/',
    categories: ['meta_ads', 'google_ads', 'tiktok_ads'],
  },
  {
    name: 'Digiday',
    feedUrl: 'https://digiday.com/feed/',
    categories: ['marketing', 'tiktok_ads'],
  },
  {
    name: 'Social Media Today',
    // 注意不是 /rss.xml、/rss/ ——两个都 404，正确路径是 /feeds/news/。
    feedUrl: 'https://www.socialmediatoday.com/feeds/news/',
    categories: ['meta_ads', 'tiktok_ads'],
  },
  {
    name: 'HubSpot Marketing Blog',
    feedUrl: 'https://blog.hubspot.com/marketing/rss.xml',
    categories: ['marketing'],
  },
  {
    name: 'PPC.org',
    feedUrl: 'https://ppc.org/feed/',
    categories: ['google_ads', 'meta_ads'],
  },
  {
    name: 'OpenAI News',
    feedUrl: 'https://openai.com/news/rss.xml',
    categories: ['llm_news', 'ai_startup'],
  },

  // -------------------------------------------------------------------------
  // 2026-08-21 补充（PM 反馈第一天 4 条太窄）：大模型专项 / ChatGPT 广告 /
  // 中国企业出海 / 区域营销，逐条用 WebFetch 实测验证过是真实可解析的 RSS。
  //
  // 大模型专项 + 出海 + ChatGPT 广告这三类没有现成的垂直媒体信源，用 Google
  // News 的公开 RSS 搜索接口（`news.google.com/rss/search?q=...`）按主题查询
  // 代替——查询本身就是过滤条件，属于"来源即数"（同 ai_startup / marketing）。
  // 已知限制：
  //   1. Google News RSS 的 <link> 是跳转链接，不是原文直链，用户点开会多一次
  //      Google 中转（不影响事实核对——grounding 检查用的是 contentSnippet，
  //      不依赖这个链接）。
  //   2. 裸关键词查询会混进不相关内容（比如 "Grok" 裸查会混进大量诉讼/儿童
  //      安全类新闻）——已通过关键词组合 + 排除词验证过干净，不能再简化查询。
  // -------------------------------------------------------------------------
  {
    name: 'Google News · xAI/Grok',
    feedUrl:
      'https://news.google.com/rss/search?q=%22xAI%22+OR+%22Grok%22+(model+OR+update+OR+feature+OR+release+OR+launch)+-lawsuit+-abuse+-arrest+when:3d&hl=en-US&gl=US&ceid=US:en',
    categories: ['llm_news'],
  },
  {
    name: 'Google News · DeepSeek',
    feedUrl: 'https://news.google.com/rss/search?q=%22DeepSeek%22+AI+model+when:7d&hl=en-US&gl=US&ceid=US:en',
    categories: ['llm_news'],
  },
  {
    name: 'Google News · Anthropic/Claude',
    feedUrl:
      'https://news.google.com/rss/search?q=%22Anthropic%22+Claude+(model+OR+update+OR+feature+OR+release)+when:7d&hl=en-US&gl=US&ceid=US:en',
    categories: ['llm_news'],
  },
  {
    name: 'Google News · ChatGPT Ads',
    feedUrl: 'https://news.google.com/rss/search?q=%22ChatGPT%22+(ads+OR+advertising)+when:14d&hl=en-US&gl=US&ceid=US:en',
    categories: ['chatgpt_ads'],
  },
  {
    name: 'Google News · 中国企业出海',
    feedUrl:
      'https://news.google.com/rss/search?q=%22China%22+(%22going+global%22+OR+%22%E5%87%BA%E6%B5%B7%22+OR+%22overseas+expansion%22)+business+when:14d&hl=en-US&gl=US&ceid=US:en',
    categories: ['china_outbound'],
  },

  // 区域数字营销——折进已有的 marketing 分类（不单开分类），理由见设计文档
  // 附录：北美已经是现有 8 个信源的默认底色，不用再开专门信源。中东本来
  // 先选了 MenaBytes，但那是泛 MENA 创投媒体（内容全是融资新闻，不是营销），
  // 且用生产同款 UA 实测直接 403（WebFetch 工具能读不代表代码抓得到，两者
  // 走的不是同一请求路径）——换成 Campaign Middle East，真正的中东广告营销
  // 行业媒体，内容对口。
  {
    name: 'Mumbrella（澳新）',
    feedUrl: 'https://mumbrella.com.au/feed',
    categories: ['marketing'],
  },
  {
    name: 'Marketing-Interactive（东南亚/APAC）',
    feedUrl: 'https://www.marketing-interactive.com/rss-feed',
    categories: ['marketing'],
  },
  {
    name: 'Campaign Middle East（中东）',
    feedUrl: 'https://www.campaignme.com/feed/',
    categories: ['marketing'],
  },
]
