// P21.J ME 原生化 P1 — POST /api/factory/work-orders/[id]/review(spec me-native-design v0.2)
// 审核动作层:UI 按钮 + 未来嵌入 Claude 对话框共用的同一个接口(一套动作两个前脸)。
// authz = guardAdmin(whitelist role=admin,比 Airtable 白名单强:点击前 403,魏征②)。
// 花钱闸服务端强制(approve 重判 $50 硬顶,绝不因 UI confirm 过就省,魏征红线③)。
// 三动作 approve / reject_quality(打回·画面,重开工单)/ reject_budget(只改预算回 in_review)。

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin, requireAdmin } from '@/lib/auth/require-admin'
import { approveBudgetWithinCap, parseReviewBody } from '@/lib/factory/review-actions'

export const dynamic = 'force-dynamic'

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardAdmin()
  if (guard) return guard
  const admin = await requireAdmin()
  const reviewer = admin.ok ? (admin.user.email ?? 'admin') : 'admin'

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  const parsed = parseReviewBody(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const { data: wo, error: loadErr } = await supabaseAdmin
    .from('content_work_orders')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 })
  if (!wo) return NextResponse.json({ error: 'work order not found' }, { status: 404 })
  if (wo.status !== 'in_review') {
    return NextResponse.json(
      { error: `only in_review orders can be reviewed (status=${wo.status})` },
      { status: 409 },
    )
  }
  const reviewRef = (wo.review_ref ?? {}) as Record<string, unknown>

  // ── 通过并投放 ────────────────────────────────────────────────────────────────
  if (parsed.action === 'approve') {
    // 花钱闸(魏征红线③):服务端重判生效投放预算 ≤ $50 硬顶
    const gate = approveBudgetWithinCap(reviewRef)
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: 422 })

    const { data: upd, error } = await supabaseAdmin
      .from('content_work_orders')
      .update({
        status: 'approved',
        review_ref: { ...reviewRef, approved_by: reviewer, approved_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'in_review')
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!upd || upd.length === 0) {
      return NextResponse.json({ error: 'work order no longer in_review' }, { status: 409 })
    }
    return NextResponse.json({ ok: true, status: 'approved', budget_usd: gate.budget })
  }

  // ── 打回·画面质量:老单 review_rejected + 重开新单,理由进新 brief ──────────────
  if (parsed.action === 'reject_quality') {
    const { data: upd, error } = await supabaseAdmin
      .from('content_work_orders')
      .update({
        status: 'review_rejected',
        reject_category: 'quality',
        reject_reason: parsed.feedback,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'in_review')
      .select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!upd || upd.length === 0) {
      return NextResponse.json({ error: 'work order no longer in_review' }, { status: 409 })
    }

    const brief = (wo.brief ?? {}) as Record<string, unknown>
    const { data: reopened, error: insErr } = await supabaseAdmin
      .from('content_work_orders')
      .insert({
        client_id: wo.client_id,
        signal_id: wo.signal_id,
        goal_id: wo.goal_id,
        master_brief_id: wo.master_brief_id,
        winner_structure_id: wo.winner_structure_id,
        order_type: wo.order_type,
        angle: wo.angle,
        angle_source: wo.angle_source,
        rationale_one_liner: wo.rationale_one_liner,
        brief: { ...brief, review_feedback: parsed.feedback, review_feedback_by: reviewer, reopened_from: wo.id },
        budget_cap_usd: wo.budget_cap_usd,
        source_ad_id: wo.source_ad_id,
        status: 'queued',
      })
      .select('id')
      .single()
    if (insErr) return NextResponse.json({ error: `reopen insert failed: ${insErr.message}` }, { status: 500 })
    return NextResponse.json({ ok: true, status: 'review_rejected', reopened_work_order_id: reopened.id })
  }

  // ── 打回·预算不对:只改投放预算回 in_review 二次确认,不重生产 ────────────────────
  const { data: upd, error } = await supabaseAdmin
    .from('content_work_orders')
    .update({
      review_ref: { ...reviewRef, publish_budget_usd: parsed.newBudget, budget_updated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('status', 'in_review')
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!upd || upd.length === 0) {
    return NextResponse.json({ error: 'work order no longer in_review' }, { status: 409 })
  }
  return NextResponse.json({ ok: true, status: 'in_review', publish_budget_usd: parsed.newBudget })
}
