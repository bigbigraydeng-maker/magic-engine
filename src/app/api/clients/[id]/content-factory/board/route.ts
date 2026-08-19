import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

/** 做片流水线还没结束的状态（与 video 路由同一套判据） */
const ACTIVE_JOB_STATUSES = ['queued', 'planning', 'rendering', 'assembling']
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
  // 鉴权闸（2026-08-05 狄仁杰复审）：这条路由原来**完全没有任何登录校验**，
  // 而中间件的 matcher 只覆盖 /dashboard 和 /portal，不管 /api。
  // 实测：匿名 curl 带一个 client_id 就能拿到该客户的内容流水线（CTS 返回 30KB）。
  const __access = await requireDashboardClientAccess(params.id)
  if (!__access.ok) {
    return NextResponse.json({ error: __access.error }, { status: __access.status })
  }

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
      // 边走边录自动剪辑留的字幕(听写原文或客户校对过的版本)，前端用来渲染校对区
      reelCaptions: (p.generation_context_snapshot as Record<string, unknown> | null)?.reel_captions ?? null,
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

    // 课程区的讲要能在列表上看到「做片失败」，不然失败永远显示「做片中」(板桥审)
    // 平铺看板的卡片也要查做片任务：非讲课式内容确认后同样会排做片，做片期间
    // 停在「备料」。界面据此决定要不要给「传成片」入口 —— 做片中还让人挂片，
    // 挂完会被 render-assemble 无条件覆盖掉（接口那侧也拦，这里是别让人白挂一次）。
    const approvedIds = [
      ...Array.from(courseMap.values()).flatMap((c) =>
        (c.lessons as { id: string; status: string }[])
          .filter((l) => l.status === 'approved')
          .map((l) => l.id),
      ),
      ...Object.values(stages)
        .flat()
        .filter((c) => (c as { status: string }).status === 'approved')
        .map((c) => (c as { id: string }).id),
    ]
    const failedPosts = new Set<string>()
    const renderingPosts = new Set<string>()
    if (approvedIds.length > 0) {
      const { data: jobs } = await supabaseAdmin
        .from('content_factory_render_jobs')
        .select('content_post_id, status, created_at')
        .in('content_post_id', approvedIds)
        .order('created_at', { ascending: false })
      const seen = new Set<string>()
      for (const j of jobs ?? []) {
        if (seen.has(j.content_post_id)) continue // 只看每条最新一条任务
        seen.add(j.content_post_id)
        if (j.status === 'failed') failedPosts.add(j.content_post_id)
        if (ACTIVE_JOB_STATUSES.includes(j.status)) renderingPosts.add(j.content_post_id)
      }
    }
    // 挂到平铺看板的卡片上（课程区的讲走下面 courses 那条链路）
    for (const list of Object.values(stages)) {
      for (const c of list as { id: string; rendering?: boolean }[]) {
        c.rendering = renderingPosts.has(c.id)
      }
    }

    const courses = Array.from(courseMap.values()).map((c) => ({
      name: c.name,
      source: c.source,
      lessons: (c.lessons as { id: string; lessonNo: number }[])
        .map((l) => ({ ...l, renderFailed: failedPosts.has(l.id) }))
        .sort((a, b) => a.lessonNo - b.lessonNo),
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
