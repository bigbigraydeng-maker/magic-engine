// Social post quality audit — wraps evaluate() with social-specific context.
// SDK client is created internally; callers pass content, platforms, contentType, and metadata.

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
import type { RubricContext, RubricResult, RouteDimension } from '@/lib/content/quality-rubric'

// Advisory dimension injected for Route B (viral video rewrite).
// Advisory = score is informational and does NOT affect overall pass verdict.
const VIRAL_STRUCTURE_DIM: RouteDimension = {
  id: 'viral-structure-preservation',
  description:
    "Does the rewritten content preserve the original viral video's structural hooks, pacing, and engagement triggers while aligning to brand DNA?",
  advisory: true,
}

export interface SocialAuditMetadata {
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
}

export interface SocialAuditResult {
  rubricResult: RubricResult
  contextSnapshot: Record<string, unknown>
  /** Pre-publish guard (mixed language / cliché). needsHumanReview ⇒ keep out of auto-publish. */
  contentGuard: ContentGuardResult
  /** False when the only failure is an unavailable guard judge — regenerating cannot fix it. */
  retryable: boolean
}

/**
 * Evaluate social post quality using the standard rubric.
 * Route B (social_b) automatically receives the viral-structure-preservation advisory dimension.
 * Without OPENAI_API_KEY the rubric is skipped but the content guard still runs
 * (fail-closed: mixed-language / cliché copy must never skip review).
 *
 * @param content        - Concatenated script + caption + hashtags text
 * @param platforms      - Target platforms; first entry used for platform-fit rule
 * @param contentType    - 'social_a' | 'social_b' | 'social_c'
 * @param metadata       - Brand + campaign context
 * @param primaryKeyword - Route A: the target keyword; Route B/C: omit or pass null
 */
export async function auditSocialPost(
  content: string,
  platforms: string[],
  contentType: 'social_a' | 'social_b' | 'social_c',
  metadata: SocialAuditMetadata,
  primaryKeyword?: string | null,
): Promise<SocialAuditResult> {
  const hasRubricLLM = Boolean(process.env.OPENAI_API_KEY)
  if (!hasRubricLLM) console.warn('[social quality] Rubric skipped: OPENAI_API_KEY not available — content guard still runs')
  const platform = platforms[0] ?? 'facebook'

  const ctx: RubricContext = {
    brief: {
      brand_name:       metadata.brand_name ?? null,
      tone:             metadata.tone ?? null,
      avoid_words:      metadata.avoid_words ?? null,
      platforms:        metadata.platforms ?? null,
      primary_audience: metadata.primary_audience ?? null,
    },
    campaign:       metadata.campaign ?? null,
    platform,
    contentType,
    primaryKeyword: primaryKeyword ?? null,
  }

  const routeDimensions: RouteDimension[] = contentType === 'social_b' ? [VIRAL_STRUCTURE_DIM] : []
  // A rubric failure must not drop the guard receipt — degrade to a skipped rubric instead.
  let rubricError: string | null = null
  const [rubric, contentGuard] = await Promise.all([
    hasRubricLLM
      ? evaluate(content, ctx, { llmClient: getOpenAIClient(), routeDimensions })
          .catch((err: unknown) => { rubricError = err instanceof Error ? err.message : String(err); return SKIPPED_RUBRIC })
      : Promise.resolve(SKIPPED_RUBRIC),
    runContentGuard(content, { targetLanguage: metadata.target_language ?? null }),
  ])
  const rubricResult = mergeGuardIntoRubric(rubric, contentGuard)

  const contextSnapshot: Record<string, unknown> = {
    platform,
    platforms,
    contentType,
    brand_name:       metadata.brand_name ?? null,
    tone:             metadata.tone ?? null,
    primary_audience: metadata.primary_audience ?? null,
    campaign:         metadata.campaign ?? null,
    primaryKeyword:   primaryKeyword ?? null,
    quality: {
      overallScore: rubricResult.overallScore,
      pass:         rubricResult.pass,
      dimensions:   rubricResult.dimensions,
    },
    rubric_skipped: !hasRubricLLM || rubricError !== null,
    rubric_error:   rubricError,
    content_guard: contentGuardSnapshot(contentGuard),
    auditedAt: new Date().toISOString(),
  }

  return { rubricResult, contextSnapshot, contentGuard, retryable: hasRetryableFailure(rubric, contentGuard) }
}
