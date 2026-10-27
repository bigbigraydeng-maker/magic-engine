/**
 * 按经验文字自动归类到验证方式（纯关键词规则，不调模型）。
 * 归错了可以改规则；默认不需要任何人点选。
 */
export type VerifyKind = 'html_visible' | 'structured_data' | 'ad_experiment' | 'none'

const STRUCTURED_RE = /schema(\.org)?|structured\s*data|json-?ld|结构化数据|结构化标记|富摘要|rich\s*result/i
// 只收"正文是否在纯 HTML 里 / 是否靠 JavaScript 渲染"这类检查器真能判断的说法；
// crawl / 爬虫 / 抓取 / 可见 过宽（robots.txt、sitemap 建议不是它能判断的），不收。
const HTML_RE = /(raw|plain|static|initial|纯|原始)\s*html|javascript|server[-\s]?side\s+render|client[-\s]?side\s+render|\bssr\b|服务端渲染|客户端渲染|不靠\s*js/i
// 只收明确的付费广告说法；裸 meta（meta description）、audience、creative、素材 过宽，不收。
const AD_RE = /\bads?\b|广告|meta\s+(ads?|campaigns?)|facebook\s+ads?|tiktok\s+ads?|google\s+ads|\bsem\b|\bcpm\b|\bcpa\b|\bcpc\b|\bctr\b|\broas\b|预算|出价|投放|\bcampaigns?\b|\bbidding\b|\bad\s+budget\b|\bbudget\b/i
/** 这些是站点配置类建议，检查器判断不了，直接落到"暂无自动检查"。 */
const UNSUPPORTED_RE = /robots\.txt|sitemap|llms\.txt|gptbot|allow\s+crawl|meta\s+descriptions?|title\s+tags?/i

/** 结构化数据优先于 HTML（"schema 要放在服务端渲染的 HTML 里"属于结构化数据）。 */
export function classifyLesson(lesson: string, rationale?: string | null): VerifyKind {
  const text = `${lesson} ${rationale ?? ''}`
  if (UNSUPPORTED_RE.test(text) && !STRUCTURED_RE.test(text)) return 'none'
  if (STRUCTURED_RE.test(text)) return 'structured_data'
  if (HTML_RE.test(text)) return 'html_visible'
  if (AD_RE.test(text)) return 'ad_experiment'
  return 'none'
}

export const VERIFY_LAYER_LABEL: Record<VerifyKind, string> = {
  html_visible: '第 1 层 · 只读检查（纯 HTML 正文）',
  structured_data: '第 1 层 · 只读检查（结构化数据）',
  ad_experiment: '第 3 层 · 建议实验（需 Ray 审批）',
  none: '未验证 · 暂无自动检查',
}
