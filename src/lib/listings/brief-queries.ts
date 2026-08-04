/**
 * 房子档案的读写层。
 *
 * 路由层只做 HTTP,取数 / 版本号 / 生效切换都在这里 —— 跟 lib/listings/queries.ts
 * 同一套分工。鉴权不在本文件:调用方一律先过 requireListingAccess(queries.ts),
 * 本文件的函数假定「已经确认过这套房归调用者管」。
 */

import { supabaseAdmin } from '@/lib/supabase'
import type { ListingBriefContent, ListingBriefPatch } from './brief-schema'
import type { ListingBriefStatus, ListingBriefVerdict } from './brief-constants'
import { applyAdReferenceToDraft, type AdReferenceBlock } from './ad-benchmarks'

/** listing_briefs 表的一行(跟 20260801150000_listing_briefs.sql 一一对应)。 */
export interface ListingBriefRow extends ListingBriefContent {
  id: string
  listing_id: string
  version: number
  status: ListingBriefStatus
  generated_by: string | null
  model_used: string | null
  input_tokens: number | null
  outcomes: Record<string, unknown> | null
  verdict: ListingBriefVerdict
  /**
   * 生成这一版时我们自己的投放实测(20260801170000 加的列)。
   * 只给人看 —— 它**不在** ListingBriefContent 里,所以人手 PATCH 也改不到它,
   * AI 更写不了它。见 ad-benchmarks.ts 文件头纪律 ①。
   */
  ad_reference: AdReferenceBlock | null
  created_at: string
  updated_at: string
}

type Result<T> = { ok: true; value: T } | { ok: false; status: 400 | 404 | 500; error: string }

const TABLE = 'listing_briefs'

/**
 * 这套房的全部档案版本,新的在前。
 *
 * 一次拉全部而不是只拉 active:页面要同时显示「现在生效的」和「还没定稿的草稿」,
 * 而且历史版本本身就是这张表的价值(当初以为什么 —— 删了就没得对照了)。
 */
export async function fetchListingBriefs(listingId: string): Promise<Result<ListingBriefRow[]>> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('*')
    .eq('listing_id', listingId)
    .order('version', { ascending: false })

  if (error) {
    console.error('[listings/brief-queries] fetchListingBriefs error', error)
    return { ok: false, status: 500, error: `读取房子档案失败: ${error.message}` }
  }
  return { ok: true, value: (data ?? []) as ListingBriefRow[] }
}

/**
 * 下一个版本号。
 *
 * 按 listing 自己数(不是全局序号)——「这套房改到第 3 版」对运营有意义,
 * 「全库第 187 号」没有。查不到就是第 1 版。
 */
export async function nextBriefVersion(listingId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('version')
    .eq('listing_id', listingId)
    .order('version', { ascending: false })
    .limit(1)

  if (error) {
    // 数不出来就从 1 开始重试,总比整条生成链断掉好 —— 真撞了唯一约束
    // (本表没给 version 加唯一约束,所以撞不上)最坏也只是版本号重复,不丢数据。
    console.error('[listings/brief-queries] nextBriefVersion error', error)
    return 1
  }
  const rows = (data ?? []) as Array<{ version: number | null }>
  const top = rows[0]?.version
  return typeof top === 'number' && top > 0 ? top + 1 : 1
}

/**
 * AI 生成完落库,一律先进 draft —— 没有人看过的东西不许直接生效。
 *
 * adReference 走 applyAdReferenceToDraft 挂在旁边,**不并进 content**:
 * 实测数据只显示,不参与判断(ad-benchmarks.ts 纪律 ①)。这里也是它唯一的
 * 写入路径 —— PATCH 那条路走 ListingBriefPatch,结构上就够不到这一列。
 */
export async function insertBriefDraft(params: {
  listingId: string
  content: ListingBriefContent
  modelUsed: string
  inputTokens: number
  adReference?: AdReferenceBlock | null
}): Promise<Result<ListingBriefRow>> {
  const version = await nextBriefVersion(params.listingId)
  const payload = applyAdReferenceToDraft(params.content, params.adReference ?? null)

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({
      listing_id: params.listingId,
      version,
      status: 'draft',
      ...payload.content,
      ad_reference: payload.ad_reference,
      generated_by: 'claude',
      model_used: params.modelUsed,
      input_tokens: params.inputTokens,
    })
    .select('*')
    .single<ListingBriefRow>()

  if (error || !data) {
    console.error('[listings/brief-queries] insertBriefDraft error', error)
    return { ok: false, status: 500, error: `保存档案失败: ${error?.message ?? '未知错误'}` }
  }
  return { ok: true, value: data }
}

