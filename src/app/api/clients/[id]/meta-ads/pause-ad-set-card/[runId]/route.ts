/**
 * Confirm or decline one pause card.
 * Meta is written only after confirm, and only as a pause through the kernel.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { executeAutoPauseHold } from '@/app/api/clients/[id]/ad-health/auto-pause/[runId]/decision/route'
import { executeConfirmedPause } from '@/lib/action-submission/pause-ad-set'
import { confirmMoneyPause } from '@/lib/action-submission/money-card'
import { confirmPauseCard } from '@/lib/ads-pause-card/confirm'
import { kernelThatCannotResume } from '@/lib/ads-pause-card/kernel'
import { readPauseLive } from '@/lib/ads-pause-card/live'
import { createKernel } from '@/lib/kernel'
import { parseDecisionBody, publicError } from '@/lib/confirmation-card/http'
import { isUuid } from '@/lib/validation-utils'
import { pauseCardGate } from '../access'

export async function POST(
  req: Request,
  { params }: { params: { id: string; runId: string } | Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params
  const gate = await pauseCardGate(req, id)
  if (!gate.ok) return gate.response
  if (!isUuid(runId)) return NextResponse.json({ error: '这个地址不对。' }, { status: 400 })
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '请求内容读不懂，没有收下。' }, { status: 400 })
  }
  try {
    const body = parseDecisionBody(raw)
    const email = gate.clicker.kind === 'opc' || gate.clicker.kind === 'fde' ? gate.clicker.email : ''
    const money = await confirmMoneyPause({
      kernel: createKernel(supabaseAdmin),
      sb: supabaseAdmin,
      clientId: id,
      runId,
      clicker: gate.clicker,
      resolution: body.resolution,
      expectedDecisionId: body.expectedDecisionId,
      fingerprint: body.fingerprint,
      readLive: (hold) => hold.campaignId ? readPauseLive(id, {
        prescriptionId: hold.entityId,
        version: 1,
        adAccountId: hold.adAccountId,
        campaignId: hold.campaignId,
        adsetId: hold.entityId,
        metric: 'ads.account.spend',
        direction: 'pause',
        observationDays: 7,
        basis: '确认之后才暂停',
      }) : Promise.resolve({ registeredAccountIds: null, target: null, campaignAdSets: null }),
      write: (hold) => executeAutoPauseHold(id, email, hold),
    })
    if (money.handled) {
      return NextResponse.json({ ...money, ok: money.wroteMeta, wroteMeta: money.wroteMeta }, { status: money.wroteMeta ? 200 : 409 })
    }
    const kernel = kernelThatCannotResume(supabaseAdmin)
    const result = await confirmPauseCard({
      kernel,
      clientId: id,
      runId,
      clicker: gate.clicker,
      resolution: body.resolution,
      expectedDecisionId: body.expectedDecisionId,
      fingerprint: body.fingerprint,
      live: (order) => readPauseLive(id, order),
      execute: (input) => executeConfirmedPause(kernel, input),
    })
    if (!result.card) return NextResponse.json({ error: result.reason }, { status: 409 })
    return NextResponse.json(result.card)
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) console.error('[pause-ad-set-card] confirm failed')
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
