/**
 * POST /api/clients/[id]/production/[packageId]/schedule
 *
 * P21.10 — Batch-schedule content posts in a production package.
 *
 * Body:
 *   assignments  { post_id: string; scheduled_at: string }[]  — ISO 8601 UTC
 *   approve      boolean  — if true, also flip package status → 'approved' (default false)
 *
 * Returns:
 *   { success, scheduled: number, failed: number, skipped: BlockedPost[], packageStatus }
 *
 * `skipped` = posts the pre-publish content guard flagged for human review
 * (mixed language / cliché opener / the check never completed). This route
 * approves in bulk, so those never ride along — see src/lib/content/guard-receipt.ts.
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { splitByGuard, type BlockedPost } from '@/lib/content/guard-receipt'

type RouteContext = { params: { id: string; packageId: string } }

interface Assignment {
  post_id: string
  scheduled_at: string
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const { id: clientId, packageId } = params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }

  let body: { assignments?: unknown; approve?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!Array.isArray(body.assignments) || body.assignments.length === 0) {
    return NextResponse.json({ success: false, error: 'assignments must be a non-empty array' }, { status: 400 })
  }

  const assignments = (body.assignments as unknown[]).filter(
    (a): a is Assignment =>
      typeof a === 'object' && a !== null &&
      typeof (a as Assignment).post_id === 'string' &&
      typeof (a as Assignment).scheduled_at === 'string'
  )

  if (assignments.length === 0) {
    return NextResponse.json({ success: false, error: 'No valid assignments provided' }, { status: 400 })
  }

  // 同一条稿传两次会被算成排了两条；去重后再往下走（保留最后一次的时间）。
  const deduped = Array.from(new Map(assignments.map(a => [a.post_id, a])).values())

  // 上限跟 /api/posts/batch 的 100 条对齐。没有上限时，下面那次自检查询会撞上
  // PostgREST 默认 1000 行的返回上限——被截掉的那些不在 blockedIds 里，于是
  // 标红的稿会静默放行（魏征复审；同一个坑见 PostgREST 1000 行那条记忆）。
  if (deduped.length > 100) {
    return NextResponse.json(
      { success: false, error: '一次最多排 100 条，分几批来' },
      { status: 400 },
    )
  }

  // Verify the package belongs to this client
  const { data: pkg, error: pkgErr } = await supabaseAdmin
    .from('production_packages')
    .select('id, status')
    .eq('id', packageId)
    .eq('client_id', clientId)
    .single()

  if (pkgErr || !pkg) {
    return NextResponse.json({ success: false, error: 'Production package not found' }, { status: 404 })
  }

  // Pre-publish guard: this route flips posts to 'approved' in bulk, so a post
  // the guard flagged for human review must not ride along. It is dropped from
  // the batch and named back to the caller — approving it one at a time, with a
  // human looking at the flag in the UI, stays allowed.
  const { data: guardRows, error: guardErr } = await supabaseAdmin
    .from('content_posts')
    .select('id, title, generation_context_snapshot')
    .in('id', deduped.map(a => a.post_id))
    .eq('client_id', clientId)
  if (guardErr) {
    return NextResponse.json({ success: false, error: guardErr.message }, { status: 500 })
  }
  // 少读到一行 = 这条不属于这个客户、或刚被删掉、或查询被截断。三种都不能当
  // 「没标红所以放行」—— 读不到就是没查过，fail closed。
  if ((guardRows ?? []).length !== deduped.length) {
    return NextResponse.json(
      { success: false, error: '有内容读不到（可能刚被删掉或不属于这个客户），这一批没动，刷新页面重新挑一次' },
      { status: 409 },
    )
  }
  const skipped: BlockedPost[] = splitByGuard(guardRows ?? []).blocked
  const blockedIds = new Set(skipped.map(b => b.id))
  const allowedAssignments = deduped.filter(a => !blockedIds.has(a.post_id))

  if (allowedAssignments.length === 0) {
    return NextResponse.json({
      success: false,
      scheduled: 0,
      failed: 0,
      skipped,
      packageStatus: pkg.status as string,
      error: `这 ${skipped.length} 条都被发布前自检标了「需人工复核」，批量排期不放行——逐条打开看过再单独确认`,
    }, { status: 409 })
  }

  // Batch-update content_posts.scheduled_at + status → 'approved'
  let scheduled = 0
  let failed = 0

  await Promise.all(
    allowedAssignments.map(async ({ post_id, scheduled_at }) => {
      // 必须 .select() 按真正写到的行数计数：命中 0 行时 Supabase 不报错，
      // 光看 error 会把「什么都没改」显示成「✅ 排期完成」（魏征复审）。
      const { data: written, error } = await supabaseAdmin
        .from('content_posts')
        .update({ scheduled_at, status: 'approved' })
        .eq('id', post_id)
        .eq('client_id', clientId)
        .select('id')

      if (error || !written || written.length === 0) {
        console.error(`[production/schedule] failed to schedule post ${post_id}:`, error?.message ?? 'no row updated')
        failed++
      } else {
        scheduled++
      }
    })
  )

  // Optionally flip package to 'approved' (enables downstream publish workflow).
  // 只要还有 skipped（标红待复核）或 failed（写库失败）没处理完，包就不能变
  // 「已批准」——仪表盘和详情页都只把 ready_for_review 算进待审核队列，一旦
  // 提前标成 approved，这些没处理完的内容就会跟着退出审核队列，没人再看。
  let packageStatus = pkg.status as string
  const shouldApprove = body.approve === true
  if (shouldApprove && scheduled > 0 && skipped.length === 0 && failed === 0 && pkg.status !== 'approved') {
    const { data: updated } = await supabaseAdmin
      .from('production_packages')
      .update({ status: 'approved' })
      .eq('id', packageId)
      .select('status')
      .single()
    if (updated) packageStatus = updated.status
  }

  return NextResponse.json({
    success: scheduled > 0,
    scheduled,
    failed,
    skipped,
    packageStatus,
  }, { status: scheduled > 0 ? 200 : 500 })
}
