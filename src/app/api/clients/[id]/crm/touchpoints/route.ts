/**
 * POST /api/clients/[id]/crm/touchpoints
 *
 * 记一次人工接触(销售手打的一通电话)。过 note-parser 变结构化触点,顺带把
 * 「别再联系」落到 contacts。冷热分级从触点算,所以这条写入是电话工作台的地基。
 *
 * 安全 / 稳定(三审焊死):
 *   IDOR   contact 必须属于 path 上的 client:WHERE id=contactId AND
 *          client_id=clientId,查不到即 404。admin(allowedClientId=null)也过
 *          这道闸 —— 拿 B 客户的 contactId 走 A 的路径写不进去。
 *   幂等    body.clientRef(前端生成的 uuid)作 source_ref,靠既有
 *          UNIQUE(client_id,source,source_ref)去重。缺失 → 400。
 *
 * Body: { contactId, direction?, note, occurredAt?, clientRef, outcome? }
 *
 * `outcome` 是可选的**一键动作**用的：页面上「没打通」「他不买了」这类按钮，
 * 内容是我们自己写死的一句话，结论已经确定，没有任何需要 AI 去读的东西。
 * 传了它就跳过解析 —— 省一次调用（每次约 1 秒 + 费用），更重要的是**结论不再
 * 靠模型**：一个「他不买了」被解析成 unknown，这个人明天照旧出现在名单上，
 * 而销售以为自己已经处理完了。
 * Responses: 200 { created, touchpointId, parsed } / 400 / 401 / 403 / 404 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { recordManualTouchpoint } from '@/lib/crm/touchpoints'
import { CONTACT_OUTCOMES, type ContactOutcome } from '@/lib/crm/note-parser'

// 补记历史电话是常态;但明显未来的时间(>5min)几乎都是脏输入,clamp 到 now,
// 否则会压制 segments 里「客户回话了」的判定。
const FUTURE_SKEW_MS = 5 * 60 * 1000

/** 一条跟进记录的上限。真实数据里最长的一条 300 字符出头。 */
const MAX_NOTE_CHARS = 5000

interface Body {
  contactId?: unknown
  direction?: unknown
  outcome?: unknown
  note?: unknown
  occurredAt?: unknown
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

  const contactId = typeof body.contactId === 'string' ? body.contactId.trim() : ''
  if (!contactId) {
    return NextResponse.json({ error: '缺少 contactId' }, { status: 400 })
  }

  // 幂等键:前端每次「记一笔」生成一次并复用,禁空(NULL 互不冲突 = 双击必重复)。
  const clientRef = typeof body.clientRef === 'string' ? body.clientRef.trim() : ''
  if (!clientRef) {
    return NextResponse.json({ error: '缺少 clientRef(幂等键)' }, { status: 400 })
  }

  // 剥掉 NUL（Postgres 的 text 收不了，会把整条写入炸成 500）；再封顶,
  // 一条跟进记录不该是一篇文章,而且原文会整条送去解析。
  const note = typeof body.note === 'string'
    ? body.note.replace(/\u0000/g, '').trim().slice(0, MAX_NOTE_CHARS)
    : ''
  if (!note) {
    return NextResponse.json({ error: '接触记录不能为空' }, { status: 400 })
  }

  const direction: 'inbound' | 'outbound' = body.direction === 'inbound' ? 'inbound' : 'outbound'

  // 一键动作可以直说结论，跳过 AI 解析（见文件头）。只认白名单里的值 ——
  // 随便一个字符串写进 metadata.outcome，分段规则会安静地读不懂它。
  const presetOutcome =
    typeof body.outcome === 'string' && (CONTACT_OUTCOMES as readonly string[]).includes(body.outcome)
      ? (body.outcome as ContactOutcome)
      : null
  if (body.outcome !== undefined && !presetOutcome) {
    return NextResponse.json({ error: '不认识这个结果' }, { status: 400 })
  }

  // occurredAt:默认 now;给了就解析 + clamp 未来。
  const now = Date.now()
  let occurredAt = new Date(now).toISOString()
  if (typeof body.occurredAt === 'string' && body.occurredAt.trim()) {
    const t = new Date(body.occurredAt).getTime()
    if (!Number.isNaN(t)) {
      // 明显未来(>now+skew)一律 clamp 到 now;过去和 skew 内的照原样。
      occurredAt = new Date(t > now + FUTURE_SKEW_MS ? now : t).toISOString()
    }
  }

  // ── IDOR 闸(最内层):contact 必须属于 path client。同时拿 last_seen_at。 ──
  const { data: contact, error: cErr } = await supabaseAdmin
    .from('contacts')
    .select('id, last_seen_at')
    .eq('id', contactId)
    .eq('client_id', clientId)
    .maybeSingle()

  if (cErr) {
    return NextResponse.json({ error: cErr.message }, { status: 500 })
  }
  if (!contact) {
    return NextResponse.json({ error: '联系人不存在' }, { status: 404 })
  }

  // 竞品清洗用客户自己的品牌词(没有就让 parseNote 用内置 CTS 词)。
  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('brand_aliases')
    .eq('id', clientId)
    .maybeSingle()
  const aliases = client?.brand_aliases
  const brandTerms =
    Array.isArray(aliases) && aliases.length > 0
      ? (aliases.filter((a): a is string => typeof a === 'string'))
      : undefined

  try {
    const result = await recordManualTouchpoint({
      clientId,
      contactId,
      direction,
      note,
      occurredAt,
      clientRef,
      brandTerms,
      currentLastSeenAt: contact.last_seen_at as string | null,
      // 结论已经确定就不再问 AI。note 是我们自己写死的一句话，
      // 里面没有任何客户信息，解析它既慢又白花钱，而且可能读错。
      parsed: presetOutcome
        ? {
            summary: note,
            outcome: presetOutcome,
            do_not_contact: presetOutcome === 'do_not_contact',
            travel_window: null,
            tour_interest: null,
            competitor: null,
            callback_at: null,
          }
        : undefined,
      // 谁记的。销售早上打开名单要分得清「昨天聊过」是不是自己聊的 ——
      // 在此之前这个信息一条都没存过。
      loggedByEmail: access.user?.email ?? null,
    })

    return NextResponse.json({
      created: result.created,
      touchpointId: result.touchpointId,
      parsed: {
        summary: result.parsed.summary,
        outcome: result.parsed.outcome,
        do_not_contact: result.parsed.do_not_contact,
        travel_window: result.parsed.travel_window,
        tour_interest: result.parsed.tour_interest,
        competitor: result.parsed.competitor,
        callback_at: result.parsed.callback_at,
      },
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '记录失败' },
      { status: 500 },
    )
  }
}
