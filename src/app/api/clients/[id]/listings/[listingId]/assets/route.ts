/**
 * GET /api/clients/[id]/listings/[listingId]/assets
 *
 * 这套房的素材 + 这套房专属的上传链接 + 每张能不能投放。
 *
 * 为什么把「链接」和「素材」放在同一个接口里：
 *   这一页要回答的其实是一个问题 ——「这套房现在能不能出广告？」
 *   答案要么是「能，有 N 张可用」，要么是「不能，原因是 X，喏这是上传链接」。
 *   拆成两个接口会让页面出现「素材空着但链接还没加载出来」的中间态，
 *   而那正是人最想立刻拿到链接的时刻。
 *
 * 200 { uploadUrl, summary, usable[], rejected[] }
 * 404 房源不存在或不属于这个客户（不区分，别让人拿这个接口探测）
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { createUploadToken, uploadSecret } from '@/lib/uploads/client-upload-token'
import { pickUsableForListing, type AssetRow } from '@/lib/assets/listing-asset-gate'
import { buildShootBrief, renderShootBrief } from '@/lib/listings/shoot-brief'

/** 一次最多取多少张在用的。写出来是为了「撞到了能被发现」，而不是静默截断。 */
const ASSET_LIMIT = 300
/** 已收起来的只取一小批 —— 那一栏是给人找回误点的，不是归档馆。 */
const ARCHIVED_LIMIT = 50

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; listingId: string }> },
) {
  const { id: clientId, listingId } = await params

  const access = await requireDashboardClientAccess(clientId)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  // 房源必须属于这个客户 —— 否则换个 listingId 就能看别人的素材。
  const { data: listing } = await supabaseAdmin
    .from('listings')
    .select('id, address_line, suburb, status, bedrooms, property_type')
    .eq('id', listingId)
    .eq('client_id', clientId)
    .maybeSingle()
  if (!listing) return NextResponse.json({ error: '找不到这套房' }, { status: 404 })

  // 已归档的不进主列表（2026-08-05 魏征 P1-3）：
  //   · 按设计的换图流程（归档旧的 + 传新的），不过滤的话「还不能投放」会越用越长，
  //     变成一排坟头，真正要处理的那几张淹在里面
  //   · migration 建的是**部分索引** `WHERE listing_id IS NOT NULL AND archived_at IS NULL`，
  //     查询不带 archived_at 条件的话这个索引根本用不上
  // 归档的单独取一小批给「已收起来」那一栏用，让人能放回来 —— 不是消失。
  const [{ data: rows, error }, { data: archivedRows }] = await Promise.all([
    supabaseAdmin
      .from('client_assets')
      .select('id, client_id, listing_id, source, verified_by, verified_at, archived_at, mime_type, storage_url, original_filename, created_at')
      .eq('client_id', clientId)
      .eq('listing_id', listingId)
      .is('archived_at', null)
      .order('created_at', { ascending: false })
      .limit(ASSET_LIMIT),
    supabaseAdmin
      .from('client_assets')
      .select('id, storage_url, original_filename, mime_type, archived_at')
      .eq('client_id', clientId)
      .eq('listing_id', listingId)
      .not('archived_at', 'is', null)
      .order('archived_at', { ascending: false })
      .limit(ARCHIVED_LIMIT),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const assets: AssetRow[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    clientId: r.client_id as string,
    listingId: (r.listing_id as string | null) ?? null,
    source: (r.source as string | null) ?? null,
    verifiedBy: (r.verified_by as string | null) ?? null,
    verifiedAt: (r.verified_at as string | null) ?? null,
    archivedAt: (r.archived_at as string | null) ?? null,
    mimeType: (r.mime_type as string | null) ?? null,
    storageUrl: r.storage_url as string,
  }))

  const picked = pickUsableForListing(assets, listingId, clientId)

  // 这套房专属的上传链接。密钥只在服务端，所以必须服务端签。
  const token = createUploadToken({ clientId, listingId }, uploadSecret())

  const filenameOf = new Map(
    (rows ?? []).map((r) => [r.id as string, (r.original_filename as string | null) ?? '']),
  )
  const decorate = (a: AssetRow) => ({ ...a, filename: filenameOf.get(a.id) ?? '' })

  // 拍摄单跟上传链接放在同一个返回里 —— 拿脚本去拍的人和传照片的人是同一个人，
  // 分成两个接口就会变成「脚本在一条微信里、链接在另一条微信里」，他一定漏一个。
  const brief = buildShootBrief({
    address: (listing as { address_line: string }).address_line,
    suburb: (listing as { suburb: string }).suburb,
    bedrooms: (listing as { bedrooms?: number | null }).bedrooms ?? null,
    propertyType: (listing as { property_type?: string | null }).property_type ?? null,
  })

  return NextResponse.json({
    listing,
    shootBrief: brief,
    shootBriefText: renderShootBrief(brief, token ? `${req.nextUrl.origin}/upload/${token}` : null),
    // fail-closed：没配密钥就不发链接，而不是发一条人人可伪造的。
    uploadUrl: token ? `${req.nextUrl.origin}/upload/${token}` : null,
    uploadUrlError: token ? null : '服务器还没配上传链接的密钥（UPLOAD_LINK_SECRET），暂时发不了链接',
    summary: picked.summary,
    // 撞到上限要说出来 —— 不说的话，这一页读起来像「全都算过了」。
    truncated: (rows ?? []).length >= ASSET_LIMIT,
    archived: (archivedRows ?? []).map((r) => ({
      id: r.id as string,
      storageUrl: r.storage_url as string,
      filename: (r.original_filename as string | null) ?? '',
      mimeType: (r.mime_type as string | null) ?? null,
      archivedAt: r.archived_at as string,
    })),
    usable: picked.usable.map(decorate),
    rejected: picked.rejected.map((r) => ({ ...decorate(r.asset), verdict: r.verdict })),
  })
}
