import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import type { AssetSource } from '@/lib/assets/provenance'
import { rankAssetsByPrompt, type RankableAsset, type VisionMetadata } from '@/lib/factory/rank-assets-by-prompt'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 6

interface Recommendation {
  id: string
  storage_url: string
  original_filename: string | null
  reason: string
  quality_score: number
  metadata: VisionMetadata | null
  /** 素材来源 —— 选图界面按它显示来源徽章,FDE 挑图当下就知道这张能不能打真价。 */
  source: AssetSource
}

// POST /api/clients/[id]/asset-library/search
// Ranks a client's analysed photo library against an image-generation prompt
// and returns the top N matches, so the Social Plan Studio can offer
// "pick from library" instead of generating a fresh image.
// Body: { image_prompt: string, limit?: number }
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const { image_prompt, limit = DEFAULT_LIMIT } = (await req.json()) as {
      image_prompt?: string
      limit?: number
    }

    if (!image_prompt || !image_prompt.trim()) {
      return NextResponse.json(
        { success: false, error: 'image_prompt required' },
        { status: 400 },
      )
    }

    const access = await requireDashboardClientAccess(params.id)
    if (!access.ok) {
      return NextResponse.json({ success: false, error: access.error }, { status: access.status })
    }

    const topN = clampLimit(limit)

    const { data, error } = await supabaseAdmin
      .from('client_assets')
      .select('id, storage_url, original_filename, vision_metadata, source')
      .eq('client_id', params.id)
      .eq('status', 'analyzed')
      // 同 storyboard-generator:视频虽标 analyzed 但没有画面分析结果,不能当图片推荐出去
      .not('vision_metadata->>kind', 'eq', 'video')
      .is('archived_at', null)
      .not('storage_url', 'is', null)

    if (error) throw error

    const assets = (data ?? []) as RankableAsset[]
    // requireVerified 不开:这是人工选图界面,FDE 要能看见/选未核实的图(界面按
    // source 显示徽章自己判断),自动出片管线才需要收紧到只认核实过的来源。
    const picks = await rankAssetsByPrompt(image_prompt.trim(), assets, topN)

    const recommendations: Recommendation[] = picks.map((p) => ({
      id: p.id,
      storage_url: p.storageUrl,
      original_filename: assets.find((a) => a.id === p.id)?.original_filename ?? null,
      reason: p.reason,
      quality_score: p.qualityScore,
      metadata: p.metadata,
      source: p.source,
    }))

    return NextResponse.json({ success: true, recommendations })
  } catch (err: unknown) {
    const message =
      err instanceof Error
        ? err.message
        : (err as Record<string, unknown>)?.message as string | undefined ?? 'Unknown error'
    console.error('[clients/asset-library/search POST]', err)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return DEFAULT_LIMIT
  return Math.min(20, Math.floor(limit))
}
