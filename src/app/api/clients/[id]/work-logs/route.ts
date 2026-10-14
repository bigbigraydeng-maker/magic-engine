import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

// fde_work_logs 鉴权口径（PM 2026-10-11「先关」，替代 10-10 的「客户可读」）：
//   GET / POST / DELETE 一律只给 ME 管理员（tier === 'admin'，受限管理员仅限自己那一个客户）。
//   客户成员（付费、免费、门户）读也是 403 —— 现有日志大多含内部用语，
//   等日志分成「对内 / 对客户」两类之后再考虑重新开放，届时改这里并补测试。
// 归属按 params.id 校验，换客户编号即 403。数据库报错原文只进服务端日志，不回给调用方。

interface Params { params: { id: string } }

// 会话必须带邮箱：邮箱为空的会话在管理员名单配置有空项时会被误判成管理员（狄仁杰 2026-10-10 实证），
// 所以这里不信 tier，先拦掉。共享守卫层的根治另行处理。
function hasEmail(email: string | undefined | null): boolean {
  return typeof email === 'string' && email.trim().length > 0
}

// 真实日历日期才算数：'2026-13-45' 形状对但不是日期，必须 400，不能落到数据库再报 500。
function parseLogDate(raw: unknown): { ok: true; value: string } | { ok: false } {
  if (raw === undefined || raw === null) return { ok: true, value: new Date().toISOString().slice(0, 10) }
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { ok: false }
  const parsed = new Date(`${raw}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) return { ok: false }
  return { ok: true, value: raw }
}

const MAX_SUMMARY_LENGTH = 5000

// GET /api/clients/[id]/work-logs?limit=30
export async function GET(_req: NextRequest, { params }: Params) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error, reason: access.reason },
      { status: access.status }
    )
  }

  if (!hasEmail(access.user.email)) {
    return NextResponse.json({ error: 'Forbidden', reason: 'missing_email' }, { status: 403 })
  }

  if (access.tier !== 'admin') {
    return NextResponse.json({ error: 'Forbidden', reason: 'admin_only' }, { status: 403 })
  }

  const { data, error } = await supabaseAdmin
    .from('fde_work_logs')
    .select('id, log_date, summary, author_email, created_at')
    .eq('client_id', params.id)
    .order('log_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(60)

  if (error) {
    console.error('[work-logs GET] query failed:', error)
    return NextResponse.json({ error: 'work_logs_read_failed' }, { status: 500 })
  }

  return NextResponse.json({ logs: data ?? [], canWrite: true })
}

// POST /api/clients/[id]/work-logs  { summary, log_date? }
export async function POST(req: NextRequest, { params }: Params) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error, reason: access.reason },
      { status: access.status }
    )
  }

  if (!hasEmail(access.user.email)) {
    return NextResponse.json({ error: 'Forbidden', reason: 'missing_email' }, { status: 403 })
  }

  if (access.tier !== 'admin') {
    return NextResponse.json({ error: 'Forbidden', reason: 'admin_only' }, { status: 403 })
  }

  const author_email = (access.user.email ?? '').toLowerCase().trim()

  const raw: unknown = await req.json().catch(() => null)
  const body: { summary?: unknown; log_date?: unknown } =
    raw !== null && typeof raw === 'object' ? raw : {}

  const summary = typeof body.summary === 'string' ? body.summary.trim() : ''
  if (!summary) {
    return NextResponse.json({ error: 'summary required' }, { status: 400 })
  }

  if (summary.length > MAX_SUMMARY_LENGTH) {
    return NextResponse.json({ error: 'summary too long' }, { status: 400 })
  }

  const logDate = parseLogDate(body.log_date)
  if (!logDate.ok) {
    return NextResponse.json({ error: 'log_date must be YYYY-MM-DD' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('fde_work_logs')
    .insert({ client_id: params.id, summary, log_date: logDate.value, author_email })
    .select('id, log_date, summary, author_email, created_at')
    .single()

  if (error) {
    console.error('[work-logs POST] insert failed:', error)
    return NextResponse.json({ error: 'work_logs_write_failed' }, { status: 500 })
  }

  return NextResponse.json({ log: data }, { status: 201 })
}
