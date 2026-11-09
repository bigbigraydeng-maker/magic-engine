/**
 * POST /api/admin/conversions/outcomes/[id]/send —— 再发一次
 *
 * 存在的理由：批准那一次发送失败或结果不明时，**得有一条路把它推完**。
 * 没有这个接口的话：
 *   · 人工裁决「平台没收到」把状态放回队列后，没有任何代码会再发它；
 *   · 限流失败记下的「稍后再试」没有读者，那一行永久卡死；
 *   · 今日待办叫人去点的按钮，点了没有下文。
 * 那就是「下发给人的任务必须真能做」的反面 —— 管道断头。
 *
 * 安全性不靠这个接口克制，靠 `sendApprovedOutcome` 里那四道闸：
 * 已确认的再点也不会重发，正在发的会如实说"正在发送中"。
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin } from '@/lib/auth/require-admin'
import { guardConversionRoute } from '@/lib/conversions/route-guard'
import { sendApprovedOutcome } from '@/lib/conversions/writeback-service'
import { metaCapiWriter } from '@/lib/meta/capi/writer'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const guard = await guardAdmin()
  if (guard) return guard

  const { data, error } = await supabaseAdmin
    .from('me_sale_outcomes')
    .select('id, client_id, review_status')
    .eq('id', params.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: `读取失败: ${error.message}` }, { status: 500 })
  if (!data) return NextResponse.json({ error: '记录不存在' }, { status: 404 })

  const outcome = data as { id: string; client_id: string; review_status: string }

  const g = await guardConversionRoute(request, outcome.client_id)
  if (!g.ok) return g.response

  if (outcome.review_status !== 'approved') {
    return NextResponse.json(
      { error: '只有已批准的记录才能发送' },
      { status: 409 },
    )
  }

  let result
  try {
    result = await sendApprovedOutcome(outcome.id, {
      supabase: supabaseAdmin,
      writer: metaCapiWriter,
      fetcher: fetch,
    })
  } catch (e) {
    return NextResponse.json(
      { error: `发送时出错：${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    )
  }

  await supabaseAdmin.from('me_conversion_audit').insert({
    outcome_id: outcome.id,
    writeback_id: result.writebackId,
    action: 'resent',
    actor: g.ctx.actor,
    ip: g.ctx.ip,
    ua: g.ctx.ua,
    request_id: g.ctx.requestId,
    detail: { status: result.status },
  })

  return NextResponse.json({ send_status: result.status, message: result.message })
}
