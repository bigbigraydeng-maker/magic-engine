import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { runBriefPipeline } from '@/lib/brief/pipeline'
import type { BriefGenerateRequest } from '@/types/magic-engine'

/**
 * POST /api/clients/[id]/brief/generate
 *
 * Runs the Master Brief pipeline synchronously (Render paid tier supports long requests).
 * Typical runtime: 30–90 seconds depending on source data size.
 *
 * Body: BriefGenerateRequest
 * {
 *   website_urls: string[]   // max 5
 *   file_urls: string[]      // Supabase Storage paths (from /upload), max 10
 *   domain?: string          // for SEMrush lookup
 * }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  // 🔒 登录校验:此接口会消耗 AI 额度(生成内容),必须确认调用者有权访问该客户。
  // 此前完全裸奔 —— 知道 client_id 就能匿名反复调用烧钱。admin 直接过,client-viewer 限本人。
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const body = (await req.json()) as Partial<BriefGenerateRequest>

    const websiteUrls = (body.website_urls ?? []).slice(0, 5).filter(Boolean)
    const fileUrls = (body.file_urls ?? []).slice(0, 10).filter(Boolean)
    const domain = body.domain?.trim() || undefined
    const bodyAny = body as Record<string, unknown>
    const visualStyle = typeof bodyAny.visual_style === 'string' ? bodyAny.visual_style.trim() || undefined : undefined
    const brandColors = Array.isArray(bodyAny.brand_colors) ? (bodyAny.brand_colors as string[]) : undefined
    const visualAvoid = Array.isArray(bodyAny.visual_avoid) ? (bodyAny.visual_avoid as string[]) : undefined
    // P8.11.F.1: discovery-derived hints that override AI-inferred values
    const seedKeywords = Array.isArray(bodyAny.seed_keywords)
      ? (bodyAny.seed_keywords as unknown[]).filter((k): k is string => typeof k === 'string').slice(0, 20)
      : undefined
    const competitorDomains = Array.isArray(bodyAny.competitor_domains)
      ? (bodyAny.competitor_domains as unknown[]).filter((c): c is string => typeof c === 'string').slice(0, 20)
      : undefined

    if (websiteUrls.length === 0 && fileUrls.length === 0 && !domain) {
      return NextResponse.json(
        { error: 'Provide at least one website URL, file, or domain for SEMrush lookup.' },
        { status: 400 }
      )
    }

    const result = await runBriefPipeline({
      clientId: params.id,
      websiteUrls,
      storagePaths: fileUrls,
      domain,
      visualStyle,
      brandColors,
      visualAvoid,
      seedKeywords,
      competitorDomains,
    })

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error, warnings: result.warnings },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      brief_id: result.briefId,
      brief: result.brief,
      cost_usd: result.costUsd,
      input_tokens: result.inputTokens,
      warnings: result.warnings,
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
