/**
 * 「真实价格只能配真实画面」—— 服务端那道闸。
 *
 * 界面上的闸（SocialPlanSection 交付按钮）挡的是手滑。这里挡的是**绕过界面的路**：
 * Airtable 审批过了自动发（`/api/publer/create-post`）、Visuals 页面直接排期
 * （`/api/publer/schedule`）—— 这两条一旦跑起来东西就真出去了，人不在场。
 *
 * 判定跟界面完全同源：`containsPriceClaim`（严口径）× `canBackRealPrice`。
 * 两边共用同一段代码，不会出现「界面拦了后端放行」这种最难查的不一致。
 *
 * 只在文案真的报了价时才拦。没价格 = 没这条红线可踩，一律放行 ——
 * 库里绝大多数素材还是历史存量的「来源不明」，无条件拦会让发布全线瘫痪。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  canBackRealPrice,
  normaliseSource,
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
 * 这条内容能不能发出去。
 *
 * 没配图 = 没有「画面」可对不上，不适用本闸（纯文字帖报价是文案的事，不是素材的事）。
 */
export async function judgeOutgoingPost(
  supabase: SupabaseClient,
  input: { clientId: string; caption: string; imageUrl: string | null | undefined },
): Promise<PriceClaimVerdict> {
  const priceClaimed = containsPriceClaim(input.caption)

  if (!priceClaimed || !input.imageUrl) {
    return { blocked: false, priceClaimed, source: 'unknown' }
  }

  const source = await resolveOutgoingImageSource(supabase, input.clientId, input.imageUrl)
  return { blocked: !canBackRealPrice(source), priceClaimed, source }
}

/** 给人看的拦截说明 —— 说清为什么、以及怎么解开。别只回一句「被拒绝」。 */
export function priceGateMessage(source: AssetSource): string {
  return (
    `文案里写了价格，但配图来源是「${SOURCE_LABELS[source]}」，不能给真实价格背书。` +
    '要么把价格从文案里去掉，要么去素材库把这张图确认成客户实拍再发。'
  )
}
