import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { rejectAgentAdsBearer } from '@/lib/auth/agent-ads-guard'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { createKernel } from '@/lib/kernel'
import { isUuid } from '@/lib/validation-utils'
import { assertMayClick, clickerFromSession, type CardClicker } from '@/lib/confirmation-card'
import { publicError } from '@/lib/confirmation-card/http'
import { loadPausedDraftContext } from '@/lib/ads-strategy/paused-draft-context'

export async function pausedDraftGate(
  req: Request,
  clientId: string,
): Promise<{ ok: true; clicker: CardClicker } | { ok: false; response: NextResponse }> {
  const denied = await rejectAgentAdsBearer(req, { clientId, action: 'write_meta' })
  if (denied) return { ok: false, response: denied }
  if (!isUuid(clientId)) {
    return { ok: false, response: NextResponse.json({ error: '这个地址不对。' }, { status: 400 }) }
  }
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    const message = access.status === 401 ? '请先登录。' : '你不能替这位客户建广告草稿。'
    return { ok: false, response: NextResponse.json({ error: message }, { status: access.status }) }
  }
  const clicker = clickerFromSession({
    email: access.user.email ?? '',
    role: access.role,
    allowedClientId: access.allowedClientId,
    clientId,
    agentMarked: req.headers.get('x-me-actor') === 'agent',
  })
  try {
    assertMayClick(clicker, clientId)
  } catch (error) {
    const mapped = publicError(error)
    return { ok: false, response: NextResponse.json({ error: mapped.message }, { status: mapped.status }) }
  }
  return { ok: true, clicker }
}

export function kernel() {
  return createKernel(supabaseAdmin)
}

export async function clientAds(clientId: string): Promise<
  | { ok: false; response: NextResponse }
  | { ok: true; adAccountId: string; pageId: string; country: string | null; industry: string | null }
> {
  const { data } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id, facebook_page_id, country, industry')
    .eq('id', clientId)
    .maybeSingle()
  const row = data as {
    meta_ad_account_id?: string | null
    facebook_page_id?: string | null
    country?: string | null
    industry?: string | null
  } | null
  if (!row?.meta_ad_account_id) {
    return { ok: false, response: NextResponse.json({ error: '这个客户还没配广告账户。' }, { status: 424 }) }
  }
  if (!row.facebook_page_id) {
    return { ok: false, response: NextResponse.json({ error: '这个客户还没配 Facebook 主页。' }, { status: 424 }) }
  }
  return {
    ok: true,
    adAccountId: row.meta_ad_account_id,
    pageId: row.facebook_page_id,
    country: row.country ?? null,
    industry: row.industry ?? null,
  }
}

export async function cardContext(clientId: string, adAccountId: string) {
  return loadPausedDraftContext(supabaseAdmin, clientId, adAccountId)
}
