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
  effective_status: string | null
  creative_id: string | null
  /** 素材的 `object_story_spec.page_id` —— 换素材不许换主页，靠它比对。 */
  page_id: string | null
}

interface RawAdCreative {
  id?: string
  account_id?: string
  effective_status?: string
  creative?: { id?: string; object_story_spec?: { page_id?: string } }
}

/** 读一条广告当前挂的素材。读不到返回 null（环境问题，调用方按可重试处理）。 */
export async function getAdCreativeBinding(
  adId: string,
  accessToken: string,
): Promise<AdCreativeBinding | null> {
  const params = new URLSearchParams({
    fields: 'id,account_id,effective_status,creative{id,object_story_spec}',
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
  return {
    id: json.id ?? adId,
    account_id: json.account_id ?? null,
    effective_status: json.effective_status ?? null,
    creative_id: json.creative?.id ?? null,
    page_id: json.creative?.object_story_spec?.page_id ?? null,
  }
}

/** 账户里的一条素材，只保留换素材要比对的三样。 */
export interface AccountAdCreative {
  id: string
  name: string | null
  /** `object_story_spec.video_data.video_id`，不是视频就是 null。 */
  video_id: string | null
  page_id: string | null
}

interface RawAccountCreativeRow {
  id?: string
  name?: string
  object_story_spec?: { page_id?: string; video_data?: { video_id?: string } }
}

/** Graph 分页上限。够一个账户的素材量，又不会在对方返回异常时无限翻下去。 */
const MAX_CREATIVE_PAGES = 10

function accountPath(adAccountId: string): string {
  return `act_${adAccountId.replace(/^act_/, '')}`
}

function toAccountCreative(row: RawAccountCreativeRow): AccountAdCreative | null {
  if (typeof row.id !== 'string' || row.id === '') return null
  const spec = row.object_story_spec
  const videoId = spec?.video_data?.video_id
  const pageId = spec?.page_id
  return {
    id: row.id,
    name: typeof row.name === 'string' ? row.name : null,
    video_id: typeof videoId === 'string' && videoId !== '' ? videoId : null,
    page_id: typeof pageId === 'string' && pageId !== '' ? pageId : null,
  }
}

/**
 * 列出一个广告账户里的素材。
 *
 * 🔴 返回 `null` = **读不出来**；返回 `[]` = 读成功但账户里一条都没有。
 *    两者后果完全不同（一个该重试，一个该转人工），所以不合并成空数组。
 *    第一页就失败返回 null；翻到后面某页失败，返回已经收到的那些。
 */
export async function listAccountAdCreatives(
  adAccountId: string,
  accessToken: string,
): Promise<AccountAdCreative[] | null> {
  const params = new URLSearchParams({
    fields: 'id,name,object_story_spec',
    limit: '200',
    access_token: accessToken,
  })
  let url: string | null = `${GRAPH_BASE}/${accountPath(adAccountId)}/adcreatives?${params.toString()}`
  const out: AccountAdCreative[] = []

  for (let page = 0; page < MAX_CREATIVE_PAGES && url; page += 1) {
    let res: Response
    try {
      res = await fetch(url)
    } catch (err) {
      console.error('[meta/ad-creatives] listAccountAdCreatives fetch error:', err)
      return page === 0 ? null : out
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      console.error(`[meta/ad-creatives] listAccountAdCreatives HTTP ${res.status}:`, body.slice(0, 300))
      return page === 0 ? null : out
    }
    const json = await res.json() as { data?: RawAccountCreativeRow[]; paging?: { next?: string } }
    for (const row of json.data ?? []) {
      const parsed = toAccountCreative(row)
      if (parsed) out.push(parsed)
    }
    url = typeof json.paging?.next === 'string' ? json.paging.next : null
  }
  return out
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
