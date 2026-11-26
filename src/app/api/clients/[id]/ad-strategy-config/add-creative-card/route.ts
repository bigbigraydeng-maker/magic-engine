/**
 * Turn the add-creative card on or off for one client. Off is the default.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireOperatorAccess } from '@/lib/auth/client-access'
import { isUuid } from '@/lib/validation-utils'
import { readCreativeSwitch, writeCreativeSwitch } from '@/lib/ads-creative-card/switch'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return NextResponse.json({ error: '这个地址不对。' }, { status: 400 })
  const access = await requireOperatorAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? '请先登录。' : '你不能改这个开关。' }, { status: access.status })
  const state = await readCreativeSwitch(supabaseAdmin, params.id)
  if (state === 'unreadable') return NextResponse.json({ error: '开关读不到。' }, { status: 409 })
  return NextResponse.json({ enabled: state === 'on' })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return NextResponse.json({ error: '这个地址不对。' }, { status: 400 })
  const access = await requireOperatorAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.status === 401 ? '请先登录。' : '你不能改这个开关。' }, { status: access.status })
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '请求内容读不懂，没有收下。' }, { status: 400 })
  }
  if (!raw || typeof raw !== 'object' || typeof (raw as { enabled?: unknown }).enabled !== 'boolean') {
    return NextResponse.json({ error: '请写明开还是关。' }, { status: 400 })
  }
  if (Object.keys(raw as object).some((key) => key !== 'enabled')) {
    return NextResponse.json({ error: '请求里带了开关不认识的内容，没有收下。' }, { status: 400 })
  }
  const state = await writeCreativeSwitch(supabaseAdmin, params.id, (raw as { enabled: boolean }).enabled)
  if (state === 'unreadable') return NextResponse.json({ error: '开关没写成。' }, { status: 409 })
  return NextResponse.json({ enabled: state === 'on' })
}
