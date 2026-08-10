/**
 * 从「客户的 Meta 广告账户」反推「客户的 Facebook 主页」，并自动接上。
 *
 * WHY
 * ---
 * 表单同步的开关是 `clients.facebook_page_id` 有没有值。这个字段以前只有一条写入
 * 路径：有人打开设置页、在下拉里挑一个主页、保存。于是出现了 Oztop 这个状态 ——
 *
 *   · 广告账户 act_1735240120460765 每天都在采集，2026-06-24 起累计 70 条 lead；
 *   · `clients.facebook_page_id` 是空的 → 每小时的表单同步压根不看这个客户；
 *   · 于是 70 个填了表的询价人，姓名电话装修明细一条都没进 ME。
 *
 * 「让 PM 去设置页挑一个主页」是标准的人工 SOP —— CLAUDE.md 铁律 3 明确禁止。
 * 而这件事其实**完全可以自动做**：客户的 lead 广告本来就投在某个主页上，那个主页
 * 是谁，Graph 自己就能回答。所以这里做的是：拿广告账户去问 Meta「这些广告挂在哪个
 * 主页」，再跟「我们的令牌能代管哪些主页」对一下，能对上就直接写进去。
 *
 * 自动写库的两道闸（缺一不可，宁可下发给人也不猜）
 * -------------------------------------------
 *   1. 广告账户里**只有一个**主页 —— 有两个就说明得有人拍板，我们不替他选；
 *   2. 这个主页在 `/me/accounts` 里 —— 也就是客户已经把主页授权给我们了。
 *
 * 第 2 条是关键：它保证我们只会绑一个「本来就有权读」的主页，而不是凭广告数据把
 * 某个陌生主页写进客户档案。绑上 `facebook_page_id` 会同时打开私信同步、主页指标、
 * 评论自动回复等一串读取，绑错了就是读了别人的收件箱。
 *
 * 对不上时不静默 —— 返回具体候选（主页名 + 数字 ID + 差什么），
 * 由今日待办转成一句人话（见 pm-todo/manual-items.ts）。
 * **发现不许死在日志里。**
 *
 * ⚠️ 读 lead 和投 lead 广告是两套权限，别混：
 *    这里只解决「哪个主页」和「主页有没有授权给我们」。令牌能不能**读表单里的人**
 *    另外要 `leads_retrieval`，绑好之后由 lead-forms.ts 在真实取数时报出来
 *    （它会把 Graph 的原话原样带回 cron 日志）。历史上「条款未接受」那个坑说的是
 *    「这个令牌身份不能跑留资广告」，跟本文件要判断的读权限不是一回事。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getMetaTokenForClient } from '@/lib/meta/token-manager'
import { listManagedPages } from '@/lib/meta/page-posts'

const GRAPH_BASE = 'https://graph.facebook.com/v20.0'

/** 翻页上限。主页集合收敛得很快，翻不完也够判断了 —— 但截断了要说。 */
const MAX_PAGES = 10

export interface PageCandidate {
  pageId: string
  /** 这个账户里有多少条广告投在这个主页上 —— 多候选时给人排序用。 */
  adCount: number
  /** 主页名。拿不到就是 null（不影响绑定，只影响待办里好不好读）。 */
  name: string | null
  /** 我们的令牌能不能代管这个主页 —— 决定「能自动绑」还是「要客户授权」。 */
  managed: boolean
}

export type PageBindOutcome =
  /** 本来就绑好了，这次没动它。 */
  | 'already_bound'
  /** 这次自动绑上了。 */
  | 'bound'
  /** 找到了主页，但客户没把它授权给我们 → 要人去 Business Manager 分享。 */
  | 'needs_grant'
  /** 广告投在多个主页上 → 要人挑一个，我们不替他选。 */
  | 'ambiguous'
  /** 广告账户里翻不出任何主页（账户是空的 / 广告类型不带主页）。 */
  | 'no_candidates'
  /** 这个客户没有可用的 Meta 令牌 —— 连问 Meta 的资格都没有。 */
  | 'no_token'
  /** Graph 报错了。**不能当成「没有主页」** —— 那是两回事。 */
  | 'graph_error'

export interface PageBindResult {
  clientId: string
  clientName: string | null
  outcome: PageBindOutcome
  /** 绑上的（或本来就绑着的）主页 ID。 */
  pageId: string | null
  candidates: PageCandidate[]
  /** Graph 的原话 / 写库失败原因。有值就说明这次没跑干净。 */
  error?: string
}

interface RawAd {
  creative?: {
    object_story_spec?: { page_id?: string }
    /** "<page_id>_<post_id>" —— 从已有贴文建的广告只有这个。 */
    effective_object_story_id?: string
  }
}

interface GraphList<T> {
  data?: T[]
  paging?: { next?: string }
}

/** 一条广告能牵出的主页 ID。两个来源都试，取到哪个算哪个。 */
function pageIdOfAd(ad: RawAd): string | null {
  const direct = ad.creative?.object_story_spec?.page_id
  if (typeof direct === 'string' && /^\d+$/.test(direct)) return direct

  const story = ad.creative?.effective_object_story_id
  if (typeof story === 'string') {
    const head = story.split('_')[0]
    if (/^\d+$/.test(head)) return head
  }
  return null
}

/**
 * 广告账户里出现过的所有主页，按广告条数倒序。
 *
 * 出错时返回 `error` 且 `rows` 可能是**部分**结果 —— 调用方必须当「没查全」处理，
 * 绝不能拿半截结果去做「只有一个主页所以自动绑」这种判断。
 */
