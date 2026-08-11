/**
 * POST /api/clients/[id]/meta-ads/draft-listing
 *
 * 拿**已核实的房源／中介事实** → 生成草案 → 建成暂停 → 过闸门 → 等人点头。
 * 这是「ME 发广告」那条链路缺的上游调用方。
 *
 * ── 事实必须由调用方带来，这个接口不去猜 ────────────────────────────────
 * 铁律 8：房源信息只认客户官网／房源系统，不认 master_brief。所以请求体里
 * 每组事实都必须带 `sourceUrl`；缺了 `listing-draft-builder` 会直接抛。
 *
 * ── 表单 id 在服务端解析，不由请求体指定 ────────────────────────────────
 * 让调用方传表单 id 等于开了一个「往别人的表单里灌客资」的口子。这里一律
 * 从该客户自己的主页上取。
 *
 * ── 素材同理：只收 ME 库里的 asset id，不收 Meta 的 image hash ───────────
 * 2026-08-05 子牙复审抓到的第一条：这里原来是 `imageHash: body.imageHash`，
 * 调用方随便给一个 hash 就能建广告，全程不碰 client_assets、不问房源、不问签字。
 * 于是那道「素材必须属于这套房」的闸门，唯一的调用方是个**只读展示接口** ——
 * **A 房的图拿去卖 B 房，照样做得成**。
 *
 * 现在改成：调用方只能说「用这几个 asset id」，服务端自己查库 → 过闸 → 传 Meta
 * → 换 id。**没有任何入口能绕过闸门塞一张图进去。**
 *
 * Body:
 *   kind        'lead_form' | 'video_thruplay'
 *   lang        'zh' | 'en'
 *   listing     ListingFacts（lead_form 必给）
 *   agent       AgentFacts
 *   dailyBudget / durationDays / geoCountries …
 *   listingId   这条广告是给哪套房的（素材闸门按它判）
 *   assetIds    用哪几张素材（ME 库里的 id）——**不接受直接传 Meta 的 image hash**
 *   formName?   指定用哪个表单（按名字匹配）；不给就用唯一一个 active 表单
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { fetchPageLeadForms } from '@/lib/meta/lead-forms'
import {
  buildBuyerLeadDraft,
  buildSellerThruPlayDraft,
  traceClaims,
  NotGroundedError,
  BannedPhraseError,
  type ListingFacts,
  type AgentFacts,
  type BuildOptions,
  type AdLang,
} from '@/lib/ads-strategy/listing-draft-builder'
import { createDraftForApproval } from '@/lib/ads-strategy/draft-and-gate'
import { pickUsableForListing, type AssetRow } from '@/lib/assets/listing-asset-gate'
import { uploadAssetToMeta } from '@/lib/meta/asset-upload'

export const maxDuration = 120

interface Body {
  kind?: 'lead_form' | 'video_thruplay'
  lang?: AdLang
  listing?: ListingFacts
  agent?: AgentFacts
  dailyBudget?: number
  durationDays?: number
  geoCountries?: string[]
  geoCityKeys?: string[]
  ageMin?: number
  ageMax?: number
  /** 这条广告是给哪套房的 —— 素材闸门按它判归属。 */
  listingId?: string
  /** ME 库里的素材 id。服务端会逐个过闸，被挡的连理由一起 422 返回。 */
  assetIds?: string[]
  linkUrl?: string
  formName?: string
}

/**
 * 挑一个表单。
 *
 * 有多个 active 表单又没指定名字时**报错而不是随便挑一个** —— 挑错了客资就流进
 * 别的表单，而且完全静默。
 */
