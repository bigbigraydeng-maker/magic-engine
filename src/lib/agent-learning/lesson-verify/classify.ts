/**
 * 按经验文字自动归类到验证方式（纯关键词规则，不调模型）。
 * 归错了可以改规则；默认不需要任何人点选。
 */
export type VerifyKind = 'html_visible' | 'structured_data' | 'ad_experiment' | 'none'

const STRUCTURED_RE = /schema(\.org)?|structured\s*data|json-?ld|结构化数据|结构化标记|富摘要|rich\s*result/i
const HTML_RE = /\bhtml\b|javascript|\bjs\b|server[-\s]?side|\bssr\b|client[-\s]?side|渲染|render|crawl|爬虫|抓取|可见/i
const AD_RE = /\bads?\b|广告|meta|facebook|tiktok|google\s*ads|\bsem\b|\bcpm\b|\bcpa\b|\bcpc\b|\bctr\b|\broas\b|预算|出价|受众|素材|投放|campaign|creative|audience|bid|budget/i

/** 结构化数据优先于 HTML（"schema 要放在服务端渲染的 HTML 里"属于结构化数据）。 */
export function classifyLesson(lesson: string, rationale?: string | null): VerifyKind {
  const text = `${lesson} ${rationale ?? ''}`
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
