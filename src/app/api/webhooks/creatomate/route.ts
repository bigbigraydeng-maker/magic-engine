/**
 * POST /api/webhooks/creatomate
 *
 * Creatomate 完成渲染后回调这个端点。spec §4.5：只做一件事——解析出 render_id，
 * 反查哪个 job 在等它，发 Inngest 事件唤醒（只带 job_id/render_id，不转发 status/url，
 * 见 lib/creatomate/events.ts 的注释）。业务判断（真的成功了吗）永远交给
 * factory-creatomate-render.ts 里独立的 GET /v2/renders/{id} 查询——这个端点无法验证
 * 请求来源（官方文档没提供签名机制，spec §3.3/§6.1），不能被信任为"事实来源"。
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import { CREATOMATE_RENDER_WEBHOOK_RECEIVED_EVENT } from '@/lib/creatomate/events'

/** 官方文档没有逐字给出 webhook payload 的字段名（spec §3.3）——按 render 对象自身的
 *  `id` 字段猜测，`render_id` 当兜底别名。上线后第一次真实回调必须核实，见 spec §5。 */
function extractRenderId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  const id = b.id ?? b.render_id
  return typeof id === 'string' && id.length > 0 ? id : null
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const renderId = extractRenderId(body)
  if (!renderId) {
    return NextResponse.json({ error: 'render id missing from payload' }, { status: 400 })
  }

  const { data: job } = await supabaseAdmin
    .from('content_factory_render_jobs')
    .select('id')
    .eq('creatomate_render_id', renderId)
    .maybeSingle()

  if (job) {
    await sendInngestEvent({
      id: `creatomate-webhook:${renderId}`,
      name: CREATOMATE_RENDER_WEBHOOK_RECEIVED_EVENT,
      data: { job_id: job.id, render_id: renderId },
    })
  }
  // 没有匹配的 job 不是错误——可能是重复回调，或者别的环境/租户的 render id。
  // 🔴 匹配与否返回同一个响应体（第二轮复审 ⚠️7 指出：分开返回 matched:true/false
  // 等于把"这个 render_id 存不存在"的判断结果从状态码换到了 body 里，一样能被拿来当
  // 存在性探针）——不给对方任何信号，200 让 Creatomate 别重试就够了。
  return NextResponse.json({ ok: true })
}
