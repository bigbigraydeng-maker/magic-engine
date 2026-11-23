import { callClaudeChat, MODEL_HAIKU, parseJsonResponse } from '@/lib/anthropic/client'

export const TOUR_LANDSCAPE_MODEL = MODEL_HAIKU
export const TOUR_LANDSCAPE_PROMPT_VERSION = 'tour-landscape-v2'

export type TourLandscape = {
  headline: string
  market_summary: string
  client_opportunities: string[]
  client_risks: string[]
  recommended_focus: string[]
  unknowns: string[]
  confidence: number
  evidence_urls: string[]
}

export type TourLandscapeExternalSignal = {
  source_type: 'industry_news' | 'industry_media'
  source_name: string
  source_url: string
  title: string
  excerpt: string
  observed_at: string
}

export type TourLandscapeTrafficSignal = {
  domain: string
  observed_at: string
  estimated_visits: number | null
  previous_estimated_visits: number | null
  visits_change_pct: number | null
  excerpt: string
}

export function formatTourLandscapeChatReply(value: string): string {
  const cleaned = value.replace(/^\s*```(?:json|JSON)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const sections: Array<[string, string]> = [['headline', '结论'], ['market_summary', '依据']]
      const lists: Array<[string, string]> = [['client_opportunities', '建议'], ['client_risks', '暂时不要做'], ['recommended_focus', '下一步'], ['unknowns', '还缺证据']]
      const output = sections.flatMap(([key, label]) => typeof parsed[key] === 'string' && parsed[key] ? [`${label}：${parsed[key]}`] : [])
      for (const [key, label] of lists) {
        const items = Array.isArray(parsed[key]) ? parsed[key].filter((item): item is string => typeof item === 'string' && Boolean(item.trim())) : []
        if (items.length) output.push(`${label}：\n${items.map(item => `- ${item}`).join('\n')}`)
      }
      if (output.length) return output.join('\n\n')
    }
  } catch {
    // Some provider responses are truncated JSON. The readable cleanup below
    // still removes the code fence and keeps the raw evidence visible.
  }
  return cleaned.replace(/^json\s*/i, '').replace(/,\s*"(market_summary|client_opportunities|client_risks|recommended_focus|unknowns)"\s*:/g, '\n\n$1：').replace(/[{}]/g, '').replace(/"/g, '').replace(/,\s*$/g, '').trim()
}

const SYSTEM = '你是旅游产品竞争情报分析师。只根据输入事实做整体市场判断，不把不同旅行社的 Tour 强行视为一一对应产品。不得编造价格、日期、城市或余位。输出严格 JSON。结论必须具体到已提供的产品、城市、天数或价格事实；如果事实不足，就明确说缺什么，不要用空泛的行业术语填充。'

export function tourLandscapePrompt(input: { client_name: string; market_scope?: string[]; client_products: unknown[]; competitor_products: unknown[]; external_signals?: TourLandscapeExternalSignal[]; traffic_signals?: TourLandscapeTrafficSignal[]; memory_context?: string }): string {
  return `请为 ${input.client_name} 做竞品产品组合总览，而不是逐团横向配对。

本次分析范围：${input.market_scope?.length ? input.market_scope.join('、') : '客户当前配置的市场范围'}。
注意：竞品资料只来自客户指定的重点监控对象和页面，不代表这些竞品的完整产品线，也不代表整个市场全貌。不要使用“市场上所有”“竞品全部产品”等表述。CTS 产品资料是当前纳入本次分析的客户产品，不要据此声称 CTS 没有其他产品。
分析重点：消费者能感知的城市覆盖、行程长度、价格带、产品定位、出发季节和包含项目；最终告诉经营负责人现在应该做什么、暂时不要做什么、下一步先确认什么。不同路线和天数可以并存，不要把它们误判成同一产品。

客户产品事实：
${JSON.stringify(input.client_products).slice(0, 12000)}

竞品产品事实：
${JSON.stringify(input.competitor_products).slice(0, 18000)}

行业与媒体证据（仅作补充，不代表整个市场）：
${input.external_signals?.length ? JSON.stringify(input.external_signals).slice(0, 9000) : '暂无与当前市场范围相关的行业媒体或行业新闻证据。'}

竞品网站流量方向（公开估算，低置信度，不代表真实访问量、订单或销售影响）：
${input.traffic_signals?.length ? JSON.stringify(input.traffic_signals).slice(0, 5000) : '暂无可用的竞品网站流量方向估算。'}

客户已确认的历史偏好与决策（只能作为背景，不能替代当前证据）：
${input.memory_context ? input.memory_context.slice(0, 5000) : '暂无已确认的客户 Memory。'}

行业与媒体只能作为补充证据：必须区分文章明确说了什么和你的推断，不得因为一篇文章就声称整个市场发生变化；如果引用行业证据，在结论或建议中写出来源名称、标题或观察日期。不要把没有来源链接或观察时间的内容当作可核实事实。
流量方向只能作为低置信度的辅助信号；没有估算值或变化百分比时不要推断流量变化，也不得据此声称竞品销售增长、客户流失或 CTS 受到影响。
输出字段：headline（不超过40字，直接说现在最重要的经营判断）、market_summary（2-4句，必须引用至少2个输入中的具体事实，例如产品数量、产品名、城市、天数或价格带，并给出明确判断；如使用行业证据，注明来源）、client_opportunities（最多4条，每条都要是“建议现在做”的具体动作，尽量点名 CTS 产品或产品层级）、client_risks（最多4条，每条都要是“暂时不要做”的具体动作或风险，并说明依据）、recommended_focus（最多4条，每条都要是下一步先确认的事项）、unknowns（最多4条，列出缺失的关键证据）、confidence（0到1）、evidence_urls（最多8个，只能填写输入资料中已有的 http/https 来源链接）。
不要输出“加强竞争力”“优化产品”“关注市场”等无法执行的空话。不要为了凑满字段而编造事实；但只要输入中有证据，就必须把证据写进结论和建议。每个数组最多3条，优先保留最影响经营决策的内容。
必须返回以上全部字段；没有证据时对应字段返回 []，不要省略字段。只返回 JSON，不要 Markdown 代码块。`
}

function cleanList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 4) : []
}

function factValues(products: unknown[], key: string): string[] {
  return products
    .map(product => {
      if (!product || typeof product !== 'object') return null
      const value = (product as Record<string, unknown>)[key]
      return typeof value === 'string' || typeof value === 'number' ? String(value) : null
    })
    .filter((value): value is string => Boolean(value))
}

function fallbackTourLandscape(input: Parameters<typeof tourLandscapePrompt>[0]): TourLandscape {
  const scope = input.market_scope?.length ? input.market_scope.join('、') : '当前监控范围'
  const clientCount = input.client_products.length
  const competitorCount = input.competitor_products.length
  const clientNames = factValues(input.client_products, 'name').slice(0, 2)
  const competitorNames = factValues(input.competitor_products, 'name').slice(0, 3)
  const competitorDurations = factValues(input.competitor_products, 'duration_days')
  const competitorPrices = factValues(input.competitor_products, 'price')
  const observedFacts = [
    clientNames.length ? `CTS样本包括${clientNames.join('、')}` : `CTS样本共${clientCount}个产品`,
    competitorNames.length ? `监控样本包括${competitorNames.join('、')}` : `重点竞品样本共${competitorCount}个`,
    competitorDurations.length ? `竞品已记录${competitorDurations.slice(0, 3).join('、')}天行程` : '',
    competitorPrices.length ? `已记录价格${competitorPrices.slice(0, 3).join('、')}` : '',
  ].filter(Boolean)
  return {
    headline: competitorCount ? `${scope}已有竞品样本，先验证再调整产品` : `${scope}目前缺少足够竞品样本`,
    market_summary: `${observedFacts.slice(0, 3).join('；')}。这些事实可以帮助判断${scope}的产品组合方向，但目前只覆盖指定监控样本，不能代表竞品完整产品线或整个市场。`,
    client_opportunities: clientCount ? [`先选定${clientNames[0] ?? '一个重点 CTS 产品'}，核对它与${competitorNames[0] ?? '竞品样本'}在城市、天数、价格和包含项目上的消费者差异。`] : [],
    client_risks: ['暂时不要仅凭当前监控样本做全线降价或改动全部产品的决定。'],
    recommended_focus: [`先确认${clientNames[0] ?? '重点产品'}的完整路线、出发日期、余位和价格包含项目，再决定是否调整。`],
    unknowns: ['竞品完整产品线、真实出发窗口、余位和询盘转化数据仍未纳入。'],
    confidence: competitorCount > 0 && clientCount > 0 ? 0.35 : 0.2,
    evidence_urls: input.competitor_products.map(product => product && typeof product === 'object' ? (product as Record<string, unknown>).source_url : null).filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url)).slice(0, 8),
  }
}

export function validateTourLandscape(value: unknown): TourLandscape {
  const parsed = typeof value === 'string' ? parseJsonResponse(value) as unknown : value
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid_tour_landscape')
  const item = parsed as Record<string, unknown>
  const confidenceValue = item.confidence ?? item.confidence_score
  const confidence = typeof confidenceValue === 'number' && Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : 0
  if (typeof item.headline !== 'string' || typeof item.market_summary !== 'string') throw new Error('invalid_tour_landscape')
  return {
    headline: item.headline.slice(0, 120),
    market_summary: item.market_summary.slice(0, 1200),
    client_opportunities: cleanList(item.client_opportunities ?? item.opportunities),
    client_risks: cleanList(item.client_risks ?? item.risks),
    recommended_focus: cleanList(item.recommended_focus ?? item.recommendations),
    unknowns: cleanList(item.unknowns ?? item.missing_evidence),
    confidence,
    evidence_urls: Array.isArray(item.evidence_urls) ? item.evidence_urls.filter((url): url is string => typeof url === 'string' && /^https?:\/\//i.test(url)).slice(0, 8) : [],
  }
}

export function ensureActionableTourLandscape(landscape: TourLandscape, input: Parameters<typeof tourLandscapePrompt>[0]): TourLandscape {
  const fallback = fallbackTourLandscape(input)
  return {
    ...landscape,
    client_opportunities: landscape.client_opportunities.length ? landscape.client_opportunities : fallback.client_opportunities,
    client_risks: landscape.client_risks.length ? landscape.client_risks : fallback.client_risks,
    recommended_focus: landscape.recommended_focus.length ? landscape.recommended_focus : fallback.recommended_focus,
    unknowns: landscape.unknowns.length ? landscape.unknowns : fallback.unknowns,
  }
}

export async function summarizeTourLandscape(input: Parameters<typeof tourLandscapePrompt>[0]) {
  // Use the shared gateway path. This keeps the aggregate call observable and
  // consistent with the other Web Intelligence AI workflows in production.
  try {
    const result = await callClaudeChat({ model: TOUR_LANDSCAPE_MODEL, systemPrompt: SYSTEM, messages: [{ role: 'user', content: tourLandscapePrompt(input) }], maxOutputTokens: 1800 })
    return { landscape: ensureActionableTourLandscape(validateTourLandscape(result.text), input), cost_usd: result.cost_usd, model: TOUR_LANDSCAPE_MODEL, prompt_version: TOUR_LANDSCAPE_PROMPT_VERSION, degraded: false }
  } catch (error) {
    console.warn('[wi-tour-landscape] AI unavailable; using evidence-bound fallback', error instanceof Error ? error.message : 'unknown_error')
    return { landscape: fallbackTourLandscape(input), cost_usd: 0, model: 'rules-fallback', prompt_version: TOUR_LANDSCAPE_PROMPT_VERSION, degraded: true }
  }
}

export async function chatAboutTourLandscape(input: {
  client_name: string
  client_products: unknown[]
  competitor_products: unknown[]
  external_signals?: TourLandscapeExternalSignal[]
  traffic_signals?: TourLandscapeTrafficSignal[]
  market_scope?: string[]
  memory_context?: string
  landscape: TourLandscape | null
  history: Array<{ role: 'user' | 'assistant'; content: string }>
  question: string
}) {
  const systemPrompt = `${SYSTEM} 你现在是一个经营决策对话助手。回答要直接、具体、少讲术语。
回答固定使用以下顺序：结论：一句话直接回答；依据：列出1-3条输入资料支持的事实；建议：给出一个下一步动作。只能使用提供的客户产品、竞品资料和当前总览；资料没有写的内容必须明确说“目前无法判断”。竞品资料是重点监控样本，不是竞品完整产品线；不要把样本结论扩大成整个市场结论。
不要把不同旅行社的 Tour 强行一一对应，不要建议自动调价、发布或执行外部动作。`
  const context = `当前总览：${JSON.stringify(input.landscape)}\n\n${tourLandscapePrompt({ client_name: input.client_name, market_scope: input.market_scope, client_products: input.client_products, competitor_products: input.competitor_products, external_signals: input.external_signals, traffic_signals: input.traffic_signals, memory_context: input.memory_context })}`
  try {
    const result = await callClaudeChat({
      model: TOUR_LANDSCAPE_MODEL,
      systemPrompt,
      messages: [...input.history.slice(-10), { role: 'user', content: `${context}\n\n用户问题：${input.question}` }],
      maxOutputTokens: 900,
    })
    return { text: result.text, cost_usd: result.cost_usd, model: TOUR_LANDSCAPE_MODEL, degraded: false }
  } catch (error) {
    console.warn('[wi-tour-landscape-chat] AI unavailable; using evidence-bound fallback', error instanceof Error ? error.message : 'unknown_error')
    const fallback = fallbackTourLandscape({ client_name: input.client_name, market_scope: input.market_scope, client_products: input.client_products, competitor_products: input.competitor_products })
    return {
      text: `结论：目前无法用 AI 进一步判断“${input.question}”。\n\n依据：当前分析范围内有 ${input.client_products.length} 个 CTS 产品和 ${input.competitor_products.length} 个重点竞品样本；这些样本不代表竞品完整产品线。\n\n建议：${fallback.recommended_focus[0] ?? '先补齐重点产品的路线、出发日期、余位和价格包含项目，再做经营调整。'}`,
      cost_usd: 0,
      model: 'rules-fallback',
      degraded: true,
    }
  }
}
