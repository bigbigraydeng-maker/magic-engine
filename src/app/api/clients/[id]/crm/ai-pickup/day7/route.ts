/**
 * GET /api/clients/[id]/crm/ai-pickup/day7 — today's "第 7 天跟进信" list (lib/crm/ai-takeover/day7-list.ts). Read-only.
 * The page drafts each letter with the existing AI follow-up writer (`…/email/compose/draft`, kind follow_up) and staff
 * release it through the existing compose route, one guest at a time, where every send check still runs.
 * Same access as the "交给 AI" page. Any read error → 503: this list decides who is written to.
 */

import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { previewCompose } from '@/lib/microsoft/mail-send-new'
import { createMailNewDeps } from '@/lib/microsoft/mail-send-new-prod'
import { loadClientTimeZone } from '@/lib/crm/email-templates/time-zone'
import { loadDay7List, loadLastClicksStrict, loadLastSendsFromLog } from '@/lib/crm/ai-takeover/day7-list'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

async function loadNames(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await supabaseAdmin.from('contacts').select('id, display_name').in('id', ids.slice(i, i + 100))
    if (error) throw new Error(`contacts: ${error.message}`)
    for (const r of (data ?? []) as Array<{ id: string; display_name: string | null }>) out.set(r.id, r.display_name ?? '')
  }
  return out
}

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const now = new Date()
    const mailDeps = createMailNewDeps(params.id)
    const list = await loadDay7List(supabaseAdmin, params.id, {
      timeZone: await loadClientTimeZone(supabaseAdmin, params.id),
      loadLastClicks: () => loadLastClicksStrict(supabaseAdmin, params.id, now),
      loadLastSends: (ids) => loadLastSendsFromLog(supabaseAdmin, params.id, ids),
      loadNames,
      compose: (contactId) => previewCompose({ clientId: params.id, contactId }, mailDeps),
    }, now)
    return NextResponse.json(list)
  } catch (err) {
    console.error('[crm/ai-pickup/day7] 读名单失败:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: '暂时读不到名单，请稍后再试。' }, { status: 503 })
  }
}
