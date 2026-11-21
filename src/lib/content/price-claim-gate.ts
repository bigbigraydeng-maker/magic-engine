/**
 * 「真实价格只能配真实画面」—— 服务端那道闸。
 *
 * 界面上的闸（SocialPlanSection 交付按钮）挡的是手滑。这里挡的是**绕过界面的路**：
 * 每日计划自动发布、交付到 Launch Hub 存草稿的 quick-post ——
 * 前者一旦跑起来东西就真出去了，人不在场。（Publer 退役后，Airtable 自动发和 Visuals 直接排期两条路已不存在。）
 *
 * 判定跟界面完全同源：`containsPriceClaim`（严口径）× `canBackRealPrice`。
 * 两边共用同一段代码，不会出现「界面拦了后端放行」这种最难查的不一致。
 *
 * 只在文案真的报了价时才拦。没价格 = 没这条红线可踩，一律放行 ——
 * 库里绝大多数素材还是历史存量的「来源不明」，无条件拦会让发布全线瘫痪。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  canAssetBackRealPrice,
  canBackRealPrice,
  isPosterSigned,
  normaliseSource,
  readPosterLineage,
  sourceForVisualProvider,
  SOURCE_LABELS,
  type AssetSource,
} from '@/lib/assets/provenance'
import { containsPriceClaim } from './price-claim'

export interface PriceClaimVerdict {
  /** 该不该拦下这次发布。 */
  blocked: boolean
  /** 文案里有没有价格声明 —— 拦不拦的前提。 */
  priceClaimed: boolean
  /** 这次要发出去的那张图的来源。 */
  source: AssetSource
  /** 这张图是 AI 海报（按海报规矩判的）。只有海报才带这个键。 */
  poster?: true
  /** 海报才有：签过字没有，海报行 id，原图 id。 */
  posterSigned?: boolean
  posterAssetId?: string
  posterSourceAssetId?: string
  /** 素材库查不了（出错 / 海报行不见了）—— 拦下，不猜。 */
  lookupFailed?: true
}

/**
 * 一张**要发出去的图**的来源。
 *
 * 查两张表，顺序有讲究：
 *   1. `client_assets` —— 素材库的真值，`client_verified` 只可能出现在这里
 *   2. `visual_assets` —— 贴文配图槽，按 provider 判（AI 生成 / 认不出）
 * 两张都查不到 = 这张图不在系统里（外部链接）→ `unknown`，背不了真价。
 *
 * 两次查询都恒带 `client_id`：换个客户的图 URL 过来，查不到就是查不到，
 * 绝不会拿别人的「已确认」给这个客户的价格背书。
 */
export async function resolveOutgoingImageSource(
  supabase: SupabaseClient,
  clientId: string,
  imageUrl: string,
): Promise<AssetSource> {
  const { data: libraryRow, error: libraryErr } = await supabase
    .from('client_assets')
    .select('source')
    .eq('client_id', clientId)
    .eq('storage_url', imageUrl)
    .limit(1)
    .maybeSingle()

  // 查询本身出错 ≠ 这张图没来源。区分不开就按最保守的来 ——
  // 报错时返回 unknown，闸会要求核实，不会误放行。
  if (libraryErr) {
    console.error('[price-claim-gate] 素材库回查失败，按来源不明处理:', libraryErr.message)
    return 'unknown'
  }
  if (libraryRow) return normaliseSource((libraryRow as { source: unknown }).source)

  const { data: visualRow, error: visualErr } = await supabase
    .from('visual_assets')
    .select('provider')
    .eq('client_id', clientId)
    .eq('storage_url', imageUrl)
    .limit(1)
    .maybeSingle()

  if (visualErr) {
    console.error('[price-claim-gate] 配图槽回查失败，按来源不明处理:', visualErr.message)
    return 'unknown'
  }
  if (!visualRow) return 'unknown'

  // provider='client_library' 但上一步没在素材库里查到 → 那条素材被删了或换了地址，
  // 来源无从谈起，按不明处理。
  return sourceForVisualProvider((visualRow as { provider: string | null }).provider) ?? 'unknown'
}

