import type { CandidateItem, SummarizedItem } from './types'
import { checkGrounding } from './grounding'

const MODEL = process.env.MARKET_INTEL_MODEL ?? 'gpt-4o-mini'

const SUMMARY_SYSTEM_PROMPT = `你是 Magic Engine 内部资讯简报的摘要助手。
只根据用户提供的原文标题和摘要做翻译和压缩，绝不允许添加原文里没有的信息、数字、公司名或产品名。
用中文给出一句不超过 20 字的标题（headline_zh）和一到两句、不超过 80 字的摘要（summary_zh）。
只输出 JSON，格式严格为 {"headline_zh": "...", "summary_zh": "..."}，不要输出任何其他文字或代码块标记。`

interface SummaryResponse {
  headline_zh: string
  summary_zh: string
}

function parseSummaryResponse(text: string): SummaryResponse | null {
  try {
    // 有些模型偶尔会把 JSON 包在 ```json ... ``` 里，先剥掉再解析。
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
    const parsed = JSON.parse(cleaned)
    if (typeof parsed.headline_zh === 'string' && typeof parsed.summary_zh === 'string') {
      return parsed
    }
    return null
  } catch {
    return null
  }
}

/**
 * 摘要一条候选资讯，并立即过 §二约束第 4 条的自动核对（checkGrounding）。
 * 解析失败或核对不通过的条目仍然返回，但 groundingCheck 标记为 'failed'——
 * 调用方（pipeline）负责把这类条目挡在邮件外，只落库供人工翻查。
 */
export async function summarizeItem(candidate: CandidateItem): Promise<SummarizedItem> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not configured — cannot summarize market intel items')
  }

  // 走统一封装（而不是自己 new）—— 账户级失效（余额耗尽 / 钥匙失效）
  // 的识别与落库都装在那一层，是全站唯一能一次盖住所有调用点的位置。
  // bypassGateway：这条链路用的是 responses API，从没经过 CF 网关验证过，
  // 只拿拦截、不换路由（见 openai-client.ts 的 OpenAIClientOptions）。
  const { getOpenAIClient } = await import('@/lib/ai/openai-client')
  const client = getOpenAIClient({ apiKey, bypassGateway: true })

  const res = await client.responses.create({
    model: MODEL,
    input: [
      { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
      { role: 'user', content: `标题：${candidate.title}\n摘要：${candidate.rawExcerpt || '（无摘要正文，仅有标题）'}` },
    ],
  })

  const text = (res as { output_text?: string }).output_text ?? ''
  const parsed = parseSummaryResponse(text)

  if (!parsed) {
    return {
      ...candidate,
      headlineZh: candidate.title,
      summaryZh: '（摘要生成失败，保留原文标题）',
      groundingCheck: 'failed',
    }
  }

  const grounding = checkGrounding(parsed.summary_zh, candidate.rawExcerpt || candidate.title)

  return {
    ...candidate,
    headlineZh: parsed.headline_zh,
    summaryZh: parsed.summary_zh,
    groundingCheck: grounding.passed ? 'passed' : 'failed',
  }
}

const NOTE_SYSTEM_PROMPT = `你是 Magic Engine 内部资讯简报的编辑。
根据用户给出的今日入选资讯标题列表，写一句不超过 40 字的编者按，中文。
只能评论已给出的条目，不能引入新信息、不能编造任何数字或事实，不要寒暄，不要输出除这句话以外的任何文字。`

/** 只传入已通过 grounding 核对的条目——编者按的事实基础必须是"已验证" */
export async function generateDailyNote(passedItems: SummarizedItem[]): Promise<string | null> {
  if (passedItems.length === 0) return null

  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  // 走统一封装（而不是自己 new）—— 账户级失效（余额耗尽 / 钥匙失效）
  // 的识别与落库都装在那一层，是全站唯一能一次盖住所有调用点的位置。
  // bypassGateway：这条链路用的是 responses API，从没经过 CF 网关验证过，
  // 只拿拦截、不换路由（见 openai-client.ts 的 OpenAIClientOptions）。
  const { getOpenAIClient } = await import('@/lib/ai/openai-client')
  const client = getOpenAIClient({ apiKey, bypassGateway: true })

  const list = passedItems.map((item) => `- ${item.headlineZh}`).join('\n')

  const res = await client.responses.create({
    model: MODEL,
    input: [
      { role: 'system', content: NOTE_SYSTEM_PROMPT },
      { role: 'user', content: `今天的资讯列表：\n${list}` },
    ],
  })

  const note = ((res as { output_text?: string }).output_text ?? '').trim()
  return note.length > 0 ? note : null
}
