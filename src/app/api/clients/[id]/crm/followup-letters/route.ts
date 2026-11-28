/**
 * GET /api/clients/[id]/crm/followup-letters — today's "跟进信" list (lib/crm/followup-progress/letter-list.ts). Read-only.
 * The page drafts each letter with the existing AI follow-up writer (`…/email/compose/draft`, kind follow_up) and a
 * person releases it through `…/followup-letters/release`, which judges the guest again before the existing send.
 * Same access as the "交给 AI" page. Any read error → 503: this list decides who is written to.
 */

import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { loadLetterList } from '@/lib/crm/followup-progress/letter-list'
import { createLetterListDeps } from '@/lib/crm/followup-progress/letter-list-prod'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const now = new Date()
    return NextResponse.json(await loadLetterList(await createLetterListDeps(supabaseAdmin, params.id, now), now))
  } catch (err) {
    console.error('[crm/followup-letters] 读名单失败:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: '暂时读不到名单，请稍后再试。' }, { status: 503 })
  }
}
