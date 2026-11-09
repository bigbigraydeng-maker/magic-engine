/**
 * POST /api/clients/[id]/meta-ads/draft
 *
 * Asks for the paused-draft card. Does not build the ad.
 * A person confirms that card before anything is created on Meta.
 * Several ad sets are refused here: the existing card cannot build them.
 *
 * 202 { wroteMeta: false, status: 'awaiting_confirmation', card }
 * 424 客户没配广告账户 / 主页 / 拿不到 Meta 授权
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { rejectAgentAdsBearer } from '@/lib/auth/agent-ads-guard'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { createKernel } from '@/lib/kernel'
import { publicError } from '@/lib/confirmation-card/http'
import type { AdDraft } from '@/lib/ads-strategy/ad-draft'
import { askerFromAccess } from '@/lib/ads-strategy/card-asker'
import { askDirectPausedDraft } from '@/lib/ads-strategy/direct-draft-card'
import { loadPausedDraftContext } from '@/lib/ads-strategy/paused-draft-context'
import { issuePausedDraftCard } from '@/lib/ads-strategy/paused-draft-submit'

export const maxDuration = 120

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: clientId } = await params
  const denied = await rejectAgentAdsBearer(req, { clientId, action: 'write_meta' })
  if (denied) return denied

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: Partial<AdDraft>
  try {
    body = (await req.json()) as Partial<AdDraft>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id, facebook_page_id, country, industry')
    .eq('id', clientId)
    .maybeSingle()

  const adAccountId = (client as { meta_ad_account_id?: string } | null)?.meta_ad_account_id
  if (!adAccountId) {
    return NextResponse.json(
      { error: '这个客户还没配广告账户（设置页 → Meta 广告账户）' },
      { status: 424 },
    )
  }

  const accessToken = await getMetaTokenForClient(clientId)
  if (!accessToken) {
    return NextResponse.json({ error: '拿不到这个客户的 Meta 授权' }, { status: 424 })
  }

  // client_id / page_id 一律以库为准，不信请求体 —— 否则一个客户的接口能往
  // 另一个客户的账户里建广告。
  // 🔴 AD-SEC-2：这条注释原来只兑现了一半——客户没配主页时会回退 body.pageId，
  // 等于又信了请求体。改成 fail closed：客户没配主页就直接拒绝，不静默用
  // 请求体里的值顶上（那正是这个守卫本来要挡住的事）。
  const registeredPageId = (client as { facebook_page_id?: string } | null)?.facebook_page_id
  if (!registeredPageId) {
    return NextResponse.json(
      { error: '这个客户还没配 Facebook 主页（设置页 → Facebook 主页），无法建广告' },
      { status: 424 },
    )
  }
  const draft: AdDraft = {
    ...(body as AdDraft),
    clientId,
    pageId: registeredPageId,
  }

  try {
    const asked = await askDirectPausedDraft({
      draft,
      issue: async () => {
        const context = await loadPausedDraftContext(supabaseAdmin, clientId, adAccountId)
        return issuePausedDraftCard({
          kernel: createKernel(supabaseAdmin),
          clientId,
          clicker: askerFromAccess(access, clientId, req.headers.get('x-me-actor') === 'agent'),
          draft,
          accountLabel: context.accountLabel,
          review: context.review,
        })
      },
    })
    return NextResponse.json(asked.body, { status: asked.status })
  } catch (error) {
    const mapped = publicError(error)
    return NextResponse.json({ error: mapped.message, wroteMeta: false }, { status: mapped.status })
  }
}
