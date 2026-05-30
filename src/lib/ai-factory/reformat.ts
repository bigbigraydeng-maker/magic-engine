/**
 * P21.3 — 多平台 reformat 引擎
 *
 * reformatForPlatform():
 *   把已有内容从 sourcePlatform 格式 → targetPlatform 格式。
 *   不从头生成，不需要加载 L3 记忆（记忆已烘焙在原始内容里）。
 *   直接用 Haiku（production 档）做格式适配，省 token。
 */

import { getAnthropicClient } from '@/lib/anthropic/client'
import { routeModel, calcCost } from '@/lib/ai/model-router'
import type { SupportedPlatform } from './types'
import type { MasterBrief } from '@/types/magic-engine'

const MAX_TOKENS = 600

// ── Platform reformat guide ───────────────────────────────────────────────────

const PLATFORM_REFORMAT_GUIDE: Record<SupportedPlatform, string> = {
  facebook:  'Facebook AU/NZ. 150–400 chars, conversational, CTA, 5-8 hashtags.',
  instagram: 'Instagram. Hook → value → CTA. 300–500 chars. 10-15 hashtags.',
  linkedin:  'LinkedIn. Professional tone. 200–600 chars. 3-5 hashtags. No emojis in body.',
  tiktok:    'TikTok script. Hook (3 s) → 60-s body → outro. Use line breaks. Trending hashtags.',
  google:    'Google Ads. Headline ≤30 chars. Description ≤90 chars. No superlatives.',
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReformatInput {
  sourceContent: string
  sourcePlatform: SupportedPlatform
  targetPlatform: SupportedPlatform
  masterBrief?: MasterBrief | null
  fdeNote?: string
}

export interface ReformatResult {
  sourceContent: string
  sourcePlatform: SupportedPlatform
  targetPlatform: SupportedPlatform
  reformattedContent: string
  hashtags: string[]
  modelUsed: string
  inputTokens: number
  outputTokens: number
  costUsd: number
}

// ── Main ──────────────────────────────────────────────────────────────────────

export async function reformatForPlatform(
  input: ReformatInput,
): Promise<ReformatResult> {
  const { model } = routeModel('production')
  const anthropic  = getAnthropicClient()

  const systemPrompt = buildSystem(input)
  const userPrompt   = buildUser(input)

  const message = await anthropic.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const rawText   = extractText(message.content)
  const parsed    = parseResponse(rawText)
  const inputTok  = message.usage.input_tokens
  const outputTok = message.usage.output_tokens

  return {
    sourceContent:      input.sourceContent,
    sourcePlatform:     input.sourcePlatform,
    targetPlatform:     input.targetPlatform,
    reformattedContent: parsed.reformattedContent,
    hashtags:           parsed.hashtags,
    modelUsed:          model,
    inputTokens:        inputTok,
    outputTokens:       outputTok,
    costUsd:            calcCost('production', inputTok, outputTok),
  }
}

// ── Prompt builders ───────────────────────────────────────────────────────────

function buildSystem(input: ReformatInput): string {
  const lines = [
    'You are a content reformatter for Australian and New Zealand businesses.',
    `Source platform: ${input.sourcePlatform} — ${PLATFORM_REFORMAT_GUIDE[input.sourcePlatform]}`,
    `Target platform: ${input.targetPlatform} — ${PLATFORM_REFORMAT_GUIDE[input.targetPlatform]}`,
    '',
    "Reformat the given content to fit the target platform's style, length, and hashtag conventions.",
    'Preserve the core message and brand voice. Use AU/NZ English spelling.',
  ]

  const brand = input.masterBrief?.brand_name
  if (brand) lines.push(`Brand: ${brand}`)

  lines.push(
    '',
    'Return JSON: {"reformattedContent":"...","hashtags":["..."]}',
  )

  return lines.join('\n')
}

function buildUser(input: ReformatInput): string {
  const lines = ['Original content to reformat:', input.sourceContent]

  if (input.fdeNote) {
    lines.push('', `Additional instruction: ${input.fdeNote}`)
  }

  return lines.join('\n')
}

// ── Response parsing ──────────────────────────────────────────────────────────

interface ParsedResponse {
  reformattedContent: string
  hashtags: string[]
}

function parseResponse(raw: string): ParsedResponse {
  try {
    const match = raw.match(/\{[\s\S]*"reformattedContent"[\s\S]*\}/)
    if (match) {
      const parsed = JSON.parse(match[0]) as {
        reformattedContent?: string
        hashtags?: unknown[]
      }
      return {
        reformattedContent: String(parsed.reformattedContent ?? raw).trim(),
        hashtags: Array.isArray(parsed.hashtags)
          ? parsed.hashtags.map(String)
          : [],
      }
    }
  } catch { /* fall through to graceful degradation */ }

  return { reformattedContent: raw.trim(), hashtags: [] }
}

function extractText(content: { type: string; text?: string }[]): string {
  return content
    .filter(b => b.type === 'text' && b.text)
    .map(b => b.text!)
    .join('')
}
