import { NextResponse } from 'next/server'
import { decideGoLive, loadGoLive, parseGoLiveDecision } from '@/lib/ads-go-live'
import type { CardClicker } from '@/lib/confirmation-card'
import { publicError } from '@/lib/confirmation-card/http'
import { createKernel } from '@/lib/kernel'
import { supabaseAdmin } from '@/lib/supabase'
import { openReader } from '../../access'
import { executeConfirmedGoLive } from '../../execute'

function emailOf(clicker: CardClicker): string {
  if (clicker.kind === 'opc' || clicker.kind === 'fde') return clicker.email
  return ''
}

export async function POST(req: Request, { params }: { params: { id: string; draftId: string } }) {
  const gate = await openReader(req, params.id)
  if ('error' in gate) return NextResponse.json({ error: gate.error }, { status: gate.status })
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '请求内容读不懂，没有收下。' }, { status: 400 })
  }
  try {
    const parsed = parseGoLiveDecision(raw)
    const loaded = await loadGoLive(supabaseAdmin, params.id, params.draftId, new Date())
    if (!loaded.ok) return NextResponse.json({ error: loaded.error }, { status: loaded.status })
    const body = await decideGoLive({
      kernel: createKernel(supabaseAdmin),
      clientId: params.id,
      clicker: gate.clicker,
      draftId: params.draftId,
      facts: loaded.facts,
      resolution: parsed.resolution,
      expectedDecisionId: parsed.expectedDecisionId,
      fingerprint: parsed.fingerprint,
      runId: parsed.runId,
      settle: () => executeConfirmedGoLive({
        supabase: supabaseAdmin,
        clientId: params.id,
        draftId: params.draftId,
        ids: loaded.ids,
        authority: {
          actorUserId: gate.access.user.id,
          actorEmail: emailOf(gate.clicker),
          basis: 'go_live_card',
          cardRunId: parsed.runId,
        },
      }),
    })
    return NextResponse.json(body)
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) console.error('[go-live-card] decision failed')
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
