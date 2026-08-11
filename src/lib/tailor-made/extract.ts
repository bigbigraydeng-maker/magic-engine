import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClientDirect, MODEL_SONNET } from '@/lib/anthropic/client'
import type { TailorMadeItinerary } from './types'

/**
 * 自然语言 → 行程单结构化数据。
 *
 * 顾问手里通常已经有一段现成的文字（邮件、微信、Word 草稿），
 * 让他拆成逐日表单去填比直接改 Word 还慢。所以入口是一个对话框：
 * 粘贴原文一次成型，之后用人话改（「第 5 天改成杭州」「价格 6480」）。
 *
 * ⚠️ 这份文件最终会发给**终端客户**。模型只允许照抄，不允许补齐。
 * 凡是原文没写的价格 / 酒店 / 餐食 / 航班号 / 日期，一律留空并进 review，
 * 由顾问人工确认 —— 编一个不存在的酒店，比少一行信息严重得多。
 */

/** 需要人工确认的一条 */
export interface ReviewItem {
  /** 字段路径，如 'pricing.amount'、'days[4].accommodation' */
  path: string
  /** 中文人话标签，直接展示给顾问 */
  label: string
  kind: 'missing' | 'inferred' | 'ambiguous'
  /** 为什么需要人看一眼 */
  note: string
}

export interface ExtractResult {
  /** 要合并进当前行程的字段（只含需要改的部分） */
  patch: Partial<TailorMadeItinerary>
  review: ReviewItem[]
  /** 给顾问看的一句话回复 */
  reply: string
}

export type ChatTurn = { role: 'user' | 'assistant'; content: string }

/**
 * 强制 tool-use：模型必须以工具参数返回，JSON 由 API 侧保证合法。
 *
 * 起因是实测翻车 —— 让模型「只输出 JSON」时，它在 note 里写
 * 「原文只写"8 May"，未注明年份」，未转义的双引号直接把 JSON.parse 打崩。
 * 靠提示词约束转义是不可靠的，改成工具调用从机制上消掉这个失败模式。
 */
const SUBMIT_TOOL: Anthropic.Tool = {
  name: 'submit_itinerary',
  description: '提交解析后的行程单数据与待确认清单',
  input_schema: {
    type: 'object',
    properties: {
      // patch 结构随行程 schema 变化，这里不逐字段约束，由 system prompt 描述
      patch: { type: 'object', description: '要合并进当前行程的字段' },
      review: {
        type: 'array',
        description: '需要顾问人工确认的项',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: "字段路径，如 pricing.amount、days[4].accommodation" },
            label: { type: 'string', description: '中文人话标签' },
            kind: { type: 'string', enum: ['missing', 'inferred', 'ambiguous'] },
            note: { type: 'string', description: '为什么需要人确认' },
          },
          required: ['path', 'label', 'kind', 'note'],
        },
      },
      reply: { type: 'string', description: '给顾问的一句话中文回复' },
    },
    required: ['patch', 'review', 'reply'],
  },
}

