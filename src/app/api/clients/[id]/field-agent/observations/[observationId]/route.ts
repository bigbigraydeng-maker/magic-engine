import { NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { reviewAdObservation } from '@/lib/field-agent/observations'

type Context = { params: Promise<{ id: string; observationId: string }> }

const bodySchema = z.object({
  review_status: z.enum(['approved', 'rejected']),
  review_notes: z.string().max(2000).optional(),
}).strict()

export async function POST(req: Request, { params }: Context) {
  const { id, observationId } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(observationId)) {
    return NextResponse.json({ error: '找不到这条广告。' }, { status: 404 })
  }
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (access.role !== 'admin') return NextResponse.json({ error: '需要管理员才能审核。' }, { status: 403 })
  const reviewer = access.user.email?.trim()
  if (!reviewer) return NextResponse.json({ error: '当前登录没有邮箱，不能审核。' }, { status: 403 })
  let raw: unknown
  try { raw = await req.json() } catch { return NextResponse.json({ error: '请求格式不对。' }, { status: 400 }) }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) return NextResponse.json({ error: '请选择通过或驳回。' }, { status: 400 })
  const notes = parsed.data.review_notes?.trim() ? parsed.data.review_notes.trim() : null
  try {
    const outcome = await reviewAdObservation({
      clientId: id,
      observationId,
      reviewStatus: parsed.data.review_status,
      reviewNotes: notes,
      reviewedBy: reviewer,
    })
    if (outcome === 'missing') return NextResponse.json({ error: '这条广告不在待审列表里。' }, { status: 409 })
    return NextResponse.json({ ok: true, review_status: parsed.data.review_status })
  } catch {
    return NextResponse.json({ error: '审核没有保存，请稍后重试。' }, { status: 503 })
  }
}
