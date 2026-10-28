/**
 * Ad-agent copy for one paused draft.
 * The ads-strategy tree had no model call for primary text and headline.
 * This is that step: one short call, a hard cost cap, and no fallback sentence.
 */

import { callClaudeChat, MODEL_HAIKU, parseJsonResponse } from '@/lib/anthropic/client'
import { acceptDraftCopy, type CopyPair, type Ruled } from './plan-to-draft-rules'

export const DRAFT_COPY_COST_CAP_USD = 0.05

export async function writeDraftCopy(input: {
  brandText: string
  playLabel: string
}): Promise<Ruled<CopyPair>> {
  if (input.brandText.trim() === '') return { ok: false, reason: '没有品牌资料，广告文案没有写出来。' }
  try {
    const result = await callClaudeChat({
      model: MODEL_HAIKU,
      singleAttempt: true,
      maxOutputTokens: 300,
      timeoutMs: 20_000,
      systemPrompt: copySystemPrompt(),
      messages: [{ role: 'user', content: copyUserPrompt(input.brandText, input.playLabel) }],
    })
    if (result.cost_usd > DRAFT_COPY_COST_CAP_USD) {
      return { ok: false, reason: '广告文案的花费超过上限，没有出卡。' }
    }
    return acceptDraftCopy(parseJsonResponse<unknown>(result.text), input.brandText)
  } catch {
    return { ok: false, reason: '广告文案没有写出来。' }
  }
}

function copySystemPrompt(): string {
  return [
    'You write one Meta ad for an Australian or New Zealand audience.',
    'Use Australian English.',
    'Use only facts in the brand notes. Leave out anything the notes do not say.',
    'No prices, discounts, counts, dates, quotes, or people who are not in the notes.',
    'No placeholder text.',
    'Return JSON only: {"primaryText":"...","headline":"..."}.',
    'headline at most 40 characters. primaryText at most 125 characters.',
  ].join(' ')
}

function copyUserPrompt(brandText: string, playLabel: string): string {
  return `Ad play: ${playLabel}\n\nBrand notes:\n${brandText}`
}
