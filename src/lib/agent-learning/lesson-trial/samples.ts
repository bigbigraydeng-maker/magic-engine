/** 固定、虚构的脱敏样例；不读任何真实客户或真实网站数据。 */
import type { TrialSampleId } from './eligibility'

export const SAMPLE_NOTE = '示例数据，虚构；这是初筛，不是效果证明；模型有随机性，可再试一次。'

export const SAMPLES: Record<TrialSampleId, { title: string; task: string; data: string }> = {
  seo: {
    title: '示例站点（SEO）',
    task: '为这个站点提出 3 条最值得先做的 SEO 改进建议。',
    data: [
      '示例客户 A：一家虚构的新西兰户外装备在线商店。',
      '首页是单页应用，纯 HTML 里正文约 40 个字，商品列表靠 JavaScript 加载。',
      '没有 JSON-LD 结构化数据；有 sitemap.xml；robots.txt 允许所有爬虫。',
      '近 3 个月自然搜索流量下降 18%，Search Console 显示"已发现-尚未索引"的页面在增加。',
    ].join('\n'),
  },
  ads: {
    title: '示例客户 A（Meta 广告）',
    task: '为这个广告账户提出 3 条最值得先做的优化建议。',
    data: [
      '示例客户 A：一家虚构的新西兰户外装备在线商店，Meta 转化广告。',
      '近 14 天：花费 NZD 1,400，展示 210,000，点击 2,900，购买 31，ROAS 1.9。',
      '3 个广告系列；其中一个系列频次 4.6、CPM 上升 35%，另两个频次约 1.8。',
      '素材以静态产品图为主，只有 1 条短视频；受众为 25–54 岁新西兰人群。',
    ].join('\n'),
  },
}
