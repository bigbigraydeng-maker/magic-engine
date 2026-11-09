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
      .is('archived_at', null)
      .not('storage_url', 'is', null)

    if (error) throw error

    // 🔴 2026-09-13 生产实测发现：`.not('vision_metadata->>kind', 'eq', 'video')` 曾直接写在
    //    上面的查询里，但绝大多数照片行没有 `kind` 这个键（只有视频行才写 kind='video'）——
    //    PostgREST 的 not-eq 遇到键不存在（NULL）时按 SQL 三值逻辑整行排除，等于把几乎所有
    //    真实照片一起筛掉了，只留极少数碰巧写了 kind 键的行。改成 JS 侧判断，跟
    //    client-asset-pool.ts::selectAssetUrls 同一份"缺 kind 键 = 不是视频"的口径。
    const assets = ((data ?? []) as RankableAsset[]).filter(
      (a) => (a.vision_metadata as Record<string, unknown> | null)?.kind !== 'video',
    )
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
