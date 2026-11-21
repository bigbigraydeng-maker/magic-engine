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
 * 只允许切换 `is_active`，并在首次采纳时给 evidence 留下 adopted 状态。
 * 经验正文的修改走脱敏重写流程（要过 lesson-shareability 那道闸）。
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { isAdoptionCandidate, TUNE_ADOPTED_STATUS } from '@/lib/memory/tune-candidate'

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

  const { data: current, error: readError } = await supabaseAdmin
    .from('global_learned_lessons')
    .select('lesson_key, is_active, evidence, updated_at')
    .eq('lesson_key', key)
    .maybeSingle()
  if (readError) {
    return NextResponse.json({ success: false, error: readError.message }, { status: 500 })
  }
  if (!current) {
    return NextResponse.json({ success: false, error: `No lesson named "${key}"` }, { status: 404 })
  }

  const evidence = current.evidence && typeof current.evidence === 'object' && !Array.isArray(current.evidence)
    ? current.evidence as Record<string, unknown>
    : null
  // An active legacy candidate was already adopted, even if its old metadata still says candidate.
  const markAdopted = evidence && (isAdoptionCandidate(false, evidence)) && (isActive || current.is_active)
  const patch = {
    is_active: isActive,
    updated_at: new Date().toISOString(),
    ...(markAdopted ? { evidence: { ...evidence, status: TUNE_ADOPTED_STATUS } } : {}),
  }
  let update = supabaseAdmin
    .from('global_learned_lessons')
    .update(patch)
    .eq('lesson_key', key)
    .eq('is_active', current.is_active)
  update = current.updated_at === null
    ? update.is('updated_at', null)
    : update.eq('updated_at', current.updated_at)
  const { data, error } = await update
    .select('lesson_key, is_active')
    .maybeSingle()

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ success: false, error: '经验刚刚被改过。请刷新后再点。' }, { status: 409 })
  }

  return NextResponse.json({ success: true, lesson: data })
}
