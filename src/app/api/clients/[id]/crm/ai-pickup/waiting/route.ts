/**
 * GET /api/clients/[id]/crm/ai-pickup/waiting — the numbers behind the staff reminder bar. Read-only.
 *
 * Counts only: no guest names, no emails, no phone numbers. Same access as the release page.
 *   waiting          guests queued on the "交给 AI 跟进" page (the pickup rules + staff notes asking for the catalogue,
 *                    minus guests who already have the catalogue) — the same loader the daily to-do uses
 *   readyToday       how many of them can still go today: min(waiting, dailyMax − catalogues already sent today)
 *   daysSinceRelease days since anybody last released (an AI mark or a catalogue actually sent); null = never
 *
 * `waiting` is the queue, not what the page offers at this minute: the page also holds back guests contacted today and
 * guests the mail check refuses, and those are only known by running the mail check per guest. The bar therefore shows
 * only while `readyToday > 0`, and says "today".
 *
 * The answer is kept for a few minutes per client: the read walks every recent enquiry, and the bar is on every CRM page.
 */

import { NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { supabaseAdmin } from '@/lib/supabase'
import { pickupSwitches } from '@/lib/crm/ai-takeover/pickup-run'
import { cataloguesSentToday } from '@/lib/crm/ai-takeover/sent-today'
import { todayInZone } from '@/lib/crm/email-templates/send-gates'
import { loadClientTimeZone } from '@/lib/crm/email-templates/time-zone'
import { defaultAiPickupWaitingDeps } from '@/lib/pm-todo/ai-pickup-waiting-items'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Answer { waiting: number; readyToday: number; dailyMax: number; daysSinceRelease: number | null }

const KEEP_MS = 5 * 60_000
const kept = new Map<string, { at: number; answer: Answer }>()

/** Tests only. */
export function clearWaitingCache(): void {
  kept.clear()
}

async function read(clientId: string, now: Date): Promise<Answer> {
  const { dailyMax } = pickupSwitches(process.env)
  const w = await defaultAiPickupWaitingDeps.load(supabaseAdmin, clientId, now)
  if (w === null || w.waiting <= 0) return { waiting: 0, readyToday: 0, dailyMax, daysSinceRelease: w?.daysSinceRelease ?? null }
  const timeZone = await loadClientTimeZone(supabaseAdmin, clientId)
  const sent = await cataloguesSentToday(supabaseAdmin, clientId, timeZone, todayInZone(now, timeZone))
  return { waiting: w.waiting, readyToday: Math.min(w.waiting, Math.max(0, dailyMax - sent)), dailyMax, daysSinceRelease: w.daysSinceRelease }
}

export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  try {
    const now = new Date()
    const hit = kept.get(params.id)
    if (hit !== undefined && now.getTime() - hit.at < KEEP_MS) return NextResponse.json(hit.answer)
    const answer = await read(params.id, now)
    kept.set(params.id, { at: now.getTime(), answer })
    return NextResponse.json(answer)
  } catch (err) {
    console.error('[crm/ai-pickup/waiting] read failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: '暂时读不到。' }, { status: 503 })
  }
}
