/**
 * PATCH /api/ad-engine/lessons/[key]
 *
 * 停用 / 给所有客户打开一条跨客户经验。
 *
 * `{ is_active: true }` 打开给所有符合范围的客户，并清掉「只给某个客户」的名单。
 * `{ is_active: false }` 关掉，并清掉名单。
 * `{ only_client_id }` 只给这一个客户打开（is_active 仍为 true，其它客户的助手读不到）。
 *
 * 只改开关和名单。经验正文不从这里改。
 */
import { NextRequest, NextResponse } from 'next/server'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { applyLessonAudience, audienceFromToggle } from '@/lib/agent-learning/lesson-audience'
import { supabaseAudienceStore } from '@/lib/agent-learning/lesson-audience-db'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  const guard = await guardGlobalAdmin()
  if (guard) return guard

  const { key } = await params
  if (!key) {
    return NextResponse.json({ success: false, error: 'Missing lesson key' }, { status: 400 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = audienceFromToggle(body as Record<string, unknown>)
  if (!parsed.ok) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 })

  const result = await applyLessonAudience(supabaseAudienceStore(), {
    lessonKey: key,
    mode: parsed.mode,
    clientId: parsed.clientId,
  })
  if (!result.ok) return NextResponse.json({ success: false, error: result.error }, { status: result.status })

  return NextResponse.json({
    success: true,
    lesson: { lesson_key: key, is_active: result.isActive, audience: result.audience },
  })
}
