// P21.J ME 原生化 — POST /api/factory/work-orders/[id]/review
// 审核动作层前脸①(UI 按钮)。前脸②=嵌入 Claude 对话框(/api/factory/chat),两者共用
// review-apply.ts 同一实现。authz=requireAdminScope(点击前 403;限定客户的管理员只能审自己客户的工单,批准只给内部员工);花钱闸在 applyApprove 内服务端强制。

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAdminScope, requireGlobalAdmin } from '@/lib/auth/require-admin'
import { parseReviewBody } from '@/lib/factory/review-actions'
import { applyApprove, applyBudgetUpdate, applyQualityReject, type ApprovalMarker } from '@/lib/factory/review-apply'

export const dynamic = 'force-dynamic'

/**
 * Marker stored in review_ref so a later ledger check can tell this code path from the Airtable sync path.
 * Only a 403 (signed in, but not internal staff) is recorded as scoped_admin. An unreadable session (401) is
 * refused instead: a wrong marker could never be corrected afterwards, because only in_review orders can be approved.
 */
async function approvalMarker(): Promise<ApprovalMarker | NextResponse> {
  const globalAdmin = await requireGlobalAdmin()
  if (globalAdmin.ok) return { approval_source: 'me_review_route', approver_scope: 'internal_staff' }
  if (globalAdmin.status === 403) return { approval_source: 'me_review_route', approver_scope: 'scoped_admin' }
  return NextResponse.json({ error: globalAdmin.error }, { status: globalAdmin.status })
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdminScope()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  const reviewer = admin.user.email ?? 'admin'
  const scopedClientId = admin.scope.kind === 'global' ? undefined : admin.scope.clientId

  const { id } = await params

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  const parsed = parseReviewBody(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  if (parsed.action === 'approve' && admin.scope.kind !== 'global') {
    console.warn(`[factory scope] approve denied: ${reviewer} is limited to client ${scopedClientId}, approving publishes for real, work order ${id}`)
    return NextResponse.json({ error: 'Forbidden — only internal staff can approve a work order for publishing' }, { status: 403 })
  }

  const marker = parsed.action === 'approve' ? await approvalMarker() : null
  if (marker instanceof NextResponse) return marker

  const result =
    parsed.action === 'approve'
      ? await applyApprove(supabaseAdmin, id, reviewer, scopedClientId, parsed.checklistHuman, marker)
      : parsed.action === 'reject_quality'
        ? await applyQualityReject(supabaseAdmin, id, parsed.feedback, reviewer, scopedClientId, parsed.checklistHuman, parsed.musicId)
        : await applyBudgetUpdate(supabaseAdmin, id, parsed.newBudget, reviewer, scopedClientId)

  if (!result.ok && result.status === 403 && scopedClientId) {
    console.warn(`[factory scope] ${parsed.action} denied: ${reviewer} is limited to client ${scopedClientId}, work order ${id}`)
  }
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ ok: true, ...result.data })
}
