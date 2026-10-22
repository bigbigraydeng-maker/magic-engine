import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { renderOnePagerHtml } from '@/lib/tailor-made/summary-render'
import type { TailorMadeItinerary } from '@/lib/tailor-made/types'

/**
 * POST /api/clients/[id]/tailor-made/one-pager-preview
 * 传入行程数据，返回渲染好的「一页摘要」HTML（A4 单页）。
 *
 * 一句话：已经建好的行程单 → 给终端客户 / 同行旅行社分享用的浓缩版
 * （亮点 / 价格 / 日期），不是完整多日行程单。
 *
 * 与 preview / brochure-preview 同构：走 POST 而不是 GET，是因为未保存的
 * 草稿也要能生成；传入的就是编辑器里当前这份 payload，所见即所得。
 */

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  try {
    const body = (await req.json()) as { payload?: TailorMadeItinerary }
    if (!body.payload) {
      return NextResponse.json({ error: '请求缺少 payload' }, { status: 400 })
    }

    const html = await renderOnePagerHtml(body.payload)
    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : '生成失败'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
