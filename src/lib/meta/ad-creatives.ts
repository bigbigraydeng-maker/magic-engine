/**
 * 广告层的素材绑定读写（只碰「这条广告挂哪个素材」，不建素材）。
 *
 * 🔴 这里刻意**没有**建 creative 的函数。建一个新 creative 等于由代码自己写
 *    对外的广告文案（正文、标题、CTA），而对外每句话必须来自已核实、已批准的
 *    来源（CLAUDE.md 铁律 8）。所以换素材只能换成账户里**已经存在**的素材；
 *    没有现成的就让人先建，不由自动化补。
 *
 * 风格照 `./adsets.ts`：裸 fetch、失败返回 null/false 而不抛、读失败和写失败分开报。
 */

import { GRAPH_BASE } from './graph-base'

/** 一条广告当前挂的素材，以及它以哪个主页的身份发布。 */
export interface AdCreativeBinding {
  id: string
  account_id: string | null
  /** 换完必须看这个：被打回审核时它不是 ACTIVE，而广告会静静地零花费（NAL 9-24 事故）。 */
  effective_status: string | null
  /** Meta 给出的审核问题清单，没有问题时是空数组；读不到是 null。 */
  issues_info: unknown[] | null
  creative_id: string | null
  /** 素材的 `object_story_spec.page_id` —— 换素材不许换主页，靠它比对。 */
  page_id: string | null
  /** `object_story_spec.video_data.video_id`；不是单视频素材就是 null。 */
  video_id: string | null
  /** 整条素材原样留着：比对买家可见文案与投放形态都要用它，不能只留摘出来的几项。 */
  creative_raw: Record<string, unknown> | null
}

interface RawAdCreative {
  id?: string
  account_id?: string
  effective_status?: string
  issues_info?: unknown[]
  creative?: Record<string, unknown>
}

/** 从一条素材里取 `object_story_spec.video_data.video_id`。不是单视频素材返回 null。 */
export function videoIdOfCreative(creative: Record<string, unknown> | null | undefined): string | null {
  const spec = creative?.object_story_spec as Record<string, unknown> | undefined
  const videoData = spec?.video_data as Record<string, unknown> | undefined
  const id = videoData?.video_id
  return typeof id === 'string' && id !== '' ? id : null
}

/** 从一条素材里取发布主页编号。 */
export function pageIdOfCreative(creative: Record<string, unknown> | null | undefined): string | null {
  const spec = creative?.object_story_spec as Record<string, unknown> | undefined
  const id = spec?.page_id
  return typeof id === 'string' && id !== '' ? id : null
}