function pickForm(
  forms: { formId: string; name: string | null; status: string | null }[],
  wanted?: string,
): { formId: string } | { error: string } {
  const active = forms.filter((f) => (f.status ?? '').toUpperCase() === 'ACTIVE')
  const pool = active.length > 0 ? active : forms

  if (wanted) {
    const hit = pool.filter((f) => (f.name ?? '').includes(wanted))
    if (hit.length === 1) return { formId: hit[0].formId }
    if (hit.length === 0) return { error: `这个主页上没有名字含「${wanted}」的表单` }
    return { error: `名字含「${wanted}」的表单有 ${hit.length} 个，说清楚是哪一个` }
  }

  if (pool.length === 0) return { error: '这个主页上一个即时表单都没有 —— 要先在 Meta 里建一个' }
  if (pool.length > 1) {
    return {
      error:
        `这个主页上有 ${pool.length} 个表单（${pool
          .map((f) => f.name ?? f.formId)
          .join('、')}），没说用哪个。挑错了客资会静默流进别的表单，所以不猜。`,
    }
  }
  return { formId: pool[0].formId }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: clientId } = await params

  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body.agent) return NextResponse.json({ error: '没给中介事实（agent）' }, { status: 400 })
  const kind = body.kind ?? 'lead_form'
  const lang: AdLang = body.lang ?? 'en'

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('meta_ad_account_id, facebook_page_id, country, brand_redline_phrases')
    .eq('id', clientId)
    .maybeSingle()

  // 禁用词必须查库带进生成器。
  // 这两个字段以前只被塞进 AI 提示词当「软约束」，广告线一个字都读不到 ——
  // 2026-08-05 Roman 转所（Barfoot & Thompson → Ray White）就是靠这条兜住：
  // 他官网上还全是旧行资料，照着官网生成的广告会把前东家品牌印在他的付费物料上。
  const { data: brief } = await supabaseAdmin
    .from('master_briefs')
    .select('avoid_words, excluded_topics')
    .eq('client_id', clientId)
    .eq('is_active', true)
    .maybeSingle()

  const bannedPhrases = [
    ...((client as { brand_redline_phrases?: string[] } | null)?.brand_redline_phrases ?? []),
    ...((brief as { avoid_words?: string[] } | null)?.avoid_words ?? []),
    ...((brief as { excluded_topics?: string[] } | null)?.excluded_topics ?? []),
  ].filter((s): s is string => typeof s === 'string' && s.trim().length > 0)

  const c = client as {
    meta_ad_account_id?: string
    facebook_page_id?: string
    country?: string
  } | null

  if (!c?.meta_ad_account_id) {
    return NextResponse.json({ error: '这个客户还没配广告账户' }, { status: 424 })
  }
  if (!c.facebook_page_id) {
    return NextResponse.json({ error: '这个客户还没配主页' }, { status: 424 })
  }

  const accessToken = await getMetaTokenForClient(clientId)
  if (!accessToken) {
    return NextResponse.json({ error: '拿不到这个客户的 Meta 授权' }, { status: 424 })
  }

  const opts: BuildOptions = {
    clientId,
    pageId: c.facebook_page_id,
    lang,
    dailyBudget: body.dailyBudget ?? 25,
    durationDays: body.durationDays ?? 7,
    geoCountries: body.geoCountries ?? (c.country ? [c.country] : []),
    geoCityKeys: body.geoCityKeys,
    ageMin: body.ageMin,
    ageMax: body.ageMax,
    linkUrl: body.linkUrl,
    bannedPhrases,
  }

  // ── 素材：查库 → 过闸 → 传 Meta。三步都在服务端，调用方插不进手 ──────────
  const assetIds = (body.assetIds ?? []).filter((x) => typeof x === 'string' && x)
  if (assetIds.length === 0) {
    return NextResponse.json(
      { error: '没说用哪几张素材（assetIds）。这个接口不接受直接传 Meta 的 image hash。' },
      { status: 400 },
    )
  }
  if (!body.listingId) {
    // 没有房源就无从判「这张图是不是这套房的」—— 那正是这道闸唯一要拦的事。
    return NextResponse.json(
      { error: '没说这条广告是给哪套房的（listingId），素材归属就没法判' },
      { status: 400 },
    )
  }

  const { data: assetRows, error: assetErr } = await supabaseAdmin
    .from('client_assets')
    .select('id, client_id, listing_id, source, verified_by, verified_at, archived_at, mime_type, storage_url, original_filename')
    // 条件恒带 client_id：换个客户的 assetId 过来也取不到东西。
    .eq('client_id', clientId)
    .in('id', assetIds)

  if (assetErr) return NextResponse.json({ error: assetErr.message }, { status: 500 })

  const found = (assetRows ?? []).map((r) => ({
    id: r.id as string,
    clientId: r.client_id as string,
    listingId: (r.listing_id as string | null) ?? null,
    source: (r.source as string | null) ?? null,
    verifiedBy: (r.verified_by as string | null) ?? null,
    verifiedAt: (r.verified_at as string | null) ?? null,
    archivedAt: (r.archived_at as string | null) ?? null,
    mimeType: (r.mime_type as string | null) ?? null,
    storageUrl: r.storage_url as string,
  })) satisfies AssetRow[]

  // 要了 5 个只查到 3 个 —— 剩下两个是别人的或者不存在。必须报，不能当成「用 3 个」。
  const missing = assetIds.filter((id) => !found.some((a) => a.id === id))
  if (missing.length > 0) {
    return NextResponse.json(
      { error: `有 ${missing.length} 个素材在这个客户名下找不到：${missing.join('、')}` },
      { status: 404 },
    )
  }

  const picked = pickUsableForListing(found, body.listingId, clientId)
  if (picked.rejected.length > 0) {
    // 一张不合格就整条不建，**不是「用剩下能用的先跑着」**：
    // 那等于让人发现「多选几张总有能过的」，闸门就变成了摆设。
    return NextResponse.json(
      {
        error: `有 ${picked.rejected.length} 张素材不能用于投放，这条广告不建。`,
        summary: picked.summary,
        blocked: picked.rejected.map((r) => ({
          assetId: r.asset.id,
          why: r.verdict.why,
          reasons: r.verdict.reasons,
        })),
      },
      { status: 422 },
    )
  }

  const nameOf = new Map(
    (assetRows ?? []).map((r) => [r.id as string, (r.original_filename as string | null) ?? undefined]),
  )
  for (const a of picked.usable) {
    const up = await uploadAssetToMeta(
      c.meta_ad_account_id,
      { storageUrl: a.storageUrl, mimeType: a.mimeType, filename: nameOf.get(a.id) },
      accessToken,
    )
    if (!up.ok) {
      return NextResponse.json(
        { error: `素材传到 Meta 失败（${nameOf.get(a.id) ?? a.id}）：${up.error}` },
        { status: 502 },
      )
    }
    // 生成器一次只用一条创意，所以取第一个成功的就够；多传的留给后续多创意版本。
    if (up.asset.kind === 'image') opts.imageHash ??= up.asset.hash
    else opts.videoId ??= up.asset.videoId
  }

  // 表单只在真要用的时候去解析 —— 养受众那条不需要表单，别为它多打一次 Graph。
  if (kind === 'lead_form') {
    const { rows, error } = await fetchPageLeadForms(c.facebook_page_id, accessToken)
    if (error) {
      return NextResponse.json({ error: `读不到这个主页的表单：${error}` }, { status: 424 })
    }
    const picked = pickForm(rows, body.formName)
    if ('error' in picked) return NextResponse.json({ error: picked.error }, { status: 422 })
    opts.leadFormId = picked.formId
  }

  let draft
  try {
    draft =
      kind === 'lead_form'
        ? buildBuyerLeadDraft(body.listing as ListingFacts, body.agent, opts)
        : buildSellerThruPlayDraft(body.agent, opts)
  } catch (err) {
    if (err instanceof BannedPhraseError) {
      // 422 而不是 500：这不是故障，是闸门按设计拦下了。
      return NextResponse.json(
        { error: err.message, bannedHits: err.hits, notGrounded: true },
        { status: 422 },
      )
    }
    if (err instanceof NotGroundedError) {
      return NextResponse.json({ error: err.message, notGrounded: true }, { status: 422 })
    }
    throw err
  }

  const outcome = await createDraftForApproval(draft, {
    supabase: supabaseAdmin,
    adAccountId: c.meta_ad_account_id,
    accessToken,
    expectedGeo: c.country ?? null,
  })

  return NextResponse.json({
    ...outcome,
    // 逐句可溯来源随交付一起给出 —— 红线要求，不是调试信息。
    claims: traceClaims(draft, {
      listing: kind === 'lead_form' ? (body.listing as ListingFacts) : undefined,
      agent: body.agent as AgentFacts,
    }),
  })
}
