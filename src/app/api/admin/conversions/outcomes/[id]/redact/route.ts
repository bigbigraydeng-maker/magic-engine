/**
 * POST /api/admin/conversions/outcomes/[id]/redact —— 客人要求删除个人信息
 *
 * 🔴 **只能删我们这一侧。** 广告平台的转化接口没有删除端点 ——
 *    已经发出去的匿名哈希撤不回。返回文案必须如实这么说，
 *    绝不能让人以为"点一下就从平台那边删掉了"。
 *
 * 正在发送中的记录不处理（返回 409）：那一刻改状态会跟发送流程抢，
 * 结果两边都不确定。等它落定（几秒），或等它转成「不确定」后再来。
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin, requireAdmin } from '@/lib/auth/require-admin'
import { assertClientScope } from '@/lib/conversions/route-guard'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await guardAdmin()
  if (guard) return guard

  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  const actor = admin.user.email ?? null

  let reason = ''
  try {
    reason = ((await request.json()) as { reason?: string }).reason ?? ''
  } catch {
    // 没带正文也行，理由可以留空
  }

  const { data, error } = await supabaseAdmin
    .from('me_sale_outcomes')
    .select('id, client_id, redacted_at')
    .eq('id', params.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: `读取失败: ${error.message}` }, { status: 500 })
  if (!data) return NextResponse.json({ error: '记录不存在' }, { status: 404 })

  const outcome = data as { id: string; client_id: string; redacted_at: string | null }

  const denied = assertClientScope(actor, outcome.client_id)
  if (denied) return denied

  if (outcome.redacted_at) {
    return NextResponse.json({ already: true, message: '这条已经删过个人信息了' })
  }

  // 正在发送中的先别动 —— 会跟发送流程抢状态。
  const { data: sending } = await supabaseAdmin
    .from('me_conversion_writebacks')
    .select('id')
    .eq('outcome_id', outcome.id)
    .eq('status', 'sending')

  if ((sending?.length ?? 0) > 0) {
    return NextResponse.json(
      { error: '这条正在发送中，请过几秒再试' },
      { status: 409 },
    )
  }

  const now = new Date().toISOString()

  // 🔴 真的把五列清空，不是只写个时间戳。
  //    只写时间戳而数据还在，就是骗客人 —— 数据库那条约束也会拦下来。
  //    page_scoped_user_id（Facebook 私信身份）2026-09-15 补：Meta 文档要求这个
  //    字段不哈希发送，等于是能反查到具体真人的标识符，跟邮箱/电话一样必须
  //    在这里一起清空，否则"已删除"对纯私信来源的记录形同虚设（子牙+魏征评审
  //    双双抓到的漏洞）。
  const { error: redactErr } = await supabaseAdmin
    .from('me_sale_outcomes')
    .update({
      customer_email: null,
      customer_phone: null,
      customer_first: null,
      customer_last: null,
      page_scoped_user_id: null,
      redacted_at: now,
      redaction_reason: reason || '客人要求删除',
      updated_at: now,
    })
    .eq('id', outcome.id)

  if (redactErr) {
    return NextResponse.json({ error: `删除失败: ${redactErr.message}` }, { status: 500 })
  }

  // 未发送的记录冻掉，防止之后又被发出去。
  await supabaseAdmin
    .from('me_conversion_writebacks')
    .update({ status: 'redacted', updated_at: now })
    .eq('outcome_id', outcome.id)
    .in('status', ['queued', 'failed'])

  await supabaseAdmin.from('me_conversion_audit').insert({
    outcome_id: outcome.id,
    action: 'redacted',
    actor,
    detail: { reason: reason || null },
  })

  return NextResponse.json({
    redacted_at: now,
    message:
      '已删除我们这边保存的姓名、邮箱、电话，以及 Facebook 私信身份。' +
      '注意：如果这条之前已经发给过广告平台，那边的匿名数据无法撤回 —— 平台没有提供删除接口。',
  })
}
