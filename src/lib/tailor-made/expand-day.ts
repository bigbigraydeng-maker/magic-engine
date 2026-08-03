import type Anthropic from '@anthropic-ai/sdk'
import { getAnthropicClient, MODEL_SONNET } from '@/lib/anthropic/client'
import type { TailorMadeDay, TailorMadeItinerary } from './types'

/**
 * 把某一天的行程正文展开写细。
 *
 * 来由：源行程里一天常常只有一句「Visit Ciqikou, Liziba, Jiefangbei, Hongyadong.」
 * 客人看不出这天到底在干什么、值不值 NZD 5230。顾问想让其中某几天写细一点，
 * 但不想自己动笔。
 *
 * ⚠️ 这里跟其余抽取逻辑有一处根本区别，必须想清楚：
 * 「展开」本身就是在增加原文没有的内容 —— 否则叫展开就没有意义。
 * 所以规则不是「一律不许加」，而是**分清哪一类可以加**：
 *
 *   可以加：景点是什么、为什么值得看、在那儿会看到/体会到什么。
 *           这些是公共知识，写错了客人当场能看出来，且不构成商业承诺。
 *
 *   不许加：时间、价格、酒店、餐食、车次航班、门票是否包含、停留时长。
 *           这些是**对客户的承诺**，编出来就是虚假陈述，而且顾问校对时
 *           很难发现 —— 因为它们读起来完全合理。
 */

const SYSTEM_PROMPT = `You expand one day of a tailor-made travel itinerary into a fuller description.

The itinerary goes to a real traveller who is deciding whether to pay for this trip. Right now some days are one line ("Visit Ciqikou, Liziba, Jiefangbei, Hongyadong.") and the traveller cannot tell what the day actually holds.

Return ONLY a JSON object, no markdown fence:

{ "body": "the expanded description", "note": "one short sentence in Chinese for the consultant" }

## What you MAY add

描述性内容 — what each place is, why it is worth seeing, what the traveller will
experience there. This is public knowledge, a wrong claim is visible to the reader,
and it commits the agency to nothing.

## What you MUST NOT add — these are promises to a paying customer

- Times, durations, "morning/afternoon" unless the source already says so
- Prices, what is included or excluded
- Hotel names, meals, restaurants
- Flight numbers, train numbers, transfer arrangements
- Guarantees ("you will definitely see…", "the best…")

If the source line does not say when something happens, your expansion must not
imply a schedule either. Describing a place is safe; scheduling it is not.

## Style

- Same language as the source (usually English).
- 2–4 sentences per named place, flowing prose — not a bulleted list.
- Calm and specific. No "breathtaking", "must-see", "unforgettable".
- Keep every place named in the source, in the same order. Do not add new places.`

export interface ExpandDayResult {
  body: string
  note: string
}

export async function expandDay(params: {
  day: TailorMadeDay
  trip: TailorMadeItinerary['trip']
  /** 顾问的额外要求，如「多写美食」 */
  instruction?: string
}): Promise<ExpandDayResult> {
  const { day, trip, instruction } = params

  const source = day.body?.trim()
  if (!source) throw new Error('这一天还没有正文，先写一句再展开')

  const userContent = `## 行程背景
${trip.title || '(未命名)'} · ${trip.route?.join(' → ') || ''}

## 第 ${day.day} 天
日期：${day.date || '(未填)'}
城市/路线：${day.route || '(未填)'}

现在的正文：
${source}
${instruction ? `\n## 顾问的额外要求\n${instruction}` : ''}`

  const body: Anthropic.MessageCreateParamsNonStreaming = {
    model: MODEL_SONNET,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  }

  let response: Anthropic.Message
  try {
    response = await getAnthropicClient().messages.create(body)
  } catch (sdkErr) {
    // 与 lib/anthropic/client.ts 同样的兜底：0.32.1 SDK 在 Node 24 上偶发 premature close
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
    if (!res.ok) throw new Error(`Anthropic ${res.status}`)
    response = (await res.json()) as Anthropic.Message
  }

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text')
  let raw = (textBlock?.text ?? '').trim()
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) raw = fenced[1].trim()
  if (!raw.startsWith('{')) {
    const a = raw.indexOf('{')
    const b = raw.lastIndexOf('}')
    if (a === -1 || b <= a) throw new Error('展开结果无法读取')
    raw = raw.slice(a, b + 1)
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ExpandDayResult>
    const out = (parsed.body ?? '').trim()
    if (!out) throw new Error('empty')
    return { body: out, note: (parsed.note ?? '').trim() || '已展开，请核对后再发客户。' }
  } catch {
    throw new Error('展开结果无法读取，请重试')
  }
}
