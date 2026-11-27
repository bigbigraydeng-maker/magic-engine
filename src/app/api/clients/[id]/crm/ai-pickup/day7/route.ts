/**
 * GET /api/clients/[id]/crm/ai-pickup/day7 — today's "第 7 天跟进信" list (lib/crm/ai-takeover/day7-list.ts). Read-only.
 * The page drafts each letter with the existing AI follow-up writer (`…/email/compose/draft`, kind follow_up) and staff
 * release it through the existing compose route, one guest at a time, where every send check still runs.
 * Same access as the "交给 AI" page.
 */

import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { previewCompose } from '@/lib/microsoft/mail-send-new'
import { createMailNewDeps } from '@/lib/microsoft/mail-send-new-prod'
import { loadTakeoverSince } from '@/lib/crm/ai-takeover/prod'
import { loadDay7List } from '@/lib/crm/ai-takeover/day7-list'
import { loadSiteReading } from '@/lib/crm/email-templates/link-tracking/site-reading-prod'

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

async function loadLastClicks(clientId: string): Promise<Map<string, string>> {
  const reading = await loadSiteReading(supabaseAdmin, clientId, new Date())
  const out = new Map<string, string>()
  for (const [id, r] of reading) if (r.lastClickAt) out.set(id, r.lastClickAt)
  return out
}

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const mailDeps = createMailNewDeps(params.id)
    const list = await loadDay7List(supabaseAdmin, params.id, {
      loadTakeoverSince: () => loadTakeoverSince(params.id),
      loadLastClicks: () => loadLastClicks(params.id),
      loadNames,
      compose: (contactId) => previewCompose({ clientId: params.id, contactId }, mailDeps),
    })
    return NextResponse.json(list)
  } catch (err) {
    console.error('[crm/ai-pickup/day7] 读名单失败:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: '暂时读不到名单，请稍后再试。' }, { status: 503 })
  }
}