export async function discoverAdAccountPages(
  adAccountId: string,
  accessToken: string,
): Promise<{ rows: Array<{ pageId: string; adCount: number }>; error: string | null }> {
  const params = new URLSearchParams({
    fields: 'creative{object_story_spec{page_id},effective_object_story_id}',
    limit: '100',
    access_token: accessToken,
  })

  let url: string | undefined = `${GRAPH_BASE}/${adAccountId}/ads?${params.toString()}`
  const counts = new Map<string, number>()

  for (let page = 0; page < MAX_PAGES && url; page++) {
    let res: Response
    try {
      res = await fetch(url)
    } catch (err) {
      return { rows: tally(counts), error: `ads 网络错误: ${String(err)}` }
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { rows: tally(counts), error: `ads HTTP ${res.status}: ${body.slice(0, 400)}` }
    }

    let json: GraphList<RawAd>
    try {
      json = (await res.json()) as GraphList<RawAd>
    } catch (err) {
      return { rows: tally(counts), error: `ads 返回不是 JSON: ${String(err)}` }
    }

    for (const ad of json.data ?? []) {
      const pageId = pageIdOfAd(ad)
      if (pageId) counts.set(pageId, (counts.get(pageId) ?? 0) + 1)
    }
    url = json.paging?.next
  }

  // 还攥着 cursor 就退出 = 被上限截断了。静默截断跟「翻完了」长得一模一样，
  // 而这里判断「是不是只有一个主页」恰恰依赖「翻完了」。
  if (url) {
    return { rows: tally(counts), error: `ads 翻页到第 ${MAX_PAGES} 页仍未结束，主页清单可能不全` }
  }

  return { rows: tally(counts), error: null }
}

function tally(counts: Map<string, number>): Array<{ pageId: string; adCount: number }> {
  return Array.from(counts.entries())
    .map(([pageId, adCount]) => ({ pageId, adCount }))
    .sort((a, b) => b.adCount - a.adCount)
}

export interface BindablePageClient {
  id: string
  name: string | null
  meta_ad_account_id: string | null
  facebook_page_id: string | null
}

/**
 * 一个客户：查出主页 → 够条件就写进 `clients.facebook_page_id`。
 * 永不抛异常 —— 一个客户查不通不能让这一轮别的客户也不跑。
 */
export async function autoBindClientPage(
  supabase: SupabaseClient,
  client: BindablePageClient,
): Promise<PageBindResult> {
  const base = { clientId: client.id, clientName: client.name, candidates: [] as PageCandidate[] }

  if (client.facebook_page_id) {
    return { ...base, outcome: 'already_bound', pageId: client.facebook_page_id }
  }
  if (!client.meta_ad_account_id) {
    return { ...base, outcome: 'no_candidates', pageId: null }
  }

  const token = await getMetaTokenForClient(client.id)
  if (!token) return { ...base, outcome: 'no_token', pageId: null }

  const discovered = await discoverAdAccountPages(client.meta_ad_account_id, token)
  // 查不干净就到此为止：拿半截结果去判断「只有一个主页」会绑错人。
  if (discovered.error) {
    return { ...base, outcome: 'graph_error', pageId: null, error: discovered.error }
  }
  if (discovered.rows.length === 0) {
    return { ...base, outcome: 'no_candidates', pageId: null }
  }

  // `null` 是「问不到 Meta」，`[]` 是「一个主页都没授权给我们」—— 两者都不能自动绑，
  // 但前者是我们这边的故障、后者要客户去授权，说法不能一样。
  const managed = await listManagedPages(token)
  if (managed === null) {
    return {
      ...base,
      outcome: 'graph_error',
      pageId: null,
      error: '问不到我们能代管哪些主页（/me/accounts 没返回）',
    }
  }
  const managedNames = new Map(managed.map((p) => [p.id, p.name]))

  const candidates: PageCandidate[] = discovered.rows.map((r) => ({
    ...r,
    name: managedNames.get(r.pageId) ?? null,
    managed: managedNames.has(r.pageId),
  }))

  if (candidates.length > 1) {
    return { ...base, candidates, outcome: 'ambiguous', pageId: null }
  }

  const only = candidates[0]
  if (!only.managed) {
    return { ...base, candidates, outcome: 'needs_grant', pageId: null }
  }

  const { error } = await supabase
    .from('clients')
    .update({ facebook_page_id: only.pageId })
    .eq('id', client.id)

  if (error) {
    return { ...base, candidates, outcome: 'graph_error', pageId: null, error: `写库失败: ${error.message}` }
  }

  console.log(
    `[meta/page-discovery] ${client.name ?? client.id} 自动接上主页 ${only.pageId}` +
      `（${only.name ?? '名字未知'}，广告账户里 ${only.adCount} 条广告投在它上面）`,
  )
  return { ...base, candidates, outcome: 'bound', pageId: only.pageId }
}

/**
 * 所有「有广告账户、没接主页」的在跑客户，挨个试着接上。
 *
 * 放在表单同步 cron 的最前面跑：接上的客户**这一轮就能被同步捞到**，
 * 不用等下一个小时（否则新客户第一天永远白跑一轮）。
 */
export async function autoBindMissingPages(supabase: SupabaseClient): Promise<PageBindResult[]> {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, meta_ad_account_id, facebook_page_id')
    .not('meta_ad_account_id', 'is', null)
    .is('facebook_page_id', null)
    .eq('client_status', 'active')

  if (error) {
    console.error('[meta/page-discovery] 查客户失败:', error.message)
    return []
  }

  const results: PageBindResult[] = []
  for (const client of (data ?? []) as BindablePageClient[]) {
    try {
      results.push(await autoBindClientPage(supabase, client))
    } catch (err) {
      results.push({
        clientId: client.id,
        clientName: client.name,
        outcome: 'graph_error',
        pageId: null,
        candidates: [],
        error: String(err),
      })
    }
  }
  return results
}
