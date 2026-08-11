/**
 * 从 Meta 回读一个广告组的**真实落地状态** —— 建广告之后的强制一步。
 *
 * ── 为什么不能用「建广告时传了什么」代替 ─────────────────────────────────────
 * 2026-08-04 实测：创建接口的回显里**没有** Meta 自己补上的东西。
 *   · `targeting_relaxation_types` / `targeting_automation.advantage_audience`
 *     是 Meta 自动开的
 *   · `expanded_implicit_custom_audiences`（自动挂的相似人群）是 Meta 自动加的
 *   · 聊天模板里那句中文问候语，是 Meta 自动生成、自动开启的
 * 传参时它们都不存在，只有回读能看见。当天 5 个买家被中文问候语得罪，根因就是
 * 没有任何一步回读过「买家实际会看到什么」。
 *
 * ── 这个模块只负责「取」，不负责「判」────────────────────────────────────────
 * 判在 `lib/ads-strategy/launch-readback.ts`（纯规则、可单测）。
 * 形状转换在 `lib/ads-strategy/meta-readback-adapter.ts`。
 * 三段分开，是为了规则本身不依赖网络。
 *
 * ── 失败一律返回 null + 大声记日志 ──────────────────────────────────────────
 * 回读失败**不等于**「没问题」。调用方拿到 null 必须当成「查不出来」，
 * 不能当成「查过了没事」—— 这是本仓踩过的同一类坑（探针要能分辨两种结果）。
 */

import type { RawMetaAdSet, RawMetaAdCreative } from '@/lib/ads-strategy/meta-readback-adapter'

const GRAPH_BASE = 'https://graph.facebook.com/v21.0'

/** 广告组回读要的字段。targeting 必须整个拿回来 —— 我们要看的正是 Meta 补的那些。 */
const ADSET_FIELDS =
  'id,name,optimization_goal,destination_type,effective_status,campaign_id,targeting'

/**
 * 创意里所有**买家会看到**的文字。
 *
 * `object_story_spec` 里正文/标题/描述分散在 link_data / video_data 两种结构下，
 * 所以整块拿回来在 JS 里摘，比在 fields 里逐个点名稳 —— Meta 会按创意类型
 * 返回不同的子结构，点名少一个就静默丢一句买家能看到的话。
 */
const AD_FIELDS =
  'id,name,creative{id,object_story_spec,asset_feed_spec,body,title,effective_object_story_id}'

async function graphGet(url: string, label: string): Promise<unknown | null> {
  let res: Response
  try {
    res = await fetch(url)
  } catch (err) {
    console.error(`[meta/readback] ${label} fetch error:`, err)
    return null
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    console.error(`[meta/readback] ${label} HTTP ${res.status}:`, body.slice(0, 300))
    return null
  }
  try {
    return await res.json()
  } catch (err) {
    console.error(`[meta/readback] ${label} 返回不是 JSON:`, err)
    return null
  }
}

/** 回读一个广告组的真实设置。失败返回 null（= 查不出来，不是没问题）。 */
export async function fetchAdSetReadback(
  adSetId: string,
  accessToken: string,
): Promise<RawMetaAdSet | null> {
  const params = new URLSearchParams({ fields: ADSET_FIELDS, access_token: accessToken })
  const json = await graphGet(`${GRAPH_BASE}/${adSetId}?${params}`, `adset ${adSetId}`)
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  if (typeof o.id !== 'string') return null
  return o as unknown as RawMetaAdSet
}

/**
 * 从一条创意里摘出所有买家可见文字。
 *
 * 刻意「宁多勿漏」：多摘一句最多是让人多看一行，漏摘一句就是今天那句中文问候语
 * 又一次没被看见。
 */
export function extractBuyerFacingText(creative: unknown): string[] {
  const out: string[] = []
  const push = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) out.push(v.trim())
  }
  if (!creative || typeof creative !== 'object') return out
  const c = creative as Record<string, unknown>

  push(c.body)
  push(c.title)

  const spec = c.object_story_spec as Record<string, unknown> | undefined
  for (const key of ['link_data', 'video_data', 'photo_data'] as const) {
    const d = spec?.[key] as Record<string, unknown> | undefined
    if (!d) continue
    push(d.message)
    push(d.name)
    push(d.title)
    push(d.description)
    push(d.link_description)
    push(d.caption)
    // 聊天模板：问候语和建议回复按钮都是买家会看到的
    const greeting = d.page_welcome_message
    if (typeof greeting === 'string') pushWelcomeMessage(greeting, push)

    // 轮播卡片（2026-08-05 魏征 B5）：轮播广告的**每张卡都有自己的标题和描述**，
    // 而 `link_data.message` 只是卡片上方那一段。只摘 message 等于漏掉整条
    // 轮播广告的主体文案 —— 那次得罪 5 个买家的中文问候语，正是这种「在结构
    // 更深一层、于是没人看见」的东西。
    const cards = d.child_attachments
    if (Array.isArray(cards)) {
      for (const card of cards) {
        const cc = card as Record<string, unknown>
        push(cc.name) // 卡片标题
        push(cc.description) // 卡片描述
        push(cc.caption)
        const cta = cc.call_to_action as Record<string, unknown> | undefined
        push((cta?.value as Record<string, unknown> | undefined)?.link_title)
      }
    }
  }

  // 动态商品广告（DPA / Advantage+ catalogue）：文案在 `template_data` 里，
  // 不在 link_data。带 `{{product.name}}` 这类占位符 —— 占位符照样打出来：
  // 它至少告诉人「这条文案是拼出来的，得去商品目录核」，比一片空白强。
  // **只摘文本字段，绝不摘 id** —— id 混进买家可见文案会污染语言判定
  // （`dominantScript` 会把一串数字当成拉丁字母那一侧）。
  const tpl = spec?.template_data as Record<string, unknown> | undefined
  if (tpl) {
    push(tpl.message)
    push(tpl.name)
    push(tpl.description)
    push(tpl.link_description)
    push(tpl.caption)
  }

  // Advantage+ 素材自动化：文案散在 asset_feed_spec 的数组里
  const feed = c.asset_feed_spec as Record<string, unknown> | undefined
  for (const key of ['bodies', 'titles', 'descriptions'] as const) {
    const arr = feed?.[key]
    if (Array.isArray(arr)) for (const item of arr) push((item as { text?: unknown })?.text)
  }

  return Array.from(new Set(out))
}

