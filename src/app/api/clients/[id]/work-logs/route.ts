import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

// fde_work_logs 鉴权口径（PM 2026-10-10 拍板「客户可读」）：
//   GET    —— 该客户的成员或 ME 管理员都能读自己这一份；按 params.id 校验归属，换客户编号即 403。
//             非管理员只拿正文，不带 author_email（ME 员工邮箱不外露，与旧门户页口径一致）。
//   POST / DELETE —— 只有 ME 管理员（tier === 'admin'，受限管理员仅限自己那一个客户）。
// 数据库报错原文只进服务端日志，不回给调用方。

interface Params { params: { id: string } }

// GET /api/clients/[id]/work-logs?limit=30
export async function GET(_req: NextRequest, { params }: Params) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error, reason: access.reason },
      { status: access.status }
    )
  }

  const canWrite = access.tier === 'admin'

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

  if (canWrite) {
    return NextResponse.json({ logs: data ?? [], canWrite: true })
  }

  const logs = (data ?? []).map((row) => ({
    id: row.id,
    log_date: row.log_date,
    summary: row.summary,
    created_at: row.created_at,
  }))
  return NextResponse.json({ logs, canWrite: false })
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

  if (access.tier !== 'admin') {
    return NextResponse.json({ error: 'Forbidden', reason: 'admin_only' }, { status: 403 })
  }

  const author_email = (access.user.email ?? '').toLowerCase().trim()
  if (!author_email) {
    return NextResponse.json({ error: 'Forbidden', reason: 'missing_email' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as { summary?: unknown; log_date?: unknown }

  const summary = typeof body.summary === 'string' ? body.summary.trim() : ''
  if (!summary) {
    return NextResponse.json({ error: 'summary required' }, { status: 400 })
  }

  let log_date: string
  if (typeof body.log_date === 'string') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.log_date)) {
      return NextResponse.json({ error: 'log_date must be YYYY-MM-DD' }, { status: 400 })
    }
    log_date = body.log_date
  } else if (body.log_date === undefined || body.log_date === null) {
    log_date = new Date().toISOString().slice(0, 10)
  } else {
    return NextResponse.json({ error: 'log_date must be YYYY-MM-DD' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('fde_work_logs')
    .insert({ client_id: params.id, summary, log_date, author_email })
    .select('id, log_date, summary, author_email, created_at')
    .single()

  if (error) {
    console.error('[work-logs POST] insert failed:', error)
    return NextResponse.json({ error: 'work_logs_write_failed' }, { status: 500 })
  }

  return NextResponse.json({ log: data }, { status: 201 })
}
