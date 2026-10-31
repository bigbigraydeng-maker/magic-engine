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
import { registeredAccountMatch } from '@/lib/ads-strategy/registered-account-match'
import { pausedDraftHoldAccount, submitPausedDraftCard } from '@/lib/ads-strategy/paused-draft-submit'
import { getRegisteredAccountIds } from '@/lib/meta/campaign-ownership'
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
  const accountId = await accountOnCard(id, runId, ads.adAccountId)
  if (!accountId.ok) return accountId.response
  try {
    const context = await cardContext(id, accountId.value)
    const result = await submitPausedDraftCard({
      kernel: kernel(),
      clientId: id,
      runId,
      clicker: gate.clicker,
      resolution: body.resolution,
      expectedDecisionId: body.expectedDecisionId,
      fingerprint: body.fingerprint,
      review: context.review,
      resolveDeps: () => depsFor(id, { ...ads, adAccountId: accountId.value }),
    })
    if (!result.card) return NextResponse.json({ error: result.resultLine }, { status: 409 })
    return NextResponse.json({ ...result.card, statusLine: result.resultLine, queued: result.queued })
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) console.error('[paused-draft-card] build failed')
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}

async function accountOnCard(
  clientId: string,
  runId: string,
  primaryAccountId: string,
): Promise<{ ok: true; value: string } | { ok: false; response: NextResponse }> {
  const held = await pausedDraftHoldAccount(supabaseAdmin, clientId, runId)
  if (!held) return { ok: true, value: primaryAccountId }
  const { ids, error } = await getRegisteredAccountIds(clientId)
  if (error || !registeredAccountMatch(held, ids)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: '这张卡上的广告账户已经不在这位客户名下，没有去建。' },
        { status: 409 },
      ),
    }
  }
  return { ok: true, value: held }
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