const SYSTEM_PROMPT = `你是旅行社顾问的行程单助手。把顾问给的文字转成行程单的结构化数据。

必须调用 submit_itinerary 工具返回结果，不要用普通文本回复。

## 最重要的规则：不许编

这份文件会直接发给**终端客户**（真实的旅客）。编造的信息会变成对客户的承诺。

以下字段**只能从原文照抄，原文没有就留空字符串**，并在 review 里记一条 kind="missing"：
- 价格、金额（pricing.amount / pricing.optional）
- 酒店名（days[].accommodation）
- 餐食（days[].meals）
- 航班号、车次、时刻（days[].travel）
- 日期、星期（days[].date / days[].weekday）
- 客户姓名、人数（client）

**绝对不要**因为"看起来应该有"就填一个合理的值。宁可留空。

以下字段允许你基于行程内容改写润色（这是营销文案，不是事实承诺）：
- trip.summary（2–4 句概述）
- trip.highlights（亮点，每条一行）

如果你做了任何推断（哪怕很有把握），必须在 review 里记 kind="inferred" 并说明依据。

## patch 怎么给

- 只给需要改动的字段，其余不要出现
- days 只要有任何一天变动，就给**完整的 days 数组**（数组无法局部合并）
- days[].day 从 1 开始连续编号
- 行程正文（days[].body）一律输出英文 —— 这份文件是给终端客户看的，客户读英文

## 客户看到的一切都必须是英文

原文可能是中文、也可能中英夹杂。**不管原文什么语言，写进行程单的内容一律英文。**
顾问用中文给你下指令（「第 5 天加个火锅晚餐」），你也要用英文写进正文。

要翻译成英文的：trip.title / trip.summary / trip.highlights /
days[].title / days[].body / days[].route / days[].meals / inclusions / exclusions / terms。

**照抄、不翻译**的（翻译等于改事实）：
- 酒店名、航班号、车次、订位号、价格数字
- 客人姓名
- 已经是英文的专有名词

中文地名用通行英文写法：北京 Beijing、西安 Xi'an、重庆 Chongqing、上海 Shanghai、
兵马俑 Terracotta Warriors、故宫 Forbidden City、长城 Great Wall。
没把握怎么译的专有名词，保留原文并在 review 里记一条 kind="inferred"。

（例外：review[].label 和 reply 是给**顾问**看的，继续用中文。）
- days[].route 是当天的城市，或跨城时写 "Beijing → Xi'an"

## trip.route —— 最容易搞错的一个字段

trip.route 是**目的地国家里实际停留过夜的城市**，按行程先后顺序、去重。

它不是航段，也不是逐日路线的拼接。一份从新西兰出发的中国行程，
第 1 天写的是「Wellington to Auckland to Shanghai」——
Wellington 和 Auckland 是**出发地和中转机场**，绝不能进 trip.route。

  正确：["Beijing", "Xi'an", "Chongqing", "Shanghai"]
  错误：["Auckland"]、["Wellington","Auckland","Beijing",...]

判断标准：客人在那里住过至少一晚、或安排了游览，才算一站。
只是转机、只是从那里起飞，不算。

这个字段同时决定封面图和行程单第 2 页的城市线 —— 填成出发地，
封面就会选错城市。

## review 怎么写

- label 用中文，是给顾问看的人话，例如「第 9 天的酒店」「每人价格」
- 只列真正需要人确认的：缺失的关键信息、你的推断、原文自相矛盾之处
- 原文写得清清楚楚、你照抄的字段，不要列进来 —— 清单太长顾问就不看了

## reply

一句中文，说明你做了什么、还缺什么。例如：
「已按原文填入 20 天行程。价格和第 19 天的酒店原文没写，我留空了，请补。」`

/** 规整工具返回的参数 */
function normalise(parsed: unknown): ExtractResult {
  const obj = (parsed ?? {}) as Partial<ExtractResult>
  return {
    patch: (obj.patch && typeof obj.patch === 'object' ? obj.patch : {}) as Partial<TailorMadeItinerary>,
    review: Array.isArray(obj.review) ? obj.review.filter(isReviewItem) : [],
    reply: typeof obj.reply === 'string' && obj.reply.trim() ? obj.reply.trim() : '已更新行程。',
  }
}

function isReviewItem(x: unknown): x is ReviewItem {
  const r = x as ReviewItem
  return Boolean(r && typeof r.path === 'string' && typeof r.label === 'string')
}

