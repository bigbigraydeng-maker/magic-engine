/**
 * GET   /api/clients/[id]/crm/contacts/[cid]/profile        客人档案（名字 / 昵称 / 邮箱 / 电话）
 * PATCH /api/clients/[id]/crm/contacts/[cid]/profile        改名字  Body: { name: string | null }（空串 / null = 清空）
 *
 * 设计稿：docs/specs/2026-10-22-crm-contact-profile-design-v0.md。鉴权与隔离照 `important` / `stage` 路由：
 * 登录 + 有这个客户的权限；contact 必须属于 path 上的 client，否则 404。
 *
 * Responses: 200 { profile } / 400 / 401 / 403 / 404 / 500
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { loadProfile, parseProfileName, setProfileName } from '@/lib/crm/profile'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: { id: string; cid: string }
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const profile = await loadProfile(supabaseAdmin, params.id, params.cid)
    if (!profile) return NextResponse.json({ error: '找不到这个客人' }, { status: 404 })
    return NextResponse.json({ profile })
  } catch {
    return NextResponse.json({ error: '读取失败' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: { name?: unknown }
  try {
    body = (await req.json()) as { name?: unknown }
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || !('name' in body)) {
    return NextResponse.json({ error: '缺少 name' }, { status: 400 })
  }
  const parsed = parseProfileName(body.name)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const result = await setProfileName(supabaseAdmin, params.id, params.cid, parsed.value)
  if (result === 'not_found') return NextResponse.json({ error: '找不到这个客人' }, { status: 404 })
  if (result === 'error') return NextResponse.json({ error: '保存失败，请稍后再试' }, { status: 500 })

  const profile = await loadProfile(supabaseAdmin, params.id, params.cid)
  return NextResponse.json({ profile })
}
