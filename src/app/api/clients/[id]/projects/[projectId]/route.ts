/**
 * 改楼盘（改名 / 改状态 / 填开票信息）。
 *
 * 没有 DELETE：楼盘删了,挂在它下面的素材 project_id 会被置空,那些素材就从
 * 「只能用于本楼盘」变成「哪都能用」—— 一次误删就把红线打开了。要停就改状态成
 * 归档,数据留着、隔离照旧生效。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { clientHasIndustryFeature } from '@/lib/clients/industry-guard'
import { updateProject, normaliseProjectInput } from '@/lib/clients/projects-store'

export const dynamic = 'force-dynamic'

type RouteContext = { params: { id: string; projectId: string } }

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }
  if (!(await clientHasIndustryFeature(params.id, 'projects'))) {
    return NextResponse.json(
      { success: false, error: '「楼盘」只适用于房地产中介客户' },
      { status: 403 },
    )
  }

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

  try {
    const project = await updateProject(params.id, params.projectId, parsed.value)
    if (!project) {
      // 查不到 = 楼盘不存在,或者不属于这个中介。两种情况都回 404,
      // 不告诉调用方「存在但不是你的」—— 那等于确认了别家楼盘 id 的有效性。
      return NextResponse.json({ success: false, error: '楼盘不存在' }, { status: 404 })
    }
    return NextResponse.json({ success: true, project })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const status = message.includes('同名') ? 409 : 500
    if (status === 500) console.error('[projects/PATCH]', message)
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