/**
 * 已知配图来源时的判定(纯函数,不查库)。
 *
 * 调用方手里已经有 `client_assets` 那一行的 `source` 时用它,不要再按 URL 回查:
 * 同一客户下两行 storage_url 相同、来源不同时,按 URL 回查取哪行不确定。
 */
export function judgePriceClaimWithSource(input: {
  caption: string
  source: string | null | undefined
  /** 图里自己写了价格（AI 海报 `poster.has_price`）—— 文案没写价也按报了价判。不传 = false。 */
  imagePriceClaim?: boolean
  /** 调用方已按整行素材算好的背书结论（`canAssetBackRealPrice`）。不传 = 只按 source 判。 */
  backsRealPrice?: boolean
}): PriceClaimVerdict {
  const priceClaimed = containsPriceClaim(input.caption) || input.imagePriceClaim === true
  const source = normaliseSource(input.source)
  if (!priceClaimed) return { blocked: false, priceClaimed, source }
  const backs = input.backsRealPrice ?? canBackRealPrice(source)
  return { blocked: !backs, priceClaimed, source }
}

interface PosterImage {
  source: AssetSource
  backsRealPrice: boolean
  hasPrice: boolean
  signed: boolean
  posterAssetId: string
  sourceAssetId: string
}

type LibraryLookup =
  | { kind: 'poster'; poster: PosterImage }
  | { kind: 'not_poster' }
  | { kind: 'error' }

/** 去掉 ?… 和 #… —— 同一张图带了缓存参数也要认得出。 */
export function stripUrlQuery(url: string): string {
  return url.split('#')[0].split('?')[0]
}

/** 海报上传时固定放在 `<client>/posters/` 下（见 image-post-poster）。 */
function looksLikePosterPath(url: string): boolean {
  return url.includes('/posters/')
}

async function loadPosterImage(
  supabase: SupabaseClient,
  clientId: string,
  row: { id: string; source: string | null; verified_by: string | null; verified_at: string | null; vision_metadata: unknown },
): Promise<LibraryLookup> {
  const lineage = readPosterLineage(row.vision_metadata)
  if (!lineage) return { kind: 'not_poster' }
  const { data: parent, error } = await supabase
    .from('client_assets')
    .select('source, archived_at')
    .eq('client_id', clientId)
    .eq('id', lineage.source_asset_id)
    .maybeSingle()
  // 原图查不了 ≠ 原图没事：背书按「背不了」算（签字照样要求）。
  const p = parent as { source: string | null; archived_at: string | null } | null
  const parentSource = !error && p && p.archived_at == null ? p.source : null
  return {
    kind: 'poster',
    poster: {
      source: normaliseSource(row.source),
      backsRealPrice: canAssetBackRealPrice(row, parentSource),
      hasPrice: lineage.has_price,
      signed: isPosterSigned(row),
      posterAssetId: row.id,
      sourceAssetId: lineage.source_asset_id,
    },
  }
}

/**
 * 这张图在素材库里是不是 AI 海报。查询出错 → `error`（调用方拦下，不猜）。
 * 素材库里查不到、但地址在 `/posters/` 下 → 也当 `error`：海报那一行不见了，背书无从谈起。
 */
async function lookupLibraryImage(
  supabase: SupabaseClient,
  clientId: string,
  imageUrl: string,
): Promise<LibraryLookup> {
  const { data: row, error } = await supabase
    .from('client_assets')
    .select('id, source, verified_by, verified_at, vision_metadata')
    .eq('client_id', clientId)
    .eq('storage_url', imageUrl)
    .limit(1)
    .maybeSingle()
  if (error) {
    console.error('[price-claim-gate] 素材库回查失败，拦下:', error.message)
    return { kind: 'error' }
  }
  if (!row) return looksLikePosterPath(imageUrl) ? { kind: 'error' } : { kind: 'not_poster' }
  return loadPosterImage(supabase, clientId, row as Parameters<typeof loadPosterImage>[2])
}

