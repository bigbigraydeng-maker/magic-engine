/**
 * Ask for the paused-draft confirmation card. Does not write Meta.
 */

import { NextResponse } from 'next/server'
import { publicError } from '@/lib/confirmation-card/http'
import { issuePausedDraftCard } from '@/lib/ads-strategy/paused-draft-submit'
import type { AdDraft } from '@/lib/ads-strategy/ad-draft'
import { cardContext, clientAds, kernel, pausedDraftGate } from './access'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const gate = await pausedDraftGate(req, id)
  if (!gate.ok) return gate.response
  const ads = await clientAds(id)
  if (!ads.ok) return ads.response
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求内容读不懂，没有收下。' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: '请求内容读不懂，没有收下。' }, { status: 400 })
  }
  const draft = { ...(body as AdDraft), clientId: id, pageId: ads.pageId }
  delete (draft as { accessToken?: unknown }).accessToken
  delete (draft as { access_token?: unknown }).access_token
  try {
    const context = await cardContext(id, ads.adAccountId)
    const card = await issuePausedDraftCard({
      kernel: kernel(),
      clientId: id,
      clicker: gate.clicker,
      draft,
      accountLabel: context.accountLabel,
      review: context.review,
    })
    return NextResponse.json(card)
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) console.error('[paused-draft-card] issue failed')
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}
