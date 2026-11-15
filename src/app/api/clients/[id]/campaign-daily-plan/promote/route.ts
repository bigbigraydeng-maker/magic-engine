/**
 * POST /api/clients/[id]/campaign-daily-plan/promote
 *
 * The "推广这条帖子" button on a published Daily Plan Post. Admin only.
 * Checks the Post (published, not recalled, public, poster departure not past,
 * not already in the pool ad set) and proposes one winner-sync "add paused"
 * confirmation card in this person's name. It never writes to Meta: the card's
 * confirm creates a paused ad, and opening it is a second card bound to the
 * approved ads plan.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { clickerFromSession } from '@/lib/confirmation-card'
import { supabaseAdmin } from '@/lib/supabase'
import { checkDailyPlanPromotionLive } from '@/lib/campaign/daily-plan-promote-live'
import { proposeWinnerBatch } from '@/lib/winner-reel-sync/propose'

const PromoteCommandSchema = z.object({
  plan_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
}).strict()

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const clientId = params.id
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return NextResponse.json({ success: false, error: access.error }, { status: access.status })
  }
  if (access.role !== 'admin') {
    return NextResponse.json({ success: false, error: 'ADMIN_REQUIRED' }, { status: 403 })
  }
  const parsed = PromoteCommandSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'INVALID_PROMOTE_COMMAND' }, { status: 400 })
  }

  const check = await checkDailyPlanPromotionLive(supabaseAdmin, {
    clientId,
    planId: parsed.data.plan_id,
    date: parsed.data.date,
  })
  if (!check.ok) {
    return NextResponse.json({ success: false, error: 'NOT_PROMOTABLE', reason: check.reason }, { status: 409 })
  }

  const clicker = clickerFromSession({
    email: access.user.email ?? '',
    role: access.role,
    allowedClientId: access.allowedClientId,
    clientId,
    agentMarked: req.headers.get('x-me-actor') === 'agent',
  })
  const proposed = await proposeWinnerBatch({
    supabase: supabaseAdmin,
    clientId,
    clicker,
    adds: [check.intent],
    pauses: [],
    configAskedActive: false,
  })
  const card = proposed.added[0]
  if (card) {
    return NextResponse.json({ success: true, proposal_run_id: card.proposalRunId })
  }
  if (proposed.guards.some((g) => g.startsWith('already_proposed:'))) {
    return NextResponse.json(
      { success: false, error: 'ALREADY_PROPOSED', reason: '这条帖子已经有一张推广卡了，去「等你点头」那里确认就行。' },
      { status: 409 },
    )
  }
  return NextResponse.json(
    { success: false, error: 'PROPOSE_FAILED', reason: '确认卡没出成，没有建广告。可以稍后再试。' },
    { status: 502 },
  )
}
