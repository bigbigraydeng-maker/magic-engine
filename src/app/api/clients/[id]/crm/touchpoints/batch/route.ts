/**
 * POST /api/clients/[id]/crm/touchpoints/batch
 *
 * 「这一批我群发过邮件了，帮我记一笔。」
 *
 * 没有这个端点，「打过没人接」那一桶（CTS 108 人）复制完邮箱发出去之后，
 * 桶上的数字还是 108，明天打开还是 108 —— 销售会认定这页记不住他做过什么，
 * 于是回去用 Excel。这正是 PM 那句「不好用」的另一面。
 *
 * 复用单条写入的全部保证：每个人各写一条自己的触点（不是一条大记录），
 * 所以时间线、冷热分级、「别再联系」全都照常工作。
 *
 * 幂等：整批共用一个 clientRef，每个人的 source_ref = `${clientRef}:${contactId}`。
 * 重复提交同一批不会重复记；同一批里的人各自独立，不会互相顶掉。
 *
 * Body: { contactIds: string[], note?, channel?, clientRef }
 * Responses: 200 { recorded, skipped, failed } / 400 / 401 / 403 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { recordManualTouchpoint } from '@/lib/crm/touchpoints'
import { classifyNote, type NoteParse } from '@/lib/crm/note-parser'

/** 一次最多记这么多，防手滑把整库刷一遍。CTS 最大的桶 108 人，够用。 */
const MAX_BATCH = 500

interface Body {
  contactIds?: unknown
  note?: unknown
  clientRef?: unknown
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const seen = new Set<string>()
  const ids: string[] = []
  if (Array.isArray(body.contactIds)) {
    for (const v of body.contactIds) {
      if (typeof v !== 'string' || !v.trim()) continue
      const id = v.trim()
      if (seen.has(id)) continue
      seen.add(id)
      ids.push(id)
    }
  }
  if (ids.length === 0) {
    return NextResponse.json({ error: '没有选中任何人' }, { status: 400 })
  }
  if (ids.length > MAX_BATCH) {
    return NextResponse.json({ error: `一次最多记 ${MAX_BATCH} 人` }, { status: 400 })
  }

  const clientRef = typeof body.clientRef === 'string' ? body.clientRef.trim() : ''
  if (!clientRef) {
    return NextResponse.json({ error: '缺少 clientRef(幂等键)' }, { status: 400 })
  }

  const note = typeof body.note === 'string' && body.note.trim() ? body.note.trim() : '群发了一封邮件'

  // ── IDOR 闸：一次性筛出真正属于这个客户的人。不属于的直接不写，不报错泄露存在性。 ──
  const { data: owned, error: oErr } = await supabaseAdmin
    .from('contacts')
    .select('id, last_seen_at, do_not_contact')
    .eq('client_id', clientId)
    .in('id', ids)

  if (oErr) {
    return NextResponse.json({ error: oErr.message }, { status: 500 })
  }

  const rows = (owned ?? []) as { id: string; last_seen_at: string | null; do_not_contact: boolean }[]

  // 说过「别再联系」的人，即使前端传进来也绝不记 —— 群发时最容易误伤的就是他们。
  const targets = rows.filter((r) => !r.do_not_contact)

  const occurredAt = new Date().toISOString()

  // 整批共用一份解析结果。这句话是系统自己生成的、不含客户信息，
  // 送去 AI 解析 108 次既慢（整个请求必超时）又白花钱。规则层足够。
  const rules = classifyNote(note)
  const parsed: NoteParse = {
    outcome: rules.outcome,
    do_not_contact: rules.do_not_contact,
    travel_window: null,
    tour_interest: null,
    competitor: null,
    callback_at: null,
    summary: note.slice(0, 120),
  }

  let recorded = 0
  let skipped = 0
  let failed = 0

  // 顺序写：108 条对 Supabase 是小事，并发反而容易触发限流。
  for (const t of targets) {
    try {
      const res = await recordManualTouchpoint({
        clientId,
        contactId: t.id,
        direction: 'outbound',
        note,
        occurredAt,
        // 每人一个稳定的幂等键：同一批重复提交不会重复记。
        clientRef: `${clientRef}:${t.id}`,
        currentLastSeenAt: t.last_seen_at,
        parsed,
      })
      if (res.created) recorded++
      else skipped++
    } catch {
      failed++
    }
  }

  return NextResponse.json({
    recorded,
    // 重复提交（已经记过）+ 被挡下的「别再联系」
    skipped: skipped + (rows.length - targets.length),
    failed,
    notOwned: ids.length - rows.length,
  })
}
