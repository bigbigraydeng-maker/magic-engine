// Social post quality audit — wraps evaluate() with social-specific context.
// SDK client is created internally; callers pass content, platforms, contentType, and metadata.

import OpenAI from 'openai'
import { evaluate } from '@/lib/content/quality-rubric'
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
}

/**
 * Evaluate social post quality using the standard rubric.
 * Route B (social_b) automatically receives the viral-structure-preservation advisory dimension.
 * Returns null when OPENAI_API_KEY is unavailable (non-blocking).
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
): Promise<SocialAuditResult | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.warn('[social quality] Audit skipped: OPENAI_API_KEY not available')
    return null
  }

  const llmClient = new OpenAI({ apiKey })
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
  const rubricResult = await evaluate(content, ctx, { llmClient, routeDimensions })

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
    auditedAt: new Date().toISOString(),
  }

  return { rubricResult, contextSnapshot }
}