/**
 * 按 id 读一份档案,并确认它确实属于这套房。
 *
 * 这个「属于这套房」的检查不能省:URL 上的 listingId 已经过了鉴权,briefId 没有。
 * 少了它,拿别人房子的 brief id 换进来就能读 / 改。
 */
export async function fetchBriefOfListing(
  listingId: string,
  briefId: string,
): Promise<Result<ListingBriefRow>> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select('*')
    .eq('id', briefId)
    .eq('listing_id', listingId)
    .maybeSingle<ListingBriefRow>()

  if (error) {
    console.error('[listings/brief-queries] fetchBriefOfListing error', error)
    return { ok: false, status: 500, error: `读取档案失败: ${error.message}` }
  }
  if (!data) return { ok: false, status: 404, error: '找不到这份档案' }
  return { ok: true, value: data }
}

/** 人手校正。只写请求里出现过的字段。 */
export async function updateBrief(
  listingId: string,
  briefId: string,
  patch: ListingBriefPatch,
): Promise<Result<ListingBriefRow>> {
  const existing = await fetchBriefOfListing(listingId, briefId)
  if (!existing.ok) return existing

  // 旧版本是历史记录 —— 改它等于篡改「当初以为什么」,学习的对照就没了。
  if (existing.value.status === 'superseded') {
    return { ok: false, status: 400, error: '这是旧版本,不能再改。要改就基于现在生效的那版。' }
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', briefId)
    .eq('listing_id', listingId)
    .select('*')
    .single<ListingBriefRow>()

  if (error || !data) {
    console.error('[listings/brief-queries] updateBrief error', error)
    return { ok: false, status: 500, error: `保存失败: ${error?.message ?? '未知错误'}` }
  }
  return { ok: true, value: data }
}

/**
 * 让一份档案生效。
 *
 * 两步,顺序不能反:
 *   ① 这套房**当前生效的那版**全部置 superseded
 *   ② 目标那版置 active
 *
 * 🔴 第 ① 步不是「顺手清理」,是这个函数存在的理由。少了它:
 *    · 数据库那条 partial unique index 会直接把第 ② 步顶回来 → 生效按钮报错
 *    · 万一索引没建上(migration 没 apply 全),就会出现两个 active,
 *      而「现在生效的是哪一版」是投放和内容的输入,有歧义 = 下游全乱
 *    变异测试目标:删掉第 ① 步,`brief-activate.test.ts` 必须变红。
 *
 * 为什么不是一个事务:supabase-js 没有跨语句事务。两步之间崩了的后果是
 * 「这套房暂时没有生效版本」——可恢复(再点一次生效),而且比「两个 active」轻。
 */
export async function activateBrief(
  listingId: string,
  briefId: string,
): Promise<Result<ListingBriefRow>> {
  const target = await fetchBriefOfListing(listingId, briefId)
  if (!target.ok) return target
  if (target.value.status === 'active') return { ok: true, value: target.value }
  if (target.value.status === 'superseded') {
    return { ok: false, status: 400, error: '旧版本不能重新生效。请基于它另存一版再生效。' }
  }

  const { error: supersedeError } = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'superseded', updated_at: new Date().toISOString() })
    .eq('listing_id', listingId)
    .eq('status', 'active')
    .neq('id', briefId)

  if (supersedeError) {
    console.error('[listings/brief-queries] supersede error', supersedeError)
    return { ok: false, status: 500, error: `切换生效版本失败: ${supersedeError.message}` }
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', briefId)
    .eq('listing_id', listingId)
    .select('*')
    .single<ListingBriefRow>()

  if (error || !data) {
    console.error('[listings/brief-queries] activateBrief error', error)
    return { ok: false, status: 500, error: `生效失败: ${error?.message ?? '未知错误'}` }
  }
  return { ok: true, value: data }
}