/**
 * 这条内容能不能发出去。
 *
 * 没配图 = 没有「画面」可对不上，不适用本闸（纯文字帖报价是文案的事，不是素材的事）。
 *
 * AI 海报（PM 2026-11-15）：不管有没有价格都要签过字；图里写了价就算报了价，放行只认
 * `canAssetBackRealPrice`（原图当前来源 + 团队签字）。有配图时**先查一次素材库**：
 * 查询出错、或 `/posters/` 地址查不到那一行 → 拦（不猜）。不是海报且文案没价 → 照旧放行。
 */
export async function judgeOutgoingPost(
  supabase: SupabaseClient,
  input: { clientId: string; caption: string; imageUrl: string | null | undefined },
): Promise<PriceClaimVerdict> {
  const priceClaimed = containsPriceClaim(input.caption)
  if (!input.imageUrl) return { blocked: false, priceClaimed, source: 'unknown' }
  const imageUrl = stripUrlQuery(input.imageUrl)

  const library = await lookupLibraryImage(supabase, input.clientId, imageUrl)
  if (library.kind === 'error') return { blocked: true, priceClaimed, source: 'unknown', lookupFailed: true }
  if (library.kind === 'poster') return judgePoster(input.caption, library.poster)

  if (!priceClaimed) return { blocked: false, priceClaimed, source: 'unknown' }
  const source = await resolveOutgoingImageSource(supabase, input.clientId, imageUrl)
  return { blocked: !canBackRealPrice(source), priceClaimed, source }
}

function judgePoster(caption: string, poster: PosterImage): PriceClaimVerdict {
  const verdict = judgePriceClaimWithSource({
    caption,
    source: poster.source,
    imagePriceClaim: poster.hasPrice,
    backsRealPrice: poster.backsRealPrice,
  })
  return {
    ...verdict,
    blocked: verdict.blocked || !poster.signed,
    poster: true,
    posterSigned: poster.signed,
    posterAssetId: poster.posterAssetId,
    posterSourceAssetId: poster.sourceAssetId,
  }
}

/** 拦截说明：查不了 / 海报没签字 / 海报背不了价 各走各的出路，其余照旧。 */
export function outgoingPriceGateMessage(verdict: PriceClaimVerdict): string {
  if (verdict.lookupFailed) return '核对不了这张图的来源（素材库查询出错，或海报记录找不到），先不发。稍后重试，或换一张图。'
  if (verdict.poster && verdict.posterSigned === false) {
    return '配的是 AI 海报，还没有团队成员对过原图签字。去素材库打开原图对一遍，点「已对原图，确认」后再发。'
  }
  return verdict.poster ? posterPriceGateMessage() : priceGateMessage(verdict.source)
}

/** 给人看的拦截说明 —— 说清为什么、以及怎么解开。别只回一句「被拒绝」。 */
export function priceGateMessage(source: AssetSource): string {
  return (
    `文案里写了价格，但配图来源是「${SOURCE_LABELS[source]}」，不能给真实价格背书。` +
    '要么把价格从文案里去掉，要么去素材库把这张图确认成客户实拍再发。'
  )
}

/** AI 海报被拦时的说明 —— 普通说明会叫人「把图确认成客户实拍」，对海报是错的路。 */
export function posterPriceGateMessage(): string {
  return (
    '这条帖子（文案或海报图里）报了价，配的是 AI 海报。海报要打真价，必须原图本身能打真价' +
    '（客户实拍已确认 / 我们拍的），并且团队成员在素材库对过原图、点了「已对原图，确认」。' +
    '要么去素材库完成这两步，要么换回原图并把价格去掉。'
  )
}
