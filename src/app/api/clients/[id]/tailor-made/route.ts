import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { createItinerary, listItineraries } from '@/lib/tailor-made/store'
import type { TailorMadeItinerary } from '@/lib/tailor-made/types'

/**
 * /api/clients/[id]/tailor-made
 * GET  该客户的行程单列表
 * POST 新建（可传 source 以复制已有行程为蓝本）
 *
 * middleware 不覆盖 /api/*，鉴权必须在这里自己做。
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const includeArchived = req.nextUrl.searchParams.get('archived') === '1'
    return NextResponse.json({ items: await listItineraries(params.id, includeArchived) })
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const body = (await req.json().catch(() => ({}))) as { source?: TailorMadeItinerary }
    const record = await createItinerary(params.id, body.source)
    return NextResponse.json({ item: record }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500 })
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}
