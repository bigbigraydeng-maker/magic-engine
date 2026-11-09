/**
 * 这个广告账户要不要出现在广告健康页。
 *
 * 开 = 显示，超支提醒会盯着它。关 = 健康页不列它，心跳整户跳过，超支提醒不响。
 * 只改 `hidden_from_ad_health`。不改预算、不改投放、不碰 Meta。
 * 谁能改，跟日上限同一个 `requireGlobalAdmin`：内部员工可以，限定在单个客户的管理员不行。
 * 账户必须已经绑在这个客户名下；按行 id 写，两个客户共用同一个账户号时不会改错行。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'

interface BoundAccount {
  id: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function denyUnlessGlobalAdmin(): Promise<NextResponse | null> {
  const admin = await requireGlobalAdmin()
  if (admin.ok) return null
  return NextResponse.json({ error: admin.error }, { status: admin.status })
}

async function readHiddenFlag(
  req: NextRequest,
): Promise<{ ok: true; hidden: boolean } | { ok: false; error: string }> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return { ok: false, error: '请求格式错误' }
  }
  if (!isRecord(body) || !('hidden_from_ad_health' in body)) {
    return { ok: false, error: '请说明这个账户要不要出现在广告健康页' }
  }
  if (typeof body.hidden_from_ad_health !== 'boolean') {
    return { ok: false, error: '这个开关只能是开或者关' }
  }
  return { ok: true, hidden: body.hidden_from_ad_health }
}

async function findBoundAccount(
  clientId: string,
  accountId: string,
): Promise<{ ok: true; account: BoundAccount } | { ok: false; status: number; error: string }> {
  const { data, error } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .select('id')
    .eq('client_id', clientId)
    .eq('ad_account_id', accountId)
    .maybeSingle()
  if (error) return { ok: false, status: 500, error: `查账户绑定失败：${error.message}` }
  if (!data?.id) return { ok: false, status: 404, error: `这个客户没有绑定账户 ${accountId}` }
  return { ok: true, account: { id: String(data.id) } }
}

async function writeVisibility(account: BoundAccount, hidden: boolean): Promise<NextResponse> {
  const { data, error } = await supabaseAdmin
    .from('client_meta_ad_accounts')
    .update({ hidden_from_ad_health: hidden })
    .eq('id', account.id)
    .select('id, client_id, ad_account_id, hidden_from_ad_health')
    .maybeSingle()
  if (error) return NextResponse.json({ error: `写入失败：${error.message}` }, { status: 500 })
  if (!data) return NextResponse.json({ error: '写入后读不到这一行' }, { status: 500 })
  return NextResponse.json({
    id: data.id,
    client_id: data.client_id,
    ad_account_id: data.ad_account_id,
    hidden_from_ad_health: data.hidden_from_ad_health === true,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
): Promise<NextResponse> {
  const { id: clientId, accountId } = await params
  const denied = await denyUnlessGlobalAdmin()
  if (denied) return denied

  const parsed = await readHiddenFlag(req)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const bound = await findBoundAccount(clientId, accountId)
  if (!bound.ok) return NextResponse.json({ error: bound.error }, { status: bound.status })

  return writeVisibility(bound.account, parsed.hidden)
}
