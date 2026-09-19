// Blog post quality audit — wraps evaluate() with blog-specific context.
// SDK client is created internally; callers pass only content, mode, and metadata.

import { getOpenAIClient } from '@/lib/ai/openai-client'
import { evaluate } from '@/lib/content/quality-rubric'
import {
  runContentGuard,
  mergeGuardIntoRubric,
  SKIPPED_RUBRIC,
  hasRetryableFailure,
  contentGuardSnapshot,
} from '@/lib/content/content-guard'
import type { ContentGuardResult, GuardLanguage } from '@/lib/content/content-guard'
import type { RubricContext, RubricResult } from '@/lib/content/quality-rubric'

export interface BlogAuditMetadata {
  /** Language the post must be written in; inferred from the copy when absent. */
  target_language?: GuardLanguage | null
  brand_name?: string | null
  tone?: string | null
  avoid_words?: string[] | null
  platforms?: string[] | null
  primary_audience?: string | null
  campaign?: {
    title?: string | null
    offer?: string | null
    primary_cta?: string | null
    campaign_angle?: string | null
    target_audience_detail?: string | null
  } | null
  primaryKeyword?: string | null
}

export interface BlogAuditResult {
  rubricResult: RubricResult
  contextSnapshot: Record<string, unknown>
  /** Pre-publish guard (mixed language / cliché). needsHumanReview ⇒ keep out of auto-publish. */
  contentGuard: ContentGuardResult
  /** False when the only failure is an unavailable guard judge — regenerating cannot fix it. */
  retryable: boolean
}

/**
 * Evaluate blog post quality using the standard rubric.
 * Without OPENAI_API_KEY the rubric is skipped but the content guard still runs
 * (fail-closed: mixed-language / cliché copy must never skip review).
 *
 * Calling form (from route):
 *   auditBlogPost(result.html_body + '\n' + (result.geo_html_snapshot ?? ''), mode, metadata)
 */
export async function auditBlogPost(
  content: string,
  mode: string,
  metadata: BlogAuditMetadata,
): Promise<BlogAuditResult> {
  const hasRubricLLM = Boolean(process.env.OPENAI_API_KEY)
  if (!hasRubricLLM) console.warn('[blog quality] Rubric skipped: OPENAI_API_KEY not available — content guard still runs')

  const ctx: RubricContext = {
    brief: {
      brand_name:       metadata.brand_name ?? null,
      tone:             metadata.tone ?? null,
      avoid_words:      metadata.avoid_words ?? null,
      platforms:        metadata.platforms ?? null,
      primary_audience: metadata.primary_audience ?? null,
    },
    campaign:        metadata.campaign ?? null,
    platform:        'blog',
    contentType:     'blog',
    primaryKeyword:  metadata.primaryKeyword ?? null,
  }

  const [rubric, contentGuard] = await Promise.all([
    hasRubricLLM
      ? evaluate(content, ctx, { llmClient: getOpenAIClient() })
      : Promise.resolve(SKIPPED_RUBRIC),
    runContentGuard(content, { targetLanguage: metadata.target_language ?? null }),
  ])
  const rubricResult = mergeGuardIntoRubric(rubric, contentGuard)

  const contextSnapshot: Record<string, unknown> = {
    mode,
    platform:        'blog',
    brand_name:      metadata.brand_name ?? null,
    tone:            metadata.tone ?? null,
    primary_audience: metadata.primary_audience ?? null,
    campaign:        metadata.campaign ?? null,
    primaryKeyword:  metadata.primaryKeyword ?? null,
    quality: {
      overallScore: rubricResult.overallScore,
      pass:         rubricResult.pass,
      dimensions:   rubricResult.dimensions,
    },
    rubric_skipped: !hasRubricLLM,
    content_guard: contentGuardSnapshot(contentGuard),
    auditedAt: new Date().toISOString(),
  }

  return { rubricResult, contextSnapshot, contentGuard, retryable: hasRetryableFailure(rubricResult, contentGuard) }
}
