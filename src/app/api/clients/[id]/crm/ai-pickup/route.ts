/**
 * GET /api/clients/[id]/crm/ai-pickup — today's "交给 AI 跟进" list (lib/crm/ai-takeover/pickup-list.ts). Read-only.
 * Sending goes through the existing per-guest catalogue-send route, one guest at a time, from the page.
 * Same access as the catalogue button. `CRM_AI_PICKUP_DAILY_MAX` caps the day's list (default 30).
 */

import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { loadClientTimeZone } from '@/lib/crm/email-templates/time-zone'
import { previewCompose } from '@/lib/microsoft/mail-send-new'
import { createMailNewDeps } from '@/lib/microsoft/mail-send-new-prod'
import { loadPickupList } from '@/lib/crm/ai-takeover/pickup-list'
import { todayInZone } from '@/lib/crm/email-templates/send-gates'
import { pickupSwitches } from '@/lib/crm/ai-takeover/pickup-run'
import { loadCatalogue } from '@/lib/crm/ai-takeover/view'
import { guestsWithCatalogue } from '@/lib/crm/catalogue-line/prod'
import { CATALOGUE_ONCE_DAYS } from '@/lib/crm/catalogue-line/send-catalogue'

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

/** Catalogue sends today (sent, or outcome not yet known), counted in the client's own day. */
async function sentToday(clientId: string, timeZone: string, today: string): Promise<number> {
  const { data, error } = await supabaseAdmin.from('crm_email_send_receipts').select('created_at')
    .eq('client_id', clientId).like('template_key', 'catalogue%').in('outcome', ['sent', 'unknown'])
    .gte('created_at', new Date(Date.now() - 36 * 3_600_000).toISOString()).limit(1000)
  if (error) throw new Error(`crm_email_send_receipts: ${error.message}`)
  return ((data ?? []) as Array<{ created_at: string }>).filter((r) => todayInZone(new Date(r.created_at), timeZone) === today).length
}

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const [catalogue, timeZone] = await Promise.all([loadCatalogue(params.id), loadClientTimeZone(supabaseAdmin, params.id)])
    const { dailyMax } = pickupSwitches(process.env)
    const mailDeps = createMailNewDeps(params.id)
    const rows = await loadPickupList(supabaseAdmin, params.id, {
      timeZone,
      loadNames,
      sentToday: (today) => sentToday(params.id, timeZone, today),
      hasCatalogue: async (ids) => catalogue === null ? new Set<string>() : guestsWithCatalogue(supabaseAdmin, {
        clientId: params.id, templateKey: catalogue.templateKey, contactIds: ids,
        sinceIso: new Date(Date.now() - CATALOGUE_ONCE_DAYS * 86_400_000).toISOString(),
      }),
      compose: (contactId) => previewCompose({ clientId: params.id, contactId }, mailDeps),
    }, { dailyMax })
    return NextResponse.json({ catalogue, dailyMax, rows })
  } catch (err) {
    console.error('[crm/ai-pickup] 读名单失败:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: '暂时读不到名单，请稍后再试。' }, { status: 503 })
  }
}
