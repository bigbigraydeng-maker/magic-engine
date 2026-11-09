/**
 * POST /api/admin/conversions/outcomes/[id]/review —— 批准或拒绝一条成交/咨询
 *
 * 批准 = **批准并立即发送**，一次请求做完。
 * 分成两步（先批准、再发送）对 PM 没有意义：他心里就是"点一下，告诉 Meta"。
 * 多一步只会多一个"批了但没发出去"的中间态要解释。
 *
 * 🔴 批准是**撤不回**的：广告平台的转化接口没有删除端点。
 *    所以调用方必须带 `confirm: true`，前端负责弹二次确认。
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin, requireAdmin } from '@/lib/auth/require-admin'
import { assertClientScope } from '@/lib/conversions/route-guard'
import { sendApprovedOutcome } from '@/lib/conversions/writeback-service'
import { metaCapiWriter } from '@/lib/meta/capi/writer'

export const dynamic = 'force-dynamic'

const REJECT_REASONS = ['customer_opted_out', 'not_real_sale', 'duplicate', 'other'] as const

type Body = {
  decision: 'approve' | 'reject'
  confirm?: boolean
  rejectReason?: (typeof REJECT_REASONS)[number]
  rejectNote?: string
}

function requestMeta(request: Request) {
  const fwd = request.headers.get('x-forwarded-for') ?? ''
  return {
    ip: fwd.split(',')[0]?.trim() || null,
    ua: request.headers.get('user-agent'),
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await guardAdmin()
  if (guard) return guard

  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  const actor = admin.user.email ?? null

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  const { data: outcomeData, error: readErr } = await supabaseAdmin
    .from('me_sale_outcomes')
    .select('id, client_id, review_status, redacted_at, order_ref')
    .eq('id', params.id)
    .maybeSingle()

  if (readErr) return NextResponse.json({ error: `读取失败: ${readErr.message}` }, { status: 500 })
  if (!outcomeData) return NextResponse.json({ error: '记录不存在' }, { status: 404 })

  const outcome = outcomeData as {
    id: string
    client_id: string
    review_status: string
    redacted_at: string | null
  }

  const denied = assertClientScope(actor, outcome.client_id)
  if (denied) return denied

  if (outcome.redacted_at) {
    return NextResponse.json({ error: '这条已按客人要求删除个人信息，不能再处理' }, { status: 409 })
  }
  if (outcome.review_status !== 'pending_review') {
    // 幂等友好：已经处理过就如实说，不当成错误让前端弹红。
    return NextResponse.json(
      { already: true, review_status: outcome.review_status, message: '这条已经处理过了' },
      { status: 200 },
    )
  }

  const meta = requestMeta(request)
  const requestId = crypto.randomUUID()

  // ── 拒绝 ────────────────────────────────────────────────────────────
  if (body.decision === 'reject') {
    if (!body.rejectReason || !REJECT_REASONS.includes(body.rejectReason)) {
      // 原因必填：将来客人问「我的数据去哪了」、或复盘为什么没回写，靠这一列。
      return NextResponse.json(
        { error: '拒绝时必须选一个原因', allowed: REJECT_REASONS },
        { status: 400 },
      )
    }

    const { error } = await supabaseAdmin
      .from('me_sale_outcomes')
      .update({
        review_status: 'rejected',
        reject_reason: body.rejectReason,
        reject_note: body.rejectNote ?? null,
        reviewed_by: actor,
        reviewed_at: new Date().toISOString(),
        reviewed_ip: meta.ip,
        reviewed_ua: meta.ua,
        review_request_id: requestId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', outcome.id)
      .eq('review_status', 'pending_review')

    if (error) return NextResponse.json({ error: `保存失败: ${error.message}` }, { status: 500 })

    await supabaseAdmin.from('me_conversion_audit').insert({
      outcome_id: outcome.id,
      action: 'rejected',
      actor,
      ip: meta.ip,
      ua: meta.ua,
      request_id: requestId,
      detail: { reason: body.rejectReason, note: body.rejectNote ?? null },
    })

    return NextResponse.json({ review_status: 'rejected', message: '已记为不发送' })
  }

  // ── 批准并发送 ──────────────────────────────────────────────────────
  if (body.decision !== 'approve') {
    return NextResponse.json({ error: "decision 只能是 'approve' 或 'reject'" }, { status: 400 })
  }
  if (body.confirm !== true) {
    // 撤不回的动作要有明确意图，不能靠误点。
    return NextResponse.json(
      { error: '这一步撤不回，需要二次确认（confirm: true）' },
      { status: 400 },
    )
  }

  // 🔴 必须 select 出来判行数。Supabase 更新影响 0 行**不报错** ——
  //    不判的话，连点两次会有两个请求都往下走进发送流程，
  //    第二个看到第一个刚置的 sending，把状态搅成"不确定"，
  //    人再据此点"重新发送"就会真的多记一笔（魏征 2026-09-05 实测路径）。
  const { data: approved, error: approveErr } = await supabaseAdmin
    .from('me_sale_outcomes')
    .update({
      review_status: 'approved',
      reviewed_by: actor,
      reviewed_at: new Date().toISOString(),
      reviewed_ip: meta.ip,
      reviewed_ua: meta.ua,
      review_request_id: requestId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', outcome.id)
    .eq('review_status', 'pending_review')
    .select('id')

  if (approveErr) {
    return NextResponse.json({ error: `保存失败: ${approveErr.message}` }, { status: 500 })
  }
  if ((approved?.length ?? 0) === 0) {
    // 有人抢先批过了。别再走一遍发送流程。
    return NextResponse.json(
      { already: true, review_status: 'approved', message: '这条刚刚已经被处理过了' },
      { status: 200 },
    )
  }

  await supabaseAdmin.from('me_conversion_audit').insert({
    outcome_id: outcome.id,
    action: 'approved',
    actor,
    ip: meta.ip,
    ua: meta.ua,
    request_id: requestId,
    detail: {},
  })

  let result
  try {
    result = await sendApprovedOutcome(outcome.id, {
      supabase: supabaseAdmin,
      writer: metaCapiWriter,
      fetcher: fetch,
    })
  } catch (e) {
    // 批准已经落库了，发送这一步炸了也别把批准回滚 ——
    // 回滚会让人以为"没批过"，然后再点一次，那才是真正危险的。
    return NextResponse.json(
      {
        review_status: 'approved',
        send_status: 'error',
        message: `已批准，但发送时出错：${e instanceof Error ? e.message : String(e)}。可以稍后再试一次。`,
      },
      { status: 200 },
    )
  }

  await supabaseAdmin.from('me_conversion_audit').insert({
    outcome_id: outcome.id,
    writeback_id: result.writebackId,
    action: 'sent',
    actor,
    ip: meta.ip,
    ua: meta.ua,
    request_id: requestId,
    detail: { status: result.status },
  })

  return NextResponse.json({
    review_status: 'approved',
    send_status: result.status,
    message: result.message,
    preview: result.preview,
  })
}
