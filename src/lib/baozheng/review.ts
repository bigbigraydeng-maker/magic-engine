import { MODEL_SONNET, parseJsonResponse } from '@/lib/anthropic/client'
import type { BaozhengClientConfig, StageCategory } from './config'
import type { ReviewResult } from './accuracy'
import { REVIEW_SYSTEM_PROMPT, buildReviewUserMessage, type ReviewStageOption } from './prompts'

/** The subset of callClaudeChat we use (dependency-injected so tests never call the network). */
export type ReviewLlm = (params: {
  systemPrompt: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  model?: string
  singleAttempt?: boolean
  maxOutputTokens?: number
  timeoutMs?: number
}) => Promise<{ text: string; cost_usd: number }>

export const REVIEW_MAX_OUTPUT_TOKENS = 300
export const REVIEW_TIMEOUT_MS = 60_000
export const REVIEW_REASON_MAX = 60

export interface ReviewVerdict {
  /** null = reviewer said "unclear" */
  stage: string | null
  reason: string
  costUsd: number
  /** the model answered but the answer was unusable (the call was still paid for); stage is null then */
  invalid?: string
}

/** Read the category of a stage from own properties only (rule BZ-18). */
function categoryOf(config: BaozhengClientConfig, stage: string): StageCategory | undefined {
  const map = config.stageCategories
  if (!Object.prototype.hasOwnProperty.call(map, stage)) return undefined
  return map[stage]
}

/** Trim and cut to REVIEW_REASON_MAX code points so CJK is not split. */
function clampReason(reason: string): string {
  const trimmed = reason.trim()
  return Array.from(trimmed).slice(0, REVIEW_REASON_MAX).join('')
}

/** Validate the parsed JSON shape and return the raw stage + reason strings. */
function readVerdict(parsed: unknown): { stage: string; reason: string } {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('reviewer returned malformed JSON')
  }
  const record = parsed as Record<string, unknown>
  const stage = record.stage
  const reason = record.reason
  if (typeof stage !== 'string' || typeof reason !== 'string') {
    throw new Error('reviewer returned malformed JSON')
  }
  return { stage, reason }
}

/**
 * Ask the reviewer once. Call llm with: systemPrompt REVIEW_SYSTEM_PROMPT, one user message buildReviewUserMessage(options, transcript),
 * model MODEL_SONNET, singleAttempt true, maxOutputTokens REVIEW_MAX_OUTPUT_TOKENS, timeoutMs REVIEW_TIMEOUT_MS.
 * Parse with parseJsonResponse<unknown>(res.text). The parsed value must be an object with string `stage` and string `reason`,
 * otherwise throw new Error('reviewer returned malformed JSON').
 * stage === 'unclear' -> null. stage not among options[].key -> throw new Error(`reviewer returned unknown stage: ${stage}`).
 * reason: trimmed, cut to REVIEW_REASON_MAX characters (Array.from(reason).slice(0, max).join('') so CJK is not split).
 * costUsd = res.cost_usd. Errors from llm propagate (caller records them).
 */
export async function reviewTranscript(
  llm: ReviewLlm,
  options: readonly ReviewStageOption[],
  transcript: string,
): Promise<ReviewVerdict> {
  const res = await llm({
    systemPrompt: REVIEW_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildReviewUserMessage(options, transcript) }],
    model: MODEL_SONNET,
    singleAttempt: true,
    maxOutputTokens: REVIEW_MAX_OUTPUT_TOKENS,
    timeoutMs: REVIEW_TIMEOUT_MS,
  })

  // The call is already paid for: an unusable answer must still report its cost (weekly cost cap).
  try {
    const { stage, reason } = readVerdict(parseJsonResponse<unknown>(res.text))
    if (stage !== 'unclear' && !options.some((o) => o.key === stage)) {
      throw new Error(`reviewer returned unknown stage: ${stage}`)
    }
    return { stage: stage === 'unclear' ? null : stage, reason: clampReason(reason), costUsd: res.cost_usd }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { stage: null, reason: '', costUsd: res.cost_usd, invalid: message.slice(0, 200) }
  }
}

/**
 * Compare by CATEGORY (rule BZ-18), using OWN properties of config.stageCategories only (Object.prototype.hasOwnProperty.call):
 * reviewStage null -> 'review_unclear'.
 * either stage has no category -> 'not_reviewed'.
 * same category -> 'agree', else 'disagree'.
 */
export function compareStages(
  aiStage: string,
  reviewStage: string | null,
  config: BaozhengClientConfig,
): ReviewResult {
  if (reviewStage === null) return 'review_unclear'
  const aiCategory = categoryOf(config, aiStage)
  const reviewCategory = categoryOf(config, reviewStage)
  if (aiCategory === undefined || reviewCategory === undefined) return 'not_reviewed'
  return aiCategory === reviewCategory ? 'agree' : 'disagree'
}

/** Pool check (rule BZ-16): the reviewer found a deep or won customer among the ones the AI could not read. */
export function isSuspectedMiss(reviewStage: string | null, config: BaozhengClientConfig): boolean {
  if (reviewStage === null) return false
  const category = categoryOf(config, reviewStage)
  return category === 'deep' || category === 'won'
}
