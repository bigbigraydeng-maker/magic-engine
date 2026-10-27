/**
 * Confirm or decline one paused-draft card.
 * Meta is written only after confirm, and the campaign stays paused.
 */

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { loadDraftRedlines } from '@/lib/ads-strategy/draft-redlines'
import { isUuid } from '@/lib/validation-utils'
import { parseDecisionBody, publicError } from '@/lib/confirmation-card/http'
import { submitPausedDraftCard } from '@/lib/ads-strategy/paused-draft-submit'
import { cardContext, clientAds, kernel, pausedDraftGate } from '../access'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; runId: string }> },
) {
  const { id, runId } = await params
  const gate = await pausedDraftGate(req, id)
  if (!gate.ok) return gate.response
  if (!isUuid(runId)) return NextResponse.json({ error: '这个地址不对。' }, { status: 400 })
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: '请求内容读不懂，没有收下。' }, { status: 400 })
  }
  let body: ReturnType<typeof parseDecisionBody>
  try {
    body = parseDecisionBody(raw)
  } catch (error) {
    const mapped = publicError(error)
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
  const ads = await clientAds(id)
  if (!ads.ok) return ads.response
  try {
    const context = await cardContext(id, ads.adAccountId)
    const result = await submitPausedDraftCard({
      kernel: kernel(),
      clientId: id,
      runId,
      clicker: gate.clicker,
      resolution: body.resolution,
      expectedDecisionId: body.expectedDecisionId,
      fingerprint: body.fingerprint,
      review: context.review,
      resolveDeps: () => depsFor(id, ads),
    })
    if (!result.card) return NextResponse.json({ error: result.resultLine }, { status: 409 })
    return NextResponse.json({ ...result.card, statusLine: result.resultLine, queued: result.queued })
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) console.error('[paused-draft-card] build failed')
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}

async function depsFor(
  clientId: string,
  ads: { adAccountId: string; country: string | null; industry: string | null },
) {
  const accessToken = await getMetaTokenForClient(clientId)
  if (!accessToken) return null
  const brandRedlines = await loadDraftRedlines(supabaseAdmin, clientId)
  return {
    supabase: supabaseAdmin,
    adAccountId: ads.adAccountId,
    accessToken,
    brandRedlines: brandRedlines ?? undefined,
    expectedGeo: ads.country,
    industry: ads.industry,
  }
}
