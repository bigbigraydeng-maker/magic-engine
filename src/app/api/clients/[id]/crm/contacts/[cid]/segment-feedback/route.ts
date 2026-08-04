import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * POST /api/clients/[id]/crm/contacts/[cid]/segment-feedback
 *
 * 销售说「这批分错了」。
 *
 * **这个接口不改任何人的分组，一个字段都不动。** 这是刻意的：分错是判据的
 * 问题，不是这一个人的问题。把他挪到另一批只是把错误藏起来 —— 下一批进来的
 * 人还会照样分错，而且从此没人知道规则有问题。
 *
 * 它做的是把「哪条判断错了」记下来，累积到一定量我们去改
 * lib/crm/segments 里的规则。改一次规则，所有人一起对。
 *
 * 存的时候连**当时的理由**一起存：规则改了之后就复现不出来了，
 * 没有那句快照，三周后回头看只剩一个「clicked_link 被报了 9 次」，
 * 谁也不知道当时页面上写的是什么。
 *
 * IDOR：contact 必须属于 path 上的 client，否则 404。
 *
 * Body: { segment: string, reason?: string, note?: string }
 * Responses: 201 { ok: true } / 400 / 401 / 403 / 404 / 500
 */

export const dynamic = 'force-dynamic'

/** 销售随手打的字，存这么多够回查了；再长的多半是粘贴事故。 */
const MAX_NOTE = 500

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; cid: string } },
): Promise<NextResponse> {
  const { id: clientId, cid } = params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: { segment?: unknown; reason?: unknown; note?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const segment = typeof body.segment === 'string' ? body.segment.trim() : ''
  if (!segment) {
    return NextResponse.json({ error: '要说清楚报的是哪一批' }, { status: 400 })
  }

  // 必须带 client_id 一起查，否则换个 cid 就能往别家客户名下写记录。
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('contacts')
    .select('id')
    .eq('id', cid)
    .eq('client_id', clientId)
    .maybeSingle()

  if (findErr) {
    console.error('[crm/segment-feedback] 查联系人失败:', findErr.message)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
  if (!existing) return NextResponse.json({ error: '联系人不存在' }, { status: 404 })

  const str = (v: unknown) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_NOTE) : null

  const { error: insertErr } = await supabaseAdmin.from('crm_segment_feedback').insert({
    client_id: clientId,
    contact_id: cid,
    segment,
    reason: str(body.reason),
    // 可空：他可能只是点了「分错了」没打字。那也是有用的信号 ——
    // 要求填理由会让这个动作变贵，然后就没人点了，我们也就什么都收不到。
    note: str(body.note),
    reported_by: access.user?.email ?? null,
  })

  if (insertErr) {
    console.error('[crm/segment-feedback] 写入失败:', insertErr.message)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 201 })
}
