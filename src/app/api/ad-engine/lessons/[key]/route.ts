/**
 * PATCH /api/ad-engine/lessons/[key]
 *
 * 停用 / 恢复一条跨客户经验。
 *
 * 为什么非要有这个接口（2026-08-04）：
 *   魏征审这套「会学习的广告引擎」时最狠的一刀是——**错结论一旦写进去，物理上
 *   撤不回来**。`global_learned_lessons` 全仓零个写入方，唯一的修正手段是直接
 *   敲 SQL；而同一张表里就躺着 `config-must-go-through-ui-not-direct-db-write`
 *   这条经验。当天真的发生了：5 条含买家真名 / 每 lead 成本的经验在漏，我只能
 *   用 SQL 关掉它们。
 *
 *   PM 在盘问第 1 问里加的那句「同时让我作为系统的设计者也了解」，落地就是这个
 *   按钮 —— **能看见 + 能关掉，才叫可撤回。**
 *
 * 只允许改 `is_active`。经验正文的修改走脱敏重写流程（要过 lesson-shareability
 * 那道闸），不从这里改，免得绕开闸门。
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ key: string }> },
) {
  // 必须是**全局** admin：这条经验一关，全部客户的 AI 行为都跟着变。
  // 受限管理员（DEMO_ADMINS，只该看自己那一个客户）不该有这个开关。
  const guard = await guardGlobalAdmin()
  if (guard) return guard

  const { key } = await params
  if (!key) {
    return NextResponse.json({ success: false, error: 'Missing lesson key' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const isActive = body['is_active']
  if (typeof isActive !== 'boolean') {
    return NextResponse.json(
      { success: false, error: 'is_active must be true or false' },
      { status: 400 },
    )
  }

  const { data, error } = await supabaseAdmin
    .from('global_learned_lessons')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('lesson_key', key)
    .select('lesson_key, is_active')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ success: false, error: `No lesson named "${key}"` }, { status: 404 })
  }

  return NextResponse.json({ success: true, lesson: data })
}
