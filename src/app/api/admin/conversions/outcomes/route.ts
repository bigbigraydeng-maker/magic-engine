/**
 * POST /api/admin/conversions/outcomes  —— 录入一条成交 / 咨询事实（Issue #1397 PR1）
 * GET  /api/admin/conversions/outcomes  —— 列出某客户的行（审核页与今日待办用）
 *
 * 录进来的行一律是 `pending_review`，**本 PR 不发任何事件、不碰 Meta**。
 * 审核放行与发送在 PR3；这里只保证"事实进得来、进来的是干净的"。
 *
 * Security: guardAdmin。
 *   不用 guardGlobalAdmin —— 这个接口只写单个客户的数据，
 *   受限管理员（只能看自己那个客户的演示账号）录自己客户的成交是合理的。
 *   但下面仍然按 allowedClientId 做了范围校验，防止越客户写入。
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardAdmin, requireAdmin } from '@/lib/auth/require-admin'
import { assertClientScope } from '@/lib/conversions/route-guard'
import { buildIntakeRow, type IntakeInput } from '@/lib/conversions/intake'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 审计里记请求来源。只有 reviewed_by 邮箱不够 —— 会话被劫也是同一个邮箱。 */
function requestMeta(request: Request) {
  const fwd = request.headers.get('x-forwarded-for') ?? ''
  const ip = fwd.split(',')[0]?.trim() || null
  return { ip, ua: request.headers.get('user-agent') }
}

export async function POST(request: Request) {
  const guard = await guardAdmin()
  if (guard) return guard

  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })
  const actor = admin.user.email ?? null

  let body: IntakeInput
  try {
    body = (await request.json()) as IntakeInput
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  if (!UUID_RE.test(body?.clientId ?? '')) {
    return NextResponse.json({ error: 'clientId 必须是 uuid' }, { status: 400 })
  }

  // 受限管理员只能录自己那个客户的
  const denied = assertClientScope(actor, body.clientId)
  if (denied) return denied

  // 电话转国际格式要知道客户所在国。查不到就让 intake 层丢掉本地格式电话
  // （宁可少一个匹配键，也不猜错国家 —— 猜错会匹配到别人）。
  const { data: client, error: clientErr } = await supabaseAdmin
    .from('clients')
    .select('id, default_phone_country')
    .eq('id', body.clientId)
    .maybeSingle()

  if (clientErr) {
    return NextResponse.json({ error: `读取客户配置失败: ${clientErr.message}` }, { status: 500 })
  }
  if (!client) {
    return NextResponse.json({ error: '客户不存在' }, { status: 404 })
  }

  const built = buildIntakeRow(
    { ...body, createdBy: actor },
    {
      defaultPhoneCountry: (client as { default_phone_country: string | null }).default_phone_country,
      now: new Date(),
    },
  )

  if (!built.ok) {
    return NextResponse.json({ error: '校验未通过', details: built.errors }, { status: 400 })
  }

  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from('me_sale_outcomes')
    .insert(built.row)
    .select('id, outcome_kind, review_status, occurred_at, amount_minor, currency, order_ref')
    .single()

  if (insertErr) {
    return NextResponse.json({ error: `写入失败: ${insertErr.message}` }, { status: 500 })
  }

  const row = inserted as { id: string; order_ref: string | null }
  const meta = requestMeta(request)

  // 审计写失败不回滚录入 —— 事实本身已经落库，丢一条日志不该把它撤掉。
  // 但要如实告诉调用方（下面 audit_logged 字段），不假装成功。
  const { error: auditErr } = await supabaseAdmin.from('me_conversion_audit').insert({
    outcome_id: row.id,
    action: 'created',
    actor,
    ip: meta.ip,
    ua: meta.ua,
    detail: {
      source_kind: built.row.source_kind,
      source_ref: built.row.source_ref,
      warnings: built.warnings,
    },
  })

  // 同单号提示：幂等键改用行 id 之后，重复录入只能靠这个提醒人
  // （魏征 v3 复审：同单号手工录两次 = Meta 收两笔 Purchase）。
  let duplicateHint: string | null = null
  if (row.order_ref) {
    const { count } = await supabaseAdmin
      .from('me_sale_outcomes')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', built.row.client_id)
      .eq('order_ref', row.order_ref)

    if ((count ?? 0) > 1) {
      duplicateHint = `单号 ${row.order_ref} 下已有 ${count} 条记录 —— 审核放行前请确认不是重复录入`
    }
  }

  return NextResponse.json(
    {
      outcome: inserted,
      warnings: built.warnings,
      duplicate_hint: duplicateHint,
      audit_logged: !auditErr,
      ...(auditErr ? { audit_error: auditErr.message } : {}),
      next: '已存为待审核。审核放行与发送在 PR3 上线后可用。',
    },
    { status: 201 },
  )
}

