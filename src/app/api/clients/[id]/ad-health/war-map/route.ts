/**
 * GET /api/clients/[id]/ad-health/war-map
 *
 * 广告作战地图 S1：把库里已经每天算好的几张表拼成一张「观众池 / 频率 / 今天要调什么」的整体视图。
 * 只读，不建表、不加定时任务。设计稿：docs/specs/2026-10-16-ads-war-map-page-design-v0.1.md
 *
 * 🔴 S1 只给内部员工看（不受限的管理员）。其余人一律 403，fail-closed：
 *    观众池、频率、内部诊断都是内部结论，客户版是 S3，要另做裁剪。
 * 🔴 读失败回 500 + error，由页面说「读不到」；不许回一份空视图冒充「没有」。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { loadWarMapInput } from '@/lib/ads-strategy/war-map/load'
import { buildWarMap } from '@/lib/ads-strategy/war-map/build'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  // fail-closed：只有不受限的管理员能看；demo / 限定单客户的管理员也不行。
  const fullView = access.tier === 'admin' && access.allowedClientId === null
  if (!fullView) {
    return NextResponse.json({ error: '作战地图暂只对内部员工开放' }, { status: 403 })
  }

  try {
    const input = await loadWarMapInput(clientId, new Date())
    return NextResponse.json({ success: true, view: buildWarMap(input) })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.warn('[api/ad-health/war-map] 读取失败', { clientId, error: message })
    // 🔴 原始报错（可能带表名、列名）只进日志，不回浏览器。
    return NextResponse.json({ error: '读不到作战地图，稍后再试；持续读不出来找开发' }, { status: 500 })
  }
}
