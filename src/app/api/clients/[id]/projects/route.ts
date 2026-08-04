/**
 * 楼盘列表 / 建楼盘 —— Magic Engine 海外地产版独有（2026-08-03）。
 *
 * 三道门，缺一不可：
 *   ① 登录且能看这个客户（requireDashboardClientAccess）
 *   ② 这个客户是地产行业（非地产客户没有「楼盘」这个概念）
 *   ③ 读写恒带 client_id（在 projects-store 里，不在这一层）
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { clientHasIndustryFeature } from '@/lib/clients/industry-guard'
import {
  listProjects,
  createProject,
  countProjectAssets,
  countProjectListings,
  normaliseProjectInput,
} from '@/lib/clients/projects-store'

export const dynamic = 'force-dynamic'

type RouteContext = { params: { id: string } }

async function gate(clientId: string) {
  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }
  if (!(await clientHasIndustryFeature(clientId, 'projects'))) {
    return NextResponse.json(
      { success: false, error: '「楼盘」只适用于房地产中介客户' },
      { status: 403 },
    )
  }
  return null
}

export async function GET(_req: NextRequest, { params }: RouteContext) {
  const blocked = await gate(params.id)
  if (blocked) return blocked

  try {
    const [projects, assetCounts, listingCounts] = await Promise.all([
      listProjects(params.id),
      countProjectAssets(params.id),
      countProjectListings(params.id),
    ])
    return NextResponse.json({ success: true, projects, assetCounts, listingCounts })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('[projects/GET]', message)
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: RouteContext) {
  const blocked = await gate(params.id)
  if (blocked) return blocked

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: '请求内容不是合法 JSON' }, { status: 400 })
  }

  const parsed = normaliseProjectInput(body)
  if (!parsed.ok) {
    return NextResponse.json({ success: false, error: parsed.error }, { status: 400 })
  }
  if (!parsed.value.name) {
    return NextResponse.json({ success: false, error: '新建楼盘必须有名字' }, { status: 400 })
  }

  try {
    const project = await createProject(params.id, parsed.value)
    return NextResponse.json({ success: true, project })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    // 重名是运营会遇到的正常情况，给 409 让界面能分辨，不是 500
    const status = message.includes('同名') ? 409 : 500
    if (status === 500) console.error('[projects/POST]', message)
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