/**
 * `page_welcome_message` 是一段**转义过的 JSON 字符串**，不是纯文本。
 * 直接当文本打出来会是一坨看不懂的东西，等于没打。
 */
function pushWelcomeMessage(raw: string, push: (v: unknown) => void): void {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const fmt = (parsed.message ?? (parsed as { text_format?: { message?: unknown } }).text_format?.message) as
      Record<string, unknown> | undefined
    push(fmt?.text)
    const replies = fmt?.quick_replies
    if (Array.isArray(replies)) for (const r of replies) push((r as { title?: unknown })?.title)
  } catch {
    // 解析不了就原样给出去 —— 看得懂看不懂，也好过悄悄丢掉。
    push(raw)
  }
}

/**
 * 一个广告账户里**当前在投**的所有广告组。失败返回 null（= 查不出来）。
 *
 * 为什么要有这个（2026-08-05 子牙复审的第一条）：
 *   原来只有「ME 自己建完广告顺手回读一次」这一个触发点，覆盖率约等于 0 ——
 *   真正得罪那 5 个买家的广告根本不是 ME 建的。改成每天扫一遍在投的广告组之后，
 *   **谁建的都管**，这才是这套闸门唯一有意义的入口。
 *
 * 只取 ACTIVE：暂停的组不会再花钱、也不会再有买家看到，今天没人需要为它做什么。
 */
export async function listActiveAdSets(
  adAccountId: string,
  accessToken: string,
): Promise<RawMetaAdSet[] | null> {
  const params = new URLSearchParams({
    fields: ADSET_FIELDS,
    // Meta 的 effective_status 过滤要 JSON 数组字符串。
    effective_status: JSON.stringify(['ACTIVE']),
    limit: '100',
    access_token: accessToken,
  })
  const json = await graphGet(
    `${GRAPH_BASE}/${adAccountId}/adsets?${params}`,
    `adsets of ${adAccountId}`,
  )
  if (!json || typeof json !== 'object') return null
  const rows = (json as { data?: unknown }).data
  if (!Array.isArray(rows)) return null
  return rows.filter(
    (r): r is RawMetaAdSet =>
      typeof r === 'object' && r !== null && typeof (r as { id?: unknown }).id === 'string',
  )
}

/** 回读一个广告组下所有广告的买家可见文案。失败返回 null。 */
export async function fetchAdCreativesReadback(
  adSetId: string,
  accessToken: string,
): Promise<RawMetaAdCreative[] | null> {
  const params = new URLSearchParams({ fields: AD_FIELDS, limit: '50', access_token: accessToken })
  const json = await graphGet(`${GRAPH_BASE}/${adSetId}/ads?${params}`, `ads of ${adSetId}`)
  if (!json || typeof json !== 'object') return null

  const rows = (json as { data?: unknown }).data
  if (!Array.isArray(rows)) return null

  const out: RawMetaAdCreative[] = []
  for (const r of rows) {
    const ad = r as Record<string, unknown>
    let texts = extractBuyerFacingText(ad.creative)

    // 自然帖投流（boost）：创意里**根本没有文案** —— 它在主页那条帖子上。
    // 不去取就等于这条广告在扫描里显示「没有买家文案」，而买家明明读得到字。
    // 2026-08-05 魏征 B5 指出的三个漏摘形态里，这个最隐蔽：它不是漏一句，
    // 是整条广告的文案一句都看不见。
    if (texts.length === 0) {
      const storyId = (ad.creative as Record<string, unknown> | undefined)
        ?.effective_object_story_id
      if (typeof storyId === 'string' && storyId) {
        const post = await fetchPostText(storyId, accessToken)
        if (post) texts = post
      }
    }

    out.push({ adId: String(ad.id ?? ''), adName: ad.name, texts })
  }
  return out
}

/**
 * 主页帖子上的文字。取不到返回 null（= 查不出来，不是没有）。
 *
 * 只在创意里一句文案都没摘到时才调 —— 每条广告多打一次 Graph 是有成本的，
 * 而绝大多数广告的文案就在创意里。
 */
async function fetchPostText(
  storyId: string,
  accessToken: string,
): Promise<string[] | null> {
  const params = new URLSearchParams({
    fields: 'message,name,description,caption',
    access_token: accessToken,
  })
  const json = await graphGet(`${GRAPH_BASE}/${storyId}?${params}`, `post ${storyId}`)
  if (!json || typeof json !== 'object') return null
  const p = json as Record<string, unknown>
  const texts = [p.message, p.name, p.description, p.caption]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim())
  return texts.length > 0 ? texts : null
}
