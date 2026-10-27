/**
 * 固定样例：全部虚构、已脱敏，不读任何真实客户数据。
 * 广告类用"示例客户 A"的虚构广告数据；SEO 类用一份固定的"我们自己的站"首页摘要常量。
 */
import type { TrialSampleKind } from './eligible'

export const AD_SAMPLE = `示例客户 A（虚构）：新西兰一家本地服务公司，Meta 广告近 14 天数据。
- 广告系列 1「线索表单」：日预算 NZ$40，花费 NZ$560，曝光 61,000，点击 640，线索 18，频次 3.4，CPM NZ$9.2，CTR 1.05%
- 广告系列 2「再营销」：日预算 NZ$15，花费 NZ$210，曝光 9,800，点击 150，线索 7，频次 5.1，CPM NZ$21.4，CTR 1.53%
- 素材：3 张静态图、1 条 15 秒视频，已连续投放 12 天未更换
- 受众：奥克兰 25–55 岁，兴趣定向 + 1% 相似受众`

export const SEO_SAMPLE = `我们自己的站（虚构摘要）：一家数字营销服务公司的首页与博客。
- 首页：纯 HTML 可见正文约 260 字；服务列表由 JavaScript 渲染后才出现
- 博客：近 3 个月发布 6 篇，其中 2 篇在 Google 核心算法更新后自然流量下降约 20%
- 结构化数据：只有 Organization，博客文章没有 Article 标记
- 内链：文章之间几乎没有互相链接；作者页只有姓名，没有简介和资历`

export function sampleFor(kind: TrialSampleKind): string {
  return kind === 'seo' ? SEO_SAMPLE : AD_SAMPLE
}
