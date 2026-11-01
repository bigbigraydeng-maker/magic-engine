/**
 * Session gate for pause cards. Agents cannot ask for or press one.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { rejectAgentAdsBearer } from '@/lib/auth/agent-ads-guard'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { createKernel } from '@/lib/kernel'
import { isUuid } from '@/lib/validation-utils'
import { assertMayClick, clickerFromSession, type CardClicker } from '@/lib/confirmation-card'
import { publicError } from '@/lib/confirmation-card/http'

export async function pauseCardGate(
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
    const message = access.status === 401 ? '请先登录。' : '你不能替这位客户暂停广告。'
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

export function pauseKernel() {
  return createKernel(supabaseAdmin)
}
