import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { listAdObservations } from '@/lib/field-agent/observations'

type Context = { params: Promise<{ id: string }> }
const STATUSES = ['pending', 'approved', 'rejected'] as const

export async function GET(req: Request, { params }: Context) {
  const { id } = await params
  const access = await requirePaidClientAccess(id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (access.role !== 'admin') return NextResponse.json({ error: '需要管理员才能查看待审广告。' }, { status: 403 })
  const url = new URL(req.url)
  const requested = url.searchParams.get('review_status') ?? 'pending'
  if (!STATUSES.includes(requested as typeof STATUSES[number])) {
    return NextResponse.json({ error: '审核状态只能是待审、已通过或已驳回。' }, { status: 400 })
  }
  const competitor = (url.searchParams.get('competitor') ?? '').trim().slice(0, 200)
  try {
    const observations = await listAdObservations(id, requested as typeof STATUSES[number], competitor)
    return NextResponse.json({ observations })
  } catch {
    return NextResponse.json({ error: '暂时读不到竞品广告。' }, { status: 503 })
  }
}
