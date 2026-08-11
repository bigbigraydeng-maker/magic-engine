/**
 * POST /api/clients/[id]/meta-ads/draft
 *
 * ME 起草一条广告 → 在 Meta 上**建成暂停状态** → 回读过闸门 → 落账等人点头。
 *
 * 这个接口**不会让任何广告开始花钱**。开是另一个接口，而且必须有人点。
 *
 * 200 { actionId, status, summary, findings, readback }
 *   status = 'awaiting_approval' 才轮到人看；'blocked' 是 ME 自己没干完；
 *   'failed' 是建都没建出来。
 * 424 客户没配广告账户 / 拿不到 Meta 授权
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { createDraftForApproval } from '@/lib/ads-strategy/draft-and-gate'
import type { AdDraft } from '@/lib/ads-strategy/ad-draft'

export const maxDuration = 120

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: clientId } = await params

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
    .select('meta_ad_account_id, facebook_page_id, country')
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
  const draft: AdDraft = {
    ...(body as AdDraft),
    clientId,
    pageId:
      (client as { facebook_page_id?: string } | null)?.facebook_page_id ?? body.pageId ?? '',
  }

  const outcome = await createDraftForApproval(draft, {
    supabase: supabaseAdmin,
    adAccountId,
    accessToken,
    expectedGeo: (client as { country?: string } | null)?.country ?? null,
  })

  return NextResponse.json(outcome)
}
