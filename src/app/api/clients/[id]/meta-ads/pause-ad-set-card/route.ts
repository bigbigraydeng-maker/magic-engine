/**
 * Ask for pause cards from approved prescriptions. Does not write Meta.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { issuePauseCards } from '@/lib/ads-pause-card/issue'
import { kernelThatCannotResume } from '@/lib/ads-pause-card/kernel'
import { readPauseLive } from '@/lib/ads-pause-card/live'
import { publicError } from '@/lib/confirmation-card/http'
import { pauseCardGate } from './access'

export async function POST(req: Request, { params }: { params: { id: string } | Promise<{ id: string }> }) {
  const { id } = await params
  const gate = await pauseCardGate(req, id)
  if (!gate.ok) return gate.response
  try {
    const result = await issuePauseCards({
      kernel: kernelThatCannotResume(supabaseAdmin),
      clientId: id,
      clicker: gate.clicker,
      live: (order) => readPauseLive(id, order),
    })
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 })
    return NextResponse.json(result)
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) console.error('[pause-ad-set-card] issue failed')
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
