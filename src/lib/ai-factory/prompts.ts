/**
 * P21.2 — AI Factory prompt 构建器
 *
 * 职责：把 FactoryJobInput + MemoryContext 拼成 system/user prompt。
 * 记忆注入走 formatMemoryForPrompt（与张骞/华佗/鲁班共用同一 API）。
 */

import type { FactoryJobInput, ContentType, SupportedPlatform } from './types'
import { formatMemoryForPrompt } from '@/lib/memory/format'
import type { MemoryContext } from '@/lib/memory/types'

// ── Platform guidance ─────────────────────────────────────────────────────────

const PLATFORM_GUIDE: Record<SupportedPlatform, string> = {
  facebook:  'Facebook (AU/NZ audience). 150–400 chars + CTA + 5-8 hashtags.',
  instagram: 'Instagram. Hook → value → CTA. 300–500 chars + 10-15 hashtags.',
  linkedin:  'LinkedIn. Professional tone. 200–600 chars. Max 3-5 hashtags.',
  tiktok:    'TikTok script. Hook (3 s) → 60-s body → outro. Use line breaks.',
  google:    'Google Ads. Headline ≤30 chars. Description ≤90 chars. No exaggerations.',
}

const CONTENT_TYPE_GUIDE: Record<ContentType, string> = {
  post:         'Write a complete social media post.',
  caption:      'Write an image caption. Assume the image matches the topic.',
  reel_script:  'Write a Reels/TikTok voiceover script with [SCENE] cues.',
  blog_outline: 'Write a blog post outline: H1 title + 5-7 H2 sections + brief bullets.',
  ad_copy:      'Write ad copy variants: Headline + Primary text + CTA button label.',
}

// ── System prompt ─────────────────────────────────────────────────────────────

export function buildSystemPrompt(
  input: FactoryJobInput,
  memoryContext: MemoryContext,
): string {
  const platformGuide  = PLATFORM_GUIDE[input.platform]
  const contentGuide   = CONTENT_TYPE_GUIDE[input.contentType]
  const memorySection  = formatMemoryForPrompt(memoryContext, {
    headingLevel:         '##',
    includeRecentDecisions: false,  // production 层不需要决策历史，省 token
  })

  const brandBlock = buildBrandBlock(input)

  return [
    'You are a senior content strategist producing high-quality marketing content for Australian and New Zealand businesses.',
    '',
    `Platform: ${platformGuide}`,
    `Task: ${contentGuide}`,
    '',
    'Always use AU/NZ English spelling (e.g. "optimise", "colour"). Avoid US-centric cultural references.',
    '',
    brandBlock,
    memorySection,
  ].filter(Boolean).join('\n')
}

// ── User prompt ───────────────────────────────────────────────────────────────

export function buildUserPrompt(input: FactoryJobInput): string {
  const variantCount = Math.min(Math.max(input.variants ?? 1, 1), 5)
  const lines: string[] = [
    `Topic: ${input.topic}`,
  ]

  if (input.fdeNote) {
    lines.push(`Additional instruction: ${input.fdeNote}`)
  }

  if (input.campaignBrief?.title) {
    lines.push(`Current campaign: ${input.campaignBrief.title}`)
  }

  lines.push('')
  if (variantCount === 1) {
    lines.push('Generate 1 content variant. Return as JSON: {"variants":[{"content":"...","hashtags":["..."]}]}')
  } else {
    lines.push(
      `Generate ${variantCount} distinct content variants (different angles/hooks).`,
      'Return as JSON: {"variants":[{"content":"...","hashtags":["..."]},...]}',
    )
  }

  return lines.join('\n')
}

// ── Brand block (optional) ────────────────────────────────────────────────────

function buildBrandBlock(input: FactoryJobInput): string {
  const mb = input.masterBrief
  if (!mb) return ''

  const parts: string[] = ['## Brand Context']

  if (mb.brand_name)        parts.push(`Brand: ${mb.brand_name}`)
  if (mb.core_proposition)  parts.push(`Proposition: ${mb.core_proposition}`)
  if (mb.brand_voice?.tone_keywords?.length) {
    parts.push(`Voice: ${mb.brand_voice.tone_keywords.join(', ')}`)
  }

  if (mb.target_audience?.location) {
    parts.push(`Audience location: ${mb.target_audience.location}`)
  }

  if (mb.content_pillars && mb.content_pillars.length > 0) {
    const pillars = mb.content_pillars.slice(0, 3).map(p => p.name).join(', ')
    parts.push(`Content pillars: ${pillars}`)
  }

  return parts.length > 1 ? parts.join('\n') : ''
}
