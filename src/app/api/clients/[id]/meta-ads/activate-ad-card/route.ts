/**
 * Ask for one card that turns a paused ad on.
 * Issuing the card does not call Meta.
 */

import { NextResponse } from 'next/server'
import { makeActivateDeps } from '@/lib/ads-activate-card/runtime'
import { issueActivateCard } from '@/lib/ads-activate-card/flow'
import { parseActivateRequest } from '@/lib/ads-activate-card/order'
import { publicError } from '@/lib/confirmation-card/http'
import { createKernel } from '@/lib/kernel'
import { supabaseAdmin } from '@/lib/supabase'
import { activateAdCardGate } from './access'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await activateAdCardGate(req, params.id)
  if (!gate.ok) return gate.response
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '请求内容读不懂，没有出卡。' }, { status: 400 })
  }
  try {
    const order = parseActivateRequest(raw)
    const issued = await issueActivateCard({
      kernel: createKernel(supabaseAdmin),
      clientId: params.id,
      clicker: gate.clicker,
      order,
      deps: makeActivateDeps(supabaseAdmin, params.id),
    })
    if (!issued.card) return NextResponse.json({ error: issued.reason }, { status: 409 })
    return NextResponse.json({ ...issued.card, previewUrl: issued.previewUrl })
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) console.error('[activate-ad-card] issue failed')
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
