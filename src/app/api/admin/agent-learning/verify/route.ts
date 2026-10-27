/**
 * POST /api/admin/agent-learning/verify  { lessonKey, siteId }
 * 只读：按经验文字自动归类；SEO/GEO 类对"我们自己的站 / clients 里已有网址"抓首页现算。
 * 不调模型、不写库；siteId 只能是 'self' 或 clients.id，不接受手填网址。
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { classifyLesson } from '@/lib/agent-learning/lesson-verify/classify'
import { runSiteCheck } from '@/lib/agent-learning/lesson-verify/checks'

const SELF_SITE_DOMAIN = 'magicengine.com.au'

export async function POST(req: NextRequest) {
  const guard = await guardGlobalAdmin()
  if (guard) return guard

  const body = (await req.json().catch(() => ({}))) as { lessonKey?: unknown; siteId?: unknown }
  if (typeof body.lessonKey !== 'string' || !body.lessonKey) {
    return NextResponse.json({ success: false, error: 'lessonKey required' }, { status: 400 })
  }
  const { data: lesson } = await supabaseAdmin
    .from('global_learned_lessons')
    .select('lesson, rationale')
    .eq('lesson_key', body.lessonKey)
    .maybeSingle()
  if (!lesson) return NextResponse.json({ success: false, error: 'lesson not found' }, { status: 404 })

  const kind = classifyLesson(lesson.lesson as string, lesson.rationale as string | null)
  // 广告类只展示实验卡片（前端生成），无站点检查
  if (kind === 'ad_experiment' || kind === 'none') return NextResponse.json({ success: true, kind })

  let domain: string | null = null
  if (body.siteId === 'self') {
    domain = SELF_SITE_DOMAIN
  } else if (typeof body.siteId === 'string') {
    const { data: client } = await supabaseAdmin.from('clients').select('domain').eq('id', body.siteId).maybeSingle()
    domain = (client?.domain as string | null) ?? null
  }
  if (!domain) return NextResponse.json({ success: false, error: '请选择一个站点' }, { status: 400 })

  const outcome = await runSiteCheck(kind, domain)
  return NextResponse.json({ ...outcome, kind })
}
