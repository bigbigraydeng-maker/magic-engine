/**
 * POST /api/clients/[id]/crm/assignees/transfer
 *
 * 把一位同事名下的客人整批转给另一位（交接）。只动 `contacts.assigned_to`，不碰阶段、不碰任何记录。
 *
 * 只有内部管理员能用：一次能改上千位客人，不该给每个员工账号。
 * `to` 必须在跟进人候选名单里（跟单个改同一套校验），`to: null` = 转成「没人跟进」。
 * `from` 可以是离职同事的邮箱（不要求还在候选名单里）。
 * `dryRun: true` 只返回会动多少位，不写库——界面先预览、再确认。
 *
 * Body: { from: string, to: string | null, dryRun?: boolean }
 * Responses: 200 { from, to, count, dryRun } / 400 / 401 / 403 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireOperatorAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { listAssignees } from '@/lib/crm/lead-assignee'

export const dynamic = 'force-dynamic'

function cleanEmail(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string') return undefined
  const v = value.toLowerCase().trim()
  return v.length === 0 ? null : v
}

/** ilike 里 % _ \\ 是通配符；邮箱常含下划线，不转义会误伤别人 */
function exactIlike(email: string): string {
  return email.replace(/[\\%_]/g, (c) => `\\${c}`)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
  const clientId = params.id
  const access = await requireOperatorAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: { from?: unknown; to?: unknown; dryRun?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }
  const from = cleanEmail(body.from)
  const to = cleanEmail(body.to)
  if (!from) return NextResponse.json({ error: 'from 必须是邮箱' }, { status: 400 })
  if (to === undefined) return NextResponse.json({ error: 'to 必须是邮箱或 null' }, { status: 400 })
  if (to === from) return NextResponse.json({ error: '转出和转入是同一个人' }, { status: 400 })
  const dryRun = body.dryRun === true

  try {
    if (to !== null) {
      const candidates = await listAssignees({ clientId, supabase: supabaseAdmin })
      if (!candidates.some((c) => c.email.toLowerCase() === to)) {
        return NextResponse.json({ error: '这个邮箱不在当前客户的跟进人名单里' }, { status: 400 })
      }
    }

    if (dryRun) {
      const { count, error } = await supabaseAdmin
        .from('contacts')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
        .ilike('assigned_to', exactIlike(from))
      if (error) throw error
      return NextResponse.json({ from, to, count: count ?? 0, dryRun: true })
    }

    const { data, error } = await supabaseAdmin
      .from('contacts')
      .update({ assigned_to: to })
      .eq('client_id', clientId)
      .ilike('assigned_to', exactIlike(from))
      .select('id')
    if (error) throw error
    const count = data?.length ?? 0
    console.info(`[crm/assignees/transfer] client=${clientId} by=${access.user.email} ${from} -> ${to ?? '(none)'} count=${count}`)
    return NextResponse.json({ from, to, count, dryRun: false })
  } catch (err) {
    console.error('[crm/assignees/transfer]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: '操作失败' }, { status: 500 })
  }
}
