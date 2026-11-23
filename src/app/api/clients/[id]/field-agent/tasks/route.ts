import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { createCompetitorAdsTask } from '@/lib/field-agent/tasks'
import { loadCompetitors } from '@/lib/web-intelligence/targets'

type Context = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Context) {
  const { id } = await params
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (access.role !== 'admin') return NextResponse.json({ error: '需要管理员才能请求采集。' }, { status: 403 })
  let body: unknown = {}
  try { body = await req.json() } catch { body = null }
  if (body == null) return NextResponse.json({ ok: false, dispatched: false, task_id: null, message: '请求格式不对。' }, { status: 400 })
  try {
    const competitors = await loadCompetitors(id)
    const result = await createCompetitorAdsTask({
      clientId: id,
      requestedByEmail: access.user.email,
      body,
      competitors,
    })
    return NextResponse.json({
      ok: result.ok,
      dispatched: result.dispatched,
      task_id: result.task_id,
      status: result.status,
      message: result.message,
    }, { status: result.httpStatus })
  } catch {
    return NextResponse.json({ ok: false, dispatched: false, task_id: null, message: '采集任务没有建立，请稍后重试。' }, { status: 503 })
  }
}
