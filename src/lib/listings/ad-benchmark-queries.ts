/**
 * 取「我们自己投过什么」的实测数据。判定和格式化在 ad-benchmarks.ts(纯函数)，
 * 本文件只负责去库里拿。
 *
 * 🔴 能拿到什么、拿不到什么(2026-08-01 实查，不是推测)
 * ----------------------------------------------------
 *   ad_daily_insights        每条广告每天的花费 / 曝光 / 点击 / 私信对话数。**没有
 *                            listing 维度**，只有 client_id + Meta 的 entity_id。
 *   campaign_briefs.listing_id  列建好了，但库里 **0 行有值**，且这张表根本没有
 *                            Meta campaign id —— 就算填了也接不到广告数据上。
 *   ad_creative_links        库里 **0 行**(建广告时才写，历史广告不回填)。
 *   contacts.listing_id / attr_campaign_id  两列都建好了，库里 **0 行有值**。
 *
 * 结论:广告 ↔ 单套房源之间**目前没有任何结构化对应关系**。唯一可靠的粒度是
 * **整个客户广告账户**。所以本文件按 client_id 取数，并把「这里面还混着这个
 * 账户的其他房源」如实标出来(mixed_with_other_listings)。
 *
 * 那为什么不按广告名去认(广告名里明明写着「30 Kiteroa · Ad F · 中文 · Rangitoto 学区」)：
 * 因为那是字符串猜谜 —— 命名换一次全错，而且猜出来的东西会被当成数据显示给人看。
 * 要按房源 / 按角度拆，正确做法是**建广告那一刻把 listing 和角度记下来**，不是事后猜。
 */

import { supabaseAdmin } from '@/lib/supabase'
import {
  buildAdReference,
  type AdInsightRow,
  type AdReferenceBlock,
  type BuildGroupInput,
} from './ad-benchmarks'
import type { ListingRow } from './queries'

/** 一次最多读多少行实测。够 30 条广告 × 半年，再多也不影响结论。 */
const MAX_INSIGHT_ROWS = 5000

const INSIGHT_COLUMNS = 'entity_id, insight_date, spend, impressions, clicks, leads, messaging_conversations'

/** 按 ad 级取(不是 campaign 级)—— 只有 ad 级才数得出「几条广告」这个样本量。 */
async function fetchInsights(clientIds: string[]): Promise<AdInsightRow[]> {
  if (clientIds.length === 0) return []
  const { data, error } = await supabaseAdmin
    .from('ad_daily_insights')
    .select(INSIGHT_COLUMNS)
    .in('client_id', clientIds)
    .eq('level', 'ad')
    .order('insight_date', { ascending: false })
    .limit(MAX_INSIGHT_ROWS)

  if (error) {
    console.error('[listings/ad-benchmark-queries] fetchInsights error', error)
    return []
  }
  return (data ?? []) as AdInsightRow[]
}

interface PeerListing {
  id: string
  client_id: string
}

/** 同类 = 同价格档 × 同区 × 同房型。三个维度缺一个就判不了，返回空。 */
async function fetchPeerListings(listing: ListingRow): Promise<PeerListing[]> {
  if (!listing.price_band || !listing.suburb || !listing.property_type) return []
  const { data, error } = await supabaseAdmin
    .from('listings')
    .select('id, client_id')
    .eq('price_band', listing.price_band)
    .eq('suburb', listing.suburb)
    .eq('property_type', listing.property_type)
    .neq('id', listing.id)

  if (error) {
    console.error('[listings/ad-benchmark-queries] fetchPeerListings error', error)
    return []
  }
  return (data ?? []) as PeerListing[]
}

/** 这些客户账户下一共挂着几套房源。> 本组套数 = 钱拆不开，要如实标出来。 */
async function countListingsInAccounts(clientIds: string[]): Promise<number> {
  if (clientIds.length === 0) return 0
  const { count, error } = await supabaseAdmin
    .from('listings')
    .select('id', { count: 'exact', head: true })
    .in('client_id', clientIds)

  if (error) {
    console.error('[listings/ad-benchmark-queries] countListingsInAccounts error', error)
    return 0
  }
  return count ?? 0
}