/** 读一条广告当前挂的素材。读不到返回 null（环境问题，调用方按可重试处理）。 */
export async function getAdCreativeBinding(
  adId: string,
  accessToken: string,
): Promise<AdCreativeBinding | null> {
  const params = new URLSearchParams({
    fields: 'id,account_id,effective_status,issues_info,creative{id,object_story_spec,asset_feed_spec,body,title}',
    access_token: accessToken,
  })
  let res: Response
  try {
    res = await fetch(`${GRAPH_BASE}/${adId}?${params.toString()}`)
  } catch (err) {
    console.error('[meta/ad-creatives] getAdCreativeBinding fetch error:', err)
    return null
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/ad-creatives] getAdCreativeBinding HTTP ${res.status}:`, body.slice(0, 300))
    return null
  }
  const json = await res.json() as RawAdCreative
  const creative = json.creative ?? null
  const creativeId = typeof creative?.id === 'string' ? creative.id : null
  return {
    id: json.id ?? adId,
    account_id: json.account_id ?? null,
    effective_status: json.effective_status ?? null,
    issues_info: Array.isArray(json.issues_info) ? json.issues_info : null,
    creative_id: creativeId,
    page_id: pageIdOfCreative(creative),
    video_id: videoIdOfCreative(creative),
    creative_raw: creative,
  }
}

/** 账户里的一条素材。原样留一份 raw，因为文案比对要整条看，不能只看摘出来的几项。 */
export interface AccountAdCreative {
  id: string
  name: string | null
  /** `object_story_spec.video_data.video_id`，不是单视频素材就是 null。 */
  video_id: string | null
  page_id: string | null
  status: string | null
  raw: Record<string, unknown>
}

type RawAccountCreativeRow = Record<string, unknown>

/** 列清单时要取回的字段：文案比对与形态比对都靠它们，少取一个就等于少一道闸。 */
const CREATIVE_LIST_FIELDS = 'id,name,status,object_story_spec,asset_feed_spec,body,title'

/** Graph 分页上限。够一个账户的素材量，又不会在对方返回异常时无限翻下去。 */
const MAX_CREATIVE_PAGES = 10

function accountPath(adAccountId: string): string {
  return `act_${adAccountId.replace(/^act_/, '')}`
}

function toAccountCreative(row: RawAccountCreativeRow): AccountAdCreative | null {
  // 🔴 编号必须是纯数字：Graph 回非数字编号时，下游按编号排序会抛未分类异常
  //    （子牙 2026-10-15 复审 S2）。这里直接当成读不懂的行丢掉。
  if (typeof row.id !== 'string' || !/^\d+$/.test(row.id)) return null
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : null,
    video_id: videoIdOfCreative(row),
    page_id: pageIdOfCreative(row),
    status: typeof row.status === 'string' ? row.status : null,
    raw: row,
  }
}

/** 列清单的结果。`complete: false` = 这份清单**不全**，不能据此下「账户里没有」的结论。 */
export interface AccountAdCreativeList {
  creatives: AccountAdCreative[]
  complete: boolean
  /** 不全的原因，写进错误文本给人看。完整时为 null。 */
  truncated_reason: string | null
}

/**
 * 列出一个广告账户里的素材。
 *
 * 🔴 三种结果必须能分开，不许长得一样（子牙 2026-10-15 复审 B2）：
 *    · `null`                        = 第一页就读不出来 → 调用方按可重试处理
 *    · `{ complete: true,  … }`      = 读全了，就这些（空数组时才允许下「真没有」的结论）
 *    · `{ complete: false, … }`      = 中途失败或翻到页数上限还有下一页 → **判不了**，
 *                                      绝不能渲染成「没有现成素材，请人去建一条」
 */
export async function listAccountAdCreatives(
  adAccountId: string,
  accessToken: string,
): Promise<AccountAdCreativeList | null> {
  const params = new URLSearchParams({
    fields: CREATIVE_LIST_FIELDS,
    limit: '200',
    access_token: accessToken,
  })
  let url: string | null = `${GRAPH_BASE}/${accountPath(adAccountId)}/adcreatives?${params.toString()}`
  const creatives: AccountAdCreative[] = []

  for (let page = 0; page < MAX_CREATIVE_PAGES && url; page += 1) {
    let res: Response
    try {
      res = await fetch(url)
    } catch (err) {
      console.error('[meta/ad-creatives] listAccountAdCreatives fetch error:', err)
      return page === 0 ? null : { creatives, complete: false, truncated_reason: `第 ${page + 1} 页请求失败` }
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[meta/ad-creatives] listAccountAdCreatives HTTP ${res.status}:`, body.slice(0, 300))
      return page === 0 ? null : { creatives, complete: false, truncated_reason: `第 ${page + 1} 页返回 HTTP ${res.status}` }
    }
    const json = await res.json() as { data?: RawAccountCreativeRow[]; paging?: { next?: string } }
    for (const row of json.data ?? []) {
      const parsed = toAccountCreative(row)
      if (parsed) creatives.push(parsed)
    }
    url = typeof json.paging?.next === 'string' ? json.paging.next : null
  }
  return url
    ? { creatives, complete: false, truncated_reason: `翻到 ${MAX_CREATIVE_PAGES} 页上限仍有下一页` }
    : { creatives, complete: true, truncated_reason: null }
}

/** 把一条广告换挂到另一个已存在的素材上。只有 Meta 明说 success 才算成功。 */
export async function setAdCreative(
  adId: string,
  accessToken: string,
  creativeId: string,
): Promise<boolean> {
  let res: Response
  try {
    res = await fetch(`${GRAPH_BASE}/${adId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        creative: JSON.stringify({ creative_id: creativeId }),
        access_token: accessToken,
      }).toString(),
    })
  } catch (err) {
    console.error('[meta/ad-creatives] setAdCreative fetch error:', err)
    return false
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/ad-creatives] setAdCreative HTTP ${res.status}:`, body.slice(0, 300))
    return false
  }
  const json = await res.json() as { success?: boolean }
  return json.success === true
}
