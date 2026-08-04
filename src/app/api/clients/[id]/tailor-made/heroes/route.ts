import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { HERO_CHOICES, loadHeroDataUri } from '@/lib/tailor-made/hero'

/**
 * GET /api/clients/[id]/tailor-made/heroes
 *   → { choices }                 可选封面清单
 * GET ...?name=chongqing
 *   → { name, dataUri }           取某张图，供顾问手动换封面
 *
 * 系统会按目的地自动选，但一定有猜错的时候（「重庆+张家界」哪个当主打？）。
 * 静默选错顾问未必注意到，直到客人收到才发现 —— 所以界面上要显示
 * 「系统选了重庆」并给一个换的入口。
 */

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const name = req.nextUrl.searchParams.get('name')
  if (!name) return NextResponse.json({ choices: HERO_CHOICES })

  const dataUri = await loadHeroDataUri(name)
  if (!dataUri) return NextResponse.json({ error: '没有这张封面图' }, { status: 404 })
  return NextResponse.json({ name, dataUri })
}
