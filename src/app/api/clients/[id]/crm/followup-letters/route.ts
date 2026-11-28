/**
 * GET /api/clients/[id]/crm/followup-letters — today's "跟进信" list (lib/crm/followup-progress/letter-list.ts). Read-only.
 * The page drafts each letter with the existing AI follow-up writer (`…/email/compose/draft`, kind follow_up) and a
 * person releases it through the existing compose route, one guest at a time, where every send check still runs.
 * Same access as the "交给 AI" page. Any read error → 503: this list decides who is written to.
 */

import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { previewCompose } from '@/lib/microsoft/mail-send-new'
import { createMailNewDeps } from '@/lib/microsoft/mail-send-new-prod'
import { loadClientTimeZone } from '@/lib/crm/email-templates/time-zone'
import { loadContactNames } from '@/lib/crm/enquiry-daily-load'
import { loadFollowupProgress } from '@/lib/crm/followup-progress/load'
import { loadLastSendsFromLog, loadLetterList } from '@/lib/crm/followup-progress/letter-list'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const now = new Date()
    const mailDeps = createMailNewDeps(params.id)
    const list = await loadLetterList({
      timeZone: await loadClientTimeZone(supabaseAdmin, params.id),
      loadProgress: () => loadFollowupProgress(supabaseAdmin, params.id, now),
      loadLastSends: (ids) => loadLastSendsFromLog(supabaseAdmin, params.id, ids),
      loadNames: (ids) => loadContactNames(supabaseAdmin, params.id, ids),
      compose: (contactId) => previewCompose({ clientId: params.id, contactId }, mailDeps),
    }, now)
    return NextResponse.json(list)
  } catch (err) {
    console.error('[crm/followup-letters] 读名单失败:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: '暂时读不到名单，请稍后再试。' }, { status: 503 })
  }
}
