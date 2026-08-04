import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { deleteItinerary, getItinerary, saveItinerary } from '@/lib/tailor-made/store'
import type { TailorMadeItinerary, TailorMadeStatus } from '@/lib/tailor-made/types'

/**
 * /api/clients/[id]/tailor-made/[quoteId]
 * GET    读取单份
 * PUT    保存（可同时改状态）
 * DELETE 删除
 */

export const dynamic = 'force-dynamic'

type Ctx = { params: { id: string; quoteId: string } }

export async function GET(_req: NextRequest, { params }: Ctx) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const record = await getItinerary(params.id, params.quoteId)
    if (!record) return NextResponse.json({ error: '行程单不存在' }, { status: 404 })
    return NextResponse.json({ item: record })
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: Ctx) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const body = (await req.json()) as {
      payload?: TailorMadeItinerary
      status?: TailorMadeStatus
    }
    if (!body.payload) {
      return NextResponse.json({ error: '请求缺少 payload' }, { status: 400 })
    }

    const record = await saveItinerary(params.id, params.quoteId, body.payload, body.status)
    return NextResponse.json({ item: record })
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500 })
  }
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    await deleteItinerary(params.id, params.quoteId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 500 })
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误'
}
