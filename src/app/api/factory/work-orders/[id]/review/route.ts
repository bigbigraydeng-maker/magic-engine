// P21.J ME 原生化 — POST /api/factory/work-orders/[id]/review
// 审核动作层前脸①(UI 按钮)。前脸②=嵌入 Claude 对话框(/api/factory/chat),两者共用
// review-apply.ts 同一实现。authz=guardAdmin(点击前 403);花钱闸在 applyApprove 内服务端强制。

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin, requireAdmin, requireGlobalAdmin } from '@/lib/auth/require-admin'
import { parseReviewBody } from '@/lib/factory/review-actions'
import { applyApprove, applyBudgetUpdate, applyQualityReject, type ApprovalMarker } from '@/lib/factory/review-apply'

export const dynamic = 'force-dynamic'

/** Marker stored in review_ref so a later ledger check can tell this code path from the Airtable sync path. */
async function approvalMarker(): Promise<ApprovalMarker> {
  const globalAdmin = await requireGlobalAdmin()
  return { approval_source: 'me_review_route', approver_scope: globalAdmin.ok ? 'internal_staff' : 'scoped_admin' }
}

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

  const marker: ApprovalMarker | undefined = parsed.action === 'approve' ? await approvalMarker() : undefined

  const result =
    parsed.action === 'approve'
      ? await applyApprove(supabaseAdmin, id, reviewer, undefined, parsed.checklistHuman, marker)
      : parsed.action === 'reject_quality'
        ? await applyQualityReject(supabaseAdmin, id, parsed.feedback, reviewer, undefined, parsed.checklistHuman)
        : await applyBudgetUpdate(supabaseAdmin, id, parsed.newBudget, reviewer)

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, ...result.data })
}
