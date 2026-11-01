/**
 * Ask for the paused-draft confirmation card. Does not write Meta.
 */

import { NextResponse } from 'next/server'
import { publicError } from '@/lib/confirmation-card/http'
import { issuePausedDraftCard } from '@/lib/ads-strategy/paused-draft-submit'
import type { AdDraft } from '@/lib/ads-strategy/ad-draft'
import { readExistingAdSetSpend } from '@/lib/meta/existing-adset-spend'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
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
    const readSpend = await spendReader(id, ads.adAccountId, draft)
    if (!readSpend.ok) return readSpend.response
    const card = await issuePausedDraftCard({
      kernel: kernel(),
      clientId: id,
      clicker: gate.clicker,
      draft,
      accountLabel: context.accountLabel,
      review: context.review,
      readSpend: readSpend.read,
    })
    return NextResponse.json(card)
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) console.error('[paused-draft-card] issue failed')
    return NextResponse.json({ error: mapped.message }, { status: mapped.status })
  }
}

async function spendReader(clientId: string, adAccountId: string, draft: AdDraft): Promise<
  | { ok: true; read?: (row: AdDraft) => ReturnType<typeof readExistingAdSetSpend> }
  | { ok: false; response: NextResponse }
> {
  if (!draft.existingAdSetId) return { ok: true }
  const token = await getMetaTokenForClient(clientId)
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json({ error: '拿不到这个客户的广告授权，没有出卡。' }, { status: 424 }),
    }
  }
  const adSetId = draft.existingAdSetId
  return { ok: true, read: () => readExistingAdSetSpend(adSetId, adAccountId, token) }
}
