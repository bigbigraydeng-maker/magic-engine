// Reels draft quality audit — wraps evaluate() with Reels-specific context.
// Audits fb_caption as the primary content string.
// SDK client is created internally; callers pass content and metadata.

import OpenAI from 'openai'
import { evaluate } from '@/lib/content/quality-rubric'
import type { RubricContext, RubricResult } from '@/lib/content/quality-rubric'

export interface ReelsAuditMetadata {
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

export interface ReelsAuditResult {
  rubricResult: RubricResult
  contextSnapshot: Record<string, unknown>
}

/**
 * Evaluate Reels draft quality using the standard rubric.
 * fb_caption is the audited string; opening/closing frame prompts are technical artifacts.
 * Returns null when OPENAI_API_KEY is unavailable (non-blocking).
 */
export async function auditReelsDraft(
  fbCaption: string,
  metadata: ReelsAuditMetadata,
): Promise<ReelsAuditResult | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.warn('[reels quality] Audit skipped: OPENAI_API_KEY not available')
    return null
  }

  const llmClient = new OpenAI({ apiKey })

  const ctx: RubricContext = {
    brief: {
      brand_name:       metadata.brand_name ?? null,
      tone:             metadata.tone ?? null,
      avoid_words:      metadata.avoid_words ?? null,
      platforms:        metadata.platforms ?? null,
      primary_audience: metadata.primary_audience ?? null,
    },
    campaign:    metadata.campaign ?? null,
    platform:    'reels',
    contentType: 'reels',
  }

  const rubricResult = await evaluate(fbCaption, ctx, { llmClient })

  const contextSnapshot: Record<string, unknown> = {
    platform:         'reels',
    contentType:      'reels',
    brand_name:       metadata.brand_name ?? null,
    tone:             metadata.tone ?? null,
    primary_audience: metadata.primary_audience ?? null,
    campaign:         metadata.campaign ?? null,
    quality: {
      overallScore: rubricResult.overallScore,
      pass:         rubricResult.pass,
      dimensions:   rubricResult.dimensions,
    },
    auditedAt: new Date().toISOString(),
  }

  return { rubricResult, contextSnapshot }
}
