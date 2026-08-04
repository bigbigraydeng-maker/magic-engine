import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { expandDay } from '@/lib/tailor-made/expand-day'
import type { TailorMadeDay, TailorMadeItinerary } from '@/lib/tailor-made/types'

/**
 * POST /api/clients/[id]/tailor-made/expand-day
 *
 * 把某一天的正文展开写细。返回新正文，不落库 —— 顾问看过、点保存才算数。
 *
 * Body: { day, trip, instruction? }
 * Responses: 200 { body, note } / 400 / 401 / 403 / 502
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: { day?: TailorMadeDay; trip?: TailorMadeItinerary['trip']; instruction?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  if (!body.day || !body.trip) {
    return NextResponse.json({ error: '缺少 day 或 trip' }, { status: 400 })
  }

  try {
    const result = await expandDay({
      day: body.day,
      trip: body.trip,
      instruction: typeof body.instruction === 'string' ? body.instruction.slice(0, 500) : undefined,
    })
    return NextResponse.json(result)
  } catch (error) {
    const msg = error instanceof Error ? error.message : '展开失败'
    console.error('[tailor-made/expand-day]', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
