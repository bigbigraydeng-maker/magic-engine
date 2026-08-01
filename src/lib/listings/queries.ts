/**
 * 房子的读取层 + 鉴权 helper。
 *
 * 路由层只做 HTTP(解析 body / 返回状态码),取数和鉴权都在这里 —— 跟
 * lib/strategy/auth-helpers.ts 同一套写法。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'

/** listings 表的一行(跟 20260730145332_listings.sql 一一对应)。 */
export interface ListingRow {
  id: string
  client_id: string
  address_line: string
  suburb: string | null
  city: string | null
  property_type: string | null
  bedrooms: number | null
  price_band: string | null
  status: string
  listed_on: string | null
  delisted_on: string | null
  sold_on: string | null
  sold_price: number | null
  vendor_notes: string | null
  external_ref: string | null
  created_at: string
  updated_at: string
}

/** 列表页要的一行:房子本身 + 这套房带来了多少人。 */
export interface ListingWithCount extends ListingRow {
  contact_count: number
}

interface AuthFailure {
  ok: false
  status: 401 | 402 | 403 | 404 | 500
  error: string
}

/**
 * 先按 id 读出这套房、拿到它归属的 client_id,再走标准客户鉴权。
 *
 * URL 里没有 client_id,所以**必须**先查再判 —— 少了这一步,任何登录用户
 * 改一下 URL 里的房子 id 就能改别的中介的房子。
 */
export async function requireListingAccess(
  listingId: string,
): Promise<{ ok: true; row: ListingRow } | AuthFailure> {
  const { data, error } = await supabaseAdmin
    .from('listings')
    .select('*')
    .eq('id', listingId)
    .maybeSingle<ListingRow>()

  if (error) {
    console.error('[listings/queries] requireListingAccess load error', error)
    return { ok: false, status: 500, error: '读取房子失败' }
  }
  if (!data) return { ok: false, status: 404, error: '找不到这套房子' }

  const access = await requireDashboardClientAccess(data.client_id)
  if (!access.ok) return access as AuthFailure

  return { ok: true, row: data }
}

/**
 * 某个中介手上的全部房子,带每套房挂了多少人。
 *
 * 计数走一次「只取 listing_id 这一列」的查询然后在内存里数,而不是 N+1 次
 * count 查询:一个中介手上几十套房、几百个联系人,一次拉一列比几十次往返便宜得多。
 */
export async function fetchListingsWithContactCounts(
  clientId: string,
): Promise<{ ok: true; listings: ListingWithCount[] } | { ok: false; error: string }> {
  const { data: rows, error } = await supabaseAdmin
    .from('listings')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[listings/queries] fetchListings error', error)
    return { ok: false, error: `读取房子列表失败: ${error.message}` }
  }

  const listings = (rows ?? []) as ListingRow[]
  if (listings.length === 0) return { ok: true, listings: [] }

  const counts = await countContactsByListing(
    clientId,
    listings.map((l) => l.id),
  )

  return {
    ok: true,
    listings: listings.map((l) => ({ ...l, contact_count: counts.get(l.id) ?? 0 })),
  }
}

/**
 * 每套房挂了多少联系人。
 *
 * 同时按 client_id 过滤(而不是只按 listing_id):多一道保险,确保跨客户的行
 * 绝不会被算进来,哪怕将来某条 contact 的 listing_id 写歪了。
 */
async function countContactsByListing(
  clientId: string,
  listingIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()

  const { data, error } = await supabaseAdmin
    .from('contacts')
    .select('listing_id')
    .eq('client_id', clientId)
    .in('listing_id', listingIds)

  if (error) {
    // 计数失败不该让整页打不开 —— 房子列表本身是主体,人数是附加信息。
    console.error('[listings/queries] countContactsByListing error', error)
    return counts
  }

  for (const row of (data ?? []) as Array<{ listing_id: string | null }>) {
    if (!row.listing_id) continue
    counts.set(row.listing_id, (counts.get(row.listing_id) ?? 0) + 1)
  }
  return counts
}