interface PeerEvidence {
  confirmedListings: number
  distinctClients: number
  consecutiveReversals: number
}

/**
 * 同类房源里**已经回填过结论**的证据。
 *
 * 只数 verdict 不是 pending 的:一套房档案建好但还没跑完，不能算进「几套实测」——
 * 那正是把 1 次对话当规律的同一个错误。
 */
async function fetchPeerEvidence(peers: PeerListing[]): Promise<PeerEvidence> {
  const empty = { confirmedListings: 0, distinctClients: 0, consecutiveReversals: 0 }
  if (peers.length === 0) return empty

  const clientOf = new Map(peers.map(p => [p.id, p.client_id]))
  const { data, error } = await supabaseAdmin
    .from('listing_briefs')
    .select('listing_id, verdict, updated_at')
    .in('listing_id', peers.map(p => p.id))
    .neq('verdict', 'pending')
    .order('updated_at', { ascending: false })

  if (error) {
    console.error('[listings/ad-benchmark-queries] fetchPeerEvidence error', error)
    return empty
  }

  const rows = (data ?? []) as Array<{ listing_id: string; verdict: string }>
  const seen = new Set<string>()
  const clients = new Set<string>()
  for (const r of rows) {
    if (seen.has(r.listing_id)) continue      // 一套房多版档案只算一套
    seen.add(r.listing_id)
    const c = clientOf.get(r.listing_id)
    if (c) clients.add(c)
  }

  // 最近**连续**几套是「跟当初想的相反」。rows 已按时间倒序，从头数到第一个不是 reversed 为止。
  let streak = 0
  for (const r of rows) {
    if (r.verdict !== 'reversed') break
    streak += 1
  }

  return { confirmedListings: seen.size, distinctClients: clients.size, consecutiveReversals: streak }
}

/**
 * 这套房能拿到的全部参考数据。
 *
 * 任何一步失败都**降级成「这一块没有」**而不是让整条档案生成链断掉 ——
 * 参考数据是附加信息，AI 做功课本身不依赖它。
 */
export async function fetchListingAdReference(
  listing: ListingRow,
): Promise<{ reference: AdReferenceBlock | null; warning: string | null }> {
  try {
    const [ownRows, peers] = await Promise.all([
      fetchInsights([listing.client_id]),
      fetchPeerListings(listing),
    ])

    const ownListingsInAccount = await countListingsInAccounts([listing.client_id])
    const own: BuildGroupInput = {
      scope: 'this_client',
      rows: ownRows,
      listings: 1,
      clients: 1,
      listingsInAccounts: Math.max(1, ownListingsInAccount),
    }

    const peerGroup = await buildPeerGroup(peers)
    const evidence = await fetchPeerEvidence(peers)

    return {
      reference: buildAdReference({
        similarity: {
          price_band: listing.price_band,
          suburb: listing.suburb,
          property_type: listing.property_type,
        },
        own,
        peers: peerGroup,
        evidence,
      }),
      warning: null,
    }
  } catch (err) {
    console.error('[listings/ad-benchmark-queries] fetchListingAdReference failed', err)
    return {
      reference: null,
      warning: `没读到我们自己的投放实测(${err instanceof Error ? err.message : String(err)})，这次档案里没有这一块。`,
    }
  }
}

/** 同类房源那一组。没有同类就是 null —— 不返回一组 0，见 buildGroup 的注释。 */
async function buildPeerGroup(peers: PeerListing[]): Promise<BuildGroupInput | null> {
  if (peers.length === 0) return null
  const clientIds = Array.from(new Set(peers.map(p => p.client_id)))
  const [rows, inAccounts] = await Promise.all([
    fetchInsights(clientIds),
    countListingsInAccounts(clientIds),
  ])
  return {
    scope: 'similar_listings',
    rows,
    listings: peers.length,
    clients: clientIds.length,
    listingsInAccounts: Math.max(peers.length, inAccounts),
  }
}
