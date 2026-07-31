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
      .select('id, title, status, source_video_url, platforms, scheduled_at, published_at, created_at, script, caption, source, pillar_id, visual_brief, format, generation_context_snapshot')
      .eq('client_id', params.id)
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) throw error

    const stages: Record<FactoryStage, unknown[]> = {
      选题: [], 备料: [], 出片: [], 发布: [], 看表现: [],
    }
    // 课程分组：source 以「系列课」开头的成体系内容，收进课程区（不混进平铺看板）。
    const courseMap = new Map<string, { name: string; source: string; lessons: unknown[] }>()

    const cardOf = (p: (typeof data)[number], status: ContentPostStatus, stage: FactoryStage) => ({
      id: p.id,
      title: p.title || '(无标题)',
      status,
      stage,
      hasVideo: Boolean(p.source_video_url),
      videoUrl: p.source_video_url ?? null,
      platforms: p.platforms ?? [],
      scheduledAt: p.scheduled_at,
      publishedAt: p.published_at,
      createdAt: p.created_at,
      mode: p.format === '讲课式' ? '讲课式' : '',
      hook: p.caption ?? '',
      script: p.script ?? '',
      pillar: p.pillar_id ?? '',
      visualBrief: p.visual_brief ?? '',
    })

    for (const p of data ?? []) {
      const status = p.status as ContentPostStatus
      const stage = stageOfContentPost({ status, hasVideo: Boolean(p.source_video_url) })
      const src = p.source ?? ''
      if (src.startsWith('系列课')) {
        if (!courseMap.has(src)) {
          courseMap.set(src, { name: src.replace(/^系列课[·:：]?/, '') || '系列课', source: src, lessons: [] })
        }
        const snap = p.generation_context_snapshot as { lesson_no?: number } | null
        courseMap.get(src)!.lessons.push({ ...cardOf(p, status, stage), lessonNo: snap?.lesson_no ?? 999 })
      } else {
        stages[stage].push(cardOf(p, status, stage))
      }
    }

    const courses = Array.from(courseMap.values()).map((c) => ({
      name: c.name,
      source: c.source,
      lessons: (c.lessons as { lessonNo: number }[]).sort((a, b) => a.lessonNo - b.lessonNo),
    }))

    const counts = Object.fromEntries(
      FACTORY_STAGES.map((s) => [s, stages[s].length]),
    ) as Record<FactoryStage, number>

    // 看板是每客户实时数据，绝不能被边缘/浏览器缓存(否则新写入的选题/成片看不到)。
    return NextResponse.json({ stages, counts, courses }, {
      headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate', 'CDN-Cache-Control': 'no-store' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
