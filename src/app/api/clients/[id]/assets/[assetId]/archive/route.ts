/**
 * POST /api/clients/[id]/assets/[assetId]/archive   { archived: boolean }
 *
 * 把一张素材收起来 / 放回来。
 *
 * ── 为什么非有不可（2026-08-05 魏征复审 P0-2）─────────────────────────────
 * 面板底部、migration 注释、触发器报错文案，三处都在说同一句话：
 * 「换图请归档这一条再传新的」。而实测：**全仓没有任何一处写 `archived_at`** ——
 * 只有五处在读的时候把它过滤掉。既没有按钮，也没有接口。
 *
 * 也就是说：中介传错一张照片，产品上**没有任何手段**能让它从这个面板消失。
 * 它会永远挂在「还不能投放」里。这正是 CLAUDE.md 铁律 3 说的「管道不许断头」：
 * 文案告诉人去做一件产品没提供入口的事。
 *
 * ── 归档不是删除，这是刻意的 ─────────────────────────────────────────────
 * 只打一个时间戳，文件和归属一个字节都不动。理由跟触发器同源：**已经投出去的
 * 广告当时用的是哪一张，必须永远查得回来**。真删掉就查不回来了。
 * 所以归档是可逆的（误点一下能放回来），而「改挂房源」「换文件」永远不可逆。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; assetId: string } },
) {
  const { id: clientId, assetId } = params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ error: access.error }, { status: access.status })
  }

  let body: { archived?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof body.archived !== 'boolean') {
    return NextResponse.json({ error: 'archived 必须是 true 或 false' }, { status: 400 })
  }

  // 条件恒带 client_id：换个客户的 assetId 过来也动不了别人的素材。
  const { data, error } = await supabaseAdmin
    .from('client_assets')
    .update({
      archived_at: body.archived ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', assetId)
    .eq('client_id', clientId)
    .select('id, archived_at')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: '找不到这张素材' }, { status: 404 })

  return NextResponse.json({ ok: true, archived: data.archived_at !== null })
}
