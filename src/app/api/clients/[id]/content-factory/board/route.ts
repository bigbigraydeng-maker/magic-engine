import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  FACTORY_STAGES,
  stageOfContentPost,
  type ContentPostStatus,
  type FactoryStage,
} from '@/lib/factory/content-stages'

export const dynamic = 'force-dynamic'

// GET /api/clients/[id]/content-factory/board
// 内容工厂看板数据：把该客户的 organic 内容(content_posts)按 5 段分组。
// organic 走 content_posts（广告线走 content_work_orders，不在这个看板）。
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    // 上限 500：organic 内容短期到不了这量级。魏征 M5：若客户内容超 500，
    // 最老的(通常已发布)会被丢、counts 偏少——到量级前先记着，需要时改分页。
    const { data, error } = await supabaseAdmin
      .from('content_posts')
      .select('id, title, status, source_video_url, platforms, scheduled_at, published_at, created_at, script, caption, source, pillar_id, visual_brief')
      .eq('client_id', params.id)
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) throw error

    const stages: Record<FactoryStage, unknown[]> = {
      选题: [], 备料: [], 出片: [], 发布: [], 看表现: [],
    }

    for (const p of data ?? []) {
      const status = p.status as ContentPostStatus
      const hasVideo = Boolean(p.source_video_url)
      const stage = stageOfContentPost({ status, hasVideo })
      stages[stage].push({
        id: p.id,
        title: p.title || '(无标题)',
        status,
        stage,
        hasVideo,
        platforms: p.platforms ?? [],
        scheduledAt: p.scheduled_at,
        publishedAt: p.published_at,
        createdAt: p.created_at,
        // 详情抽屉用的全文字段
        hook: p.caption ?? '',
        script: p.script ?? '',
        pillar: p.pillar_id ?? '',
        source: p.source ?? '',
        visualBrief: p.visual_brief ?? '',
      })
    }

    const counts = Object.fromEntries(
      FACTORY_STAGES.map((s) => [s, stages[s].length]),
    ) as Record<FactoryStage, number>

    return NextResponse.json({ stages, counts })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