export async function extractItinerary(params: {
  /** 顾问这次说的话（粘贴的原文，或修改指令） */
  message: string
  /** 当前行程，让模型知道在改什么 */
  current: TailorMadeItinerary
  /** 最近几轮对话，让「再把第 5 天改一下」这类指代能生效 */
  history?: ChatTurn[]
}): Promise<ExtractResult> {
  const { message, current, history = [] } = params

  // 当前行程整体塞进去太占 token，且模型只需要知道结构与已填内容
  const currentSummary = JSON.stringify(
    {
      trip: current.trip,
      client: current.client,
      days: current.days,
      pricing: current.pricing,
      inclusions: current.inclusions,
      exclusions: current.exclusions,
      notes: current.notes,
    },
    null,
    1
  )

  const userContent = `## 当前行程单内容（JSON）

${currentSummary}

## 顾问这次说的

${message}`

  const body: Anthropic.MessageCreateParamsNonStreaming = {
    model: MODEL_SONNET,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [...history.slice(-6), { role: 'user', content: userContent }],
    tools: [SUBMIT_TOOL],
    // 强制走工具，模型没有「改用纯文本回复」这个逃生口
    tool_choice: { type: 'tool', name: SUBMIT_TOOL.name },
  }

  // 直连 Anthropic，不经 CF AI Gateway：20 天行程 + max_tokens 8192 常跑
  // 60-120s，超过网关 ~60s 超时会返回 HTML 524（浏览器端看到的就是
  // "Unexpected token '<'" JSON 解析错误）。与 #364 Marketing Plan 同根同解。
  let response: Anthropic.Message
  try {
    response = await getAnthropicClientDirect().messages.create(body)
  } catch (sdkErr) {
    // 与 lib/anthropic/client.ts 同样的兜底：0.32.1 的 SDK 在 Node 24 上
    // 偶发 "Premature close"，同请求裸 fetch 是通的
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw sdkErr
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`)
    response = (await res.json()) as Anthropic.Message
  }

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === SUBMIT_TOOL.name
  )
  if (!toolUse) throw new Error('模型没有返回结构化结果')

  return normalise(toolUse.input)
}

/**
 * 把 patch 合并进当前行程。
 * 对象递归合并，数组整体替换（days / highlights 这类局部合并没有意义且容易错位）。
 */
/**
 * 出发地 / 中转地 —— 不算行程的一站。
 *
 * CTS 的客人都从新西兰出发，行程第一天必然是「某地 → 奥克兰 → 中国某地」。
 * 澳洲城市一并列入：跨塔斯曼中转很常见。
 */
const ORIGIN_CITIES = [
  'auckland', 'wellington', 'christchurch', 'queenstown', 'dunedin', 'hamilton',
  'sydney', 'melbourne', 'brisbane', 'perth', 'adelaide',
  '奥克兰', '惠灵顿', '基督城', '皇后镇', '悉尼', '墨尔本', '布里斯班',
]

function isOriginCity(stop: string): boolean {
  const s = stop.trim().toLowerCase()
  if (!s) return true
  return ORIGIN_CITIES.some((c) => s === c || s.includes(c))
}

export function applyPatch(
  current: TailorMadeItinerary,
  patch: Partial<TailorMadeItinerary>
): TailorMadeItinerary {
  const merge = (base: unknown, incoming: unknown): unknown => {
    if (Array.isArray(incoming)) return incoming
    if (incoming && typeof incoming === 'object' && base && typeof base === 'object' && !Array.isArray(base)) {
      const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
      for (const [k, v] of Object.entries(incoming as Record<string, unknown>)) {
        out[k] = merge((base as Record<string, unknown>)[k], v)
      }
      return out
    }
    return incoming === undefined ? base : incoming
  }

  const merged = merge(current, patch) as TailorMadeItinerary

  // 兜底：把出发地/中转地从 trip.route 里剔掉。
  //
  // prompt 已经写清楚了，但模型仍会偶尔把第 1 天的「Wellington to Auckland
  // to Shanghai」整段当成路线 —— 实测 CTS-2026-0008 就只识别出 ["Auckland"]，
  // 连带封面选图也跟着错。route 错了下游全错，值得在代码里再挡一层。
  if (Array.isArray(merged.trip?.route)) {
    const cleaned = merged.trip.route.filter((stop) => !isOriginCity(stop))
    // 全被过滤掉说明模型只给了出发地 —— 与其留一个错的，不如留空，
    // 让封面走兜底、城市线不显示，也好过印出「Auckland」误导客人。
    merged.trip.route = cleaned
  }

  // day 编号以数组顺序为准，避免模型给出跳号
  merged.days = (merged.days ?? []).map((d, i) => ({ ...d, day: i + 1 }))
  return merged
}
