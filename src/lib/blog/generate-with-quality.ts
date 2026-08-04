/**
 * Quality-gated blog generation — shared by the manual route
 * (POST /api/clients/[id]/blog) and the blog-weekly cron (22.E.S16).
 *
 * Wraps generateBlogPost with up to MAX_ATTEMPTS rubric-audited retries.
 * Extracted verbatim from src/app/api/clients/[id]/blog/route.ts so the
 * unattended cron path gets the same quality gate as the manual path
 * (reusable logic belongs in src/lib — PR #297 principle).
 */

import { generateBlogPost } from '@/lib/blog/generator'
import type { BlogGeneratorOutput } from '@/lib/blog/generator'
import { auditBlogPost } from '@/lib/blog/quality-audit'
import type { BlogAuditMetadata } from '@/lib/blog/quality-audit'
import { getActiveBrief } from '@/lib/content/brief-injector'
import { getActiveCampaigns } from '@/lib/content/campaign-injector'
import type { GenerateBlogRequest } from '@/types/magic-engine'

const MAX_ATTEMPTS = 3

export async function generateWithQualityRetry(
  req: GenerateBlogRequest & { client_id: string; mode: string; existing_pages_context?: string },
  mode: string,
): Promise<{
  result: BlogGeneratorOutput
  qualityScore: number | null
  contextSnapshot: Record<string, unknown> | null
}> {
  const [brief, campaigns] = await Promise.all([
    getActiveBrief(req.client_id).catch(() => null),
    getActiveCampaigns(req.client_id).catch(() => []),
  ])
  const campaign = campaigns[0] ?? null

  const metadata: BlogAuditMetadata = {
    brand_name:       brief?.brand_name ?? null,
    tone:             brief?.tone ?? null,
    avoid_words:      brief?.avoid_words ?? null,
    platforms:        brief?.platforms ?? null,
    primary_audience: brief?.primary_audience ?? null,
    campaign: campaign ? {
      title:                  campaign.title ?? null,
      offer:                  campaign.offer ?? null,
      primary_cta:            campaign.primary_cta ?? null,
      campaign_angle:         campaign.campaign_angle ?? null,
      target_audience_detail: campaign.target_audience_detail ?? null,
    } : null,
    primaryKeyword: req.primary_keyword ?? null,
  }

  let lastResult: BlogGeneratorOutput | null = null
  let qualityScore: number | null = null
  let contextSnapshot: Record<string, unknown> | null = null

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    lastResult = await generateBlogPost(req)

    try {
      const content = lastResult.html_body + '\n' + (lastResult.geo_html_snapshot ?? '')
      const audit = await auditBlogPost(content, mode, metadata)

      if (!audit) break

      qualityScore = audit.rubricResult.overallScore
      contextSnapshot = { ...audit.contextSnapshot, attempts: attempt }

      if (audit.rubricResult.pass || attempt === MAX_ATTEMPTS) {
        if (!audit.rubricResult.pass) {
          console.warn(
            `[blog quality] Post failed quality threshold after ${attempt} attempt(s)` +
            ` (score: ${audit.rubricResult.overallScore}). Proceeding with last result.`
          )
        }
        break
      }
    } catch (err) {
      console.error('[blog quality] Audit error (non-blocking):', err)
      break
    }
  }

  return { result: lastResult!, qualityScore, contextSnapshot }
}