export async function GET(request: Request) {
  const guard = await guardAdmin()
  if (guard) return guard

  const admin = await requireAdmin()
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status })

  const { searchParams } = new URL(request.url)
  const clientId = searchParams.get('client_id')
  const status = searchParams.get('review_status')
  const focusId = searchParams.get('id')
  const limit = Math.min(Math.max(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 1), 200)

  if (!clientId || !UUID_RE.test(clientId)) {
    return NextResponse.json({ error: 'client_id 必填且必须是 uuid' }, { status: 400 })
  }

  const deniedScope = assertClientScope(admin.user.email ?? null, clientId)
  if (deniedScope) return deniedScope

  const SELECT_COLUMNS =
    // 🔴 不要在这里加 customer_email / customer_phone。列表页会被截图、投屏。
    //    需要看全的走单条详情（尚未实现）。
    //    也不要加已经不存在的列：dispatched_at 随异步队列一起删了，
    //    留在这里会让整个查询报 42703，页面恒空 —— 2026-09-05 魏征实测抓到。
    // contact_id 本身不是 PII（内部 UUID），前端拿它跳转去客户管理页看这个人是谁——
    // 不是"看全"，只是给一个入口，跟上面那条注释挡的东西不冲突。
    // customer_first：PM 反馈"看不到名字没法判断该不该批"——名字不是邮箱/电话
    // 那种直接联系方式（截图出去也不能拿它联系/骚扰这个人），且这个人的姓名本来
    // 就已经在联系人管理页上明摆着（上面那条链接点进去就是），这里显示不构成
    // 新增泄露面，只是省一次跳转。
    'id, outcome_kind, order_ref, amount_minor, currency, occurred_at, ' +
    'review_status, reject_reason, redacted_at, source_kind, created_at, contact_id, customer_first, ' +
    'me_conversion_writebacks(id, status, last_error, next_attempt_at)'

  // 深链目标查询：今日待办邮件里的 ?focus=<id> 指向的记录可能比列表的
  // limit/排序窗口更老（积压超过 limit 条时会被挤出默认列表）。
  // 按 id 直查不受 limit/排序影响，保证深链一定能落到该条，而不是靠调高 limit 碰运气
  // （Codex 复审重提旧评论 2026-09-07：把上限从 50 提到 200 治标不治本）。
  if (focusId) {
    if (!UUID_RE.test(focusId)) {
      return NextResponse.json({ error: 'id 必须是 uuid' }, { status: 400 })
    }
    const { data, error } = await supabaseAdmin
      .from('me_sale_outcomes')
      .select(SELECT_COLUMNS)
      .eq('client_id', clientId)
      .eq('id', focusId)
      .maybeSingle()
    if (error) {
      return NextResponse.json({ error: `查询失败: ${error.message}` }, { status: 500 })
    }
    const outcomes = data ? [data] : []
    return NextResponse.json({ outcomes, count: outcomes.length })
  }

  const sendStatus = searchParams.get('send_status')
  const sendStatuses = sendStatus ? sendStatus.split(',').map((s) => s.trim()).filter(Boolean) : []

  let query = supabaseAdmin
    .from('me_sale_outcomes')
    // send_status 给了就用 inner join 把过滤条件下推到 SQL 里，
    // 让 limit 是"筛完之后"的 limit —— 否则待处理的 in_doubt/failed 记录
    // 会先被"最新 N 条"的窗口挤掉，压根轮不到这一步筛选（同一类问题的另一面）。
    .select(sendStatuses.length > 0 ? SELECT_COLUMNS.replace('me_conversion_writebacks(', 'me_conversion_writebacks!inner(') : SELECT_COLUMNS)
    .eq('client_id', clientId)
    .order('occurred_at', { ascending: false })
    .limit(limit)

  if (status) query = query.eq('review_status', status)
  if (sendStatuses.length > 0) query = query.in('me_conversion_writebacks.status', sendStatuses)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: `查询失败: ${error.message}` }, { status: 500 })
  }

  const outcomes = data ?? []
  return NextResponse.json({ outcomes, count: outcomes.length })
}
