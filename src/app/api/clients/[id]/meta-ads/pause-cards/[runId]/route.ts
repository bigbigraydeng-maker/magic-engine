/**
 * Confirm or decline one pause card. A confirm pauses once, then reads Meta back.
 */

import { NextResponse } from 'next/server'
import { isUuid } from '@/lib/validation-utils'
import { parseDecisionBody, publicError } from '@/lib/confirmation-card/http'
import { submitPauseCard } from '@/lib/ads-pause-card/flow'
import { metaPauseRuntime } from '@/lib/ads-pause-card/meta'
import { pauseCardGate, pauseKernel } from '../access'

export async function POST(req: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params
  const gate = await pauseCardGate(req, id)
  if (!gate.ok) return gate.response
  if (!isUuid(runId)) return NextResponse.json({ error: '找不到这张卡。' }, { status: 404 })
  let decision: ReturnType<typeof parseDecisionBody>
  try {
    decision = parseDecisionBody(await req.json())
  } catch (error) {
    const mapped = publicError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
  const runtime = await metaPauseRuntime(id)
  if (!runtime) return NextResponse.json({ error: '拿不到广告授权，没有去暂停。' }, { status: 424 })
  try {
    const result = await submitPauseCard({
      kernel: pauseKernel(),
      clientId: id,
      runId,
      clicker: gate.clicker,
      runtime,
      ...decision,
    })
    return NextResponse.json(result)
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) console.error('[pause-cards] confirm failed')
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
