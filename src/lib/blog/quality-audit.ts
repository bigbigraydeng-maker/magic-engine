// Blog post quality audit — wraps evaluate() with blog-specific context.
// SDK client is created internally; callers pass only content, mode, and metadata.

import { getOpenAIClient } from '@/lib/ai/openai-client'
import { evaluate } from '@/lib/content/quality-rubric'
import type { RubricContext, RubricResult } from '@/lib/content/quality-rubric'

export interface BlogAuditMetadata {
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
}

/**
 * Evaluate blog post quality using the standard rubric.
 * Returns null when OPENAI_API_KEY is unavailable (non-blocking).
 *
 * Calling form (from route):
 *   auditBlogPost(result.html_body + '\n' + (result.geo_html_snapshot ?? ''), mode, metadata)
 */
export async function auditBlogPost(
  content: string,
  mode: string,
  metadata: BlogAuditMetadata,
): Promise<BlogAuditResult | null> {
  if (!process.env.OPENAI_API_KEY) {
    console.warn('[blog quality] Audit skipped: OPENAI_API_KEY not available')
    return null
  }

  const llmClient = getOpenAIClient()

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

  const rubricResult = await evaluate(content, ctx, { llmClient })

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
    auditedAt: new Date().toISOString(),
  }

  return { rubricResult, contextSnapshot }
}
