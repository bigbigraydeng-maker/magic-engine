/**
 * 广告 ↔ 我们自己的片子 —— 「这条广告投的是哪条片」。
 *
 * ── 这个模块补的是哪一段断链 ──────────────────────────────────────────────────
 * `src/lib/crm/attribution.ts` 已经把「这个人是哪条广告带来的」收敛好了,但它头部
 * 明确写着 attr_creative_ref「拿不到」:Meta 的 lead 导出不返回 creative id,
 * 这一列的真相源只能是 ME 自己的出片管道。而出片管道那一侧,从来没有把
 * 「我们的片子」和「Meta 的广告」记在一起过 —— 于是那一列建了之后一直是空的。
 *
 * 完整链路:
 *
 *   content_work_orders.id            ← ME 的片子(稳定 id)
 *     └ published_ref.post_id         ← 发到 Facebook 后拿到的帖子 id
 *         └ ad_creative_links.ad_id   ← 建广告那一刻记下的对应关系(本模块)
 *             └ contacts.attr_ad_id   ← lead 带回来的广告 id
 *                 → contacts.attr_creative_ref
 *
 * ── 为什么必须在「建广告那一刻」记 ────────────────────────────────────────────
 * 那一刻是**唯一**知道对应关系的时刻:我们手里同时握着要推的帖子 id(Meta 的
 * object_story_id 结构上必须有它)和刚建出来的 ad_id。事后回头问 Meta「这条广告
 * 是哪条片」,Meta 只会回给你 creative 的 object_story_id —— 那是它自己的帖子 id,
 * 不是 ME 的片子 id;帖子 id → 片子 id 这一跳只有我们自己的库知道,而库里那份对应
 * 关系会随工单归档、published_ref 被覆盖而失真。所以记录点在写,不在事后跑批。
 *
 * ── 拿不到就留空,绝不猜 ──────────────────────────────────────────────────────
 * `decideCreativeLink` 是这条规矩的唯一落点,而且是纯函数(不碰 DB)—— 想改成
 * 「挑最近做的那条片子」这类启发式,只能改它,一改测试就红。
 * 尤其注意:**匹配到多条也算拿不到**。从中挑一条就是猜,而猜出来的归因会让
 * 「哪种内容带来真买家」学出反的结论 —— 比空着糟得多。
 *
 * ── 不静默失败 ────────────────────────────────────────────────────────────────
 * 认不出来照样落一行(creative_ref=NULL + 原因),而不是「查不到就不写」。
 * 不写 = 缺口不可数,而整条断链当初就是这么来的:各环节都正常,只有并排看才发现断了。
 * 落了行就能一句 SQL 问出「这个月建了几条广告、几条认不出是哪条片」。
 */

import { supabaseAdmin } from '@/lib/supabase'
import type { PlayKey, PlaySource } from '@/lib/ads-strategy/play-vocabulary'

/**
 * ME 里每一条会**建出 Meta 广告**的代码路径。刻意封闭。
 *
 * 加一条新的建广告路径时:往这个 union 里加一项 → `AD_CREATION_PATHS` 少一个 key
 * 就编译不过 → 逼你在那一刻回答「这条路径记不记素材 id」。这是 flywheel/
 * metric-registry.ts 那套「加了字典 key 不登记拉取方就编译不过」的同一招:
 * 靠类型把「新增了却没接上」变成编译期错误,而不是三个月后才发现表是空的。
 */
export type AdCreationPath = 'boost_post_api' | 'winner_reel_sync'

/** 每条路径的出处。穷举 by construction —— 少一个 key 就编译不过。 */
export const AD_CREATION_PATHS: Readonly<Record<AdCreationPath, string>> = {
  boost_post_api: 'src/app/api/clients/[id]/meta-ads/boost-post — 手动/脚本给某个帖子投流',
  winner_reel_sync: 'src/lib/winner-reel-sync/engine.ts — 把跑赢的自然帖子自动加进广告组',
  // 待加:'me_ad_launch' —— 广告引擎的建广告入口（PM 2026-08-04「go 收口」）。
  // **等那个路由真的存在了再加这一项**。本文件开头就写着「提前声明一个没人产出
  // 的值正是 enum 漂移」,我 2026-08-04 差点犯这个错,被本模块自己的测试拦下。
}

/**
 * creative_ref 指向哪张表。
 *
 * 只有一个值不是写漏了:reels_drafts 那条线走 Publer 发布,Publer 只回 job_id、
 * 不回平台帖子 id(见 src/app/api/clients/[id]/reels/[draftId]/publish/route.ts),
 * 所以那条线上的片子**现在接不上**。等 Publer 回执里能拿到 post_id 再加
 * 'reels_draft' —— 提前声明一个没人产出的值,正是 CLAUDE.md 说的 enum 漂移。
 */
export type CreativeSource = 'content_work_order'

/** 怎么认出来的。 */
export type LinkMethod = 'published_post_id' | 'unresolved'

/** 一条候选:ME 的某条片子,发布后成了平台上的哪个帖子。 */
export interface CreativeCandidate {
  /** ME 的稳定素材 id(当前 = content_work_orders.id)。 */
  creativeRef: string
  creativeSource: CreativeSource
  /** 这条片子发布后拿到的平台帖子 id。 */
  postId: string
}

/** 判定结果。creativeRef 为 null = 如实留白,unresolvedReason 说明为什么。 */
export interface AdCreativeLink {
  creativeRef: string | null
  creativeSource: CreativeSource | null
  linkMethod: LinkMethod
  unresolvedReason: string | null
}

/**
 * Facebook 的帖子 id 有两种写法:`"<page_id>_<post_id>"` 和裸 `"<post_id>"`。
 * 建广告的入参用前者(object_story_id),published_ref 里存的是后者。
 * 统一取下划线后那一段再比,否则同一个帖子会被当成两个。
 */
export function normalisePostId(raw: string): string {
  const s = raw.trim()
  const idx = s.lastIndexOf('_')
  return idx >= 0 ? s.slice(idx + 1) : s
}

/** 认不出来时的统一结果。 */
function unresolved(reason: string): AdCreativeLink {
  return { creativeRef: null, creativeSource: null, linkMethod: 'unresolved', unresolvedReason: reason }
}

/**
 * 帖子 id + 候选片子 → 判定。纯函数,「绝不猜」这条规矩的唯一落点。
 *
 * 三种结局,只有一种给得出 creativeRef:
 *   · 精确命中 1 条 → 认。
 *   · 一条都没命中 → 留空(这个帖子不是 ME 出片管道发的,或者当时没记上)。
 *   · 命中多条     → **也留空**。挑一条就是猜;宁可这条广告的归因空着,
 *                     也不要让下游学出「这类片子有效」的反结论。
 */
export function decideCreativeLink(
  postId: string,
  candidates: readonly CreativeCandidate[],
): AdCreativeLink {
  const target = normalisePostId(postId)
  if (!target) return unresolved('建广告时没拿到帖子 id')

  const hits = candidates.filter((c) => normalisePostId(c.postId) === target)

  if (hits.length === 0) {
    return unresolved(`帖子 ${target} 不对应任何已发布的 ME 工单(可能是人工在 Meta 后台发的帖子)`)
  }
  if (hits.length > 1) {
    const refs = hits.map((h) => h.creativeRef).join(',')
    return unresolved(`帖子 ${target} 同时命中 ${hits.length} 条工单(${refs}),挑一条就是猜,留空`)
  }

  const hit = hits[0]
  return {
    creativeRef: hit.creativeRef,
    creativeSource: hit.creativeSource,
    linkMethod: 'published_post_id',
    unresolvedReason: null,
  }
}

/** published_ref 的形状(publish-worker 写的)。只取判定要用的两项。 */
interface PublishedRefRow {
  id: string
  published_ref: { post_id?: unknown } | null
}

/**
 * 拉这个客户所有「已发布且记了平台帖子 id」的工单,当候选。
 *
 * 为什么整批拉回来再在 JS 里比,而不是直接 SQL 过滤 post_id:帖子 id 有带页前缀和
 * 不带两种写法,归一化必须跟 `decideCreativeLink` 用同一份逻辑,否则「绝不猜」的
 * 规矩就散在两个地方了。量级上没问题(一个客户的已发布工单是个位数到几十),
 * 而且每建一条广告才跑一次。真长到几千行时再加表达式索引 + SQL 前置过滤。
 */
async function loadPublishedCandidates(clientId: string): Promise<CreativeCandidate[]> {
  const { data, error } = await supabaseAdmin
    .from('content_work_orders')
    .select('id, published_ref')
    .eq('client_id', clientId)
    .not('published_ref', 'is', null)

  if (error) throw new Error(`查已发布工单失败: ${error.message}`)

  return ((data ?? []) as PublishedRefRow[]).flatMap((row) => {
    const postId = row.published_ref?.post_id
    if (typeof postId !== 'string' || !postId.trim()) return []
    return [{ creativeRef: row.id, creativeSource: 'content_work_order' as const, postId }]
  })
}

export interface LinkAdToCreativeArgs {
  clientId: string
  /** 刚建出来的广告 id。 */
  adId: string
  /** 这条广告推的帖子(建广告的必填入参,所以这里一定有)。 */
  postId: string
  pageId?: string | null
  /** 哪条代码路径建的。见 AD_CREATION_PATHS。 */
  createdBy: AdCreationPath
  platform?: 'meta'
  /**
   * 这条广告用的是哪个打法。见 lib/ads-strategy/play-vocabulary.ts。
   *
   * 跟 creativeRef 同一条规矩:**拿不到就留空,绝不猜**。
   * 硬猜会让打法账本学出反的结论 —— 比空着糟得多。
   *
   * 记在这一刻,是因为这一刻是唯一确定知道的时刻:事后从广告名字解析,会撞上
   * 三套命名规范、最花钱那条零信息量的名字、以及被事后改写成事故记录的名字。
   */
  play?: PlayKey | null
  playSource?: PlaySource | null
  /** 描述性标签(语种/角度等)。只做展示筛选,**不做统计比较**。 */
  playContext?: Record<string, unknown> | null
}

/**
 * 建完广告立刻调:认一次片子,然后无论认没认出来都落一行。
 *
 * **永不抛异常**。调用它的时候广告已经在 Meta 上真建出来了 —— 这里抛出去会让上层
 * 以为建广告失败(可能触发重试 → 重复建广告花钱)。所以失败一律吞掉 + 大声记日志,
 * 返回当时能给出的判定。
 */
export async function linkAdToCreative(args: LinkAdToCreativeArgs): Promise<AdCreativeLink> {
  const platform = args.platform ?? 'meta'

  let link: AdCreativeLink
  try {
    link = decideCreativeLink(args.postId, await loadPublishedCandidates(args.clientId))
  } catch (err) {
    link = unresolved(`查候选片子失败: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!link.creativeRef) {
    // 静默跳过正是整条断链的根因,所以这里必须吵。
    console.warn(
      `[ads/creative-link] 广告 ${args.adId}(${args.createdBy})认不出是哪条片子: ${link.unresolvedReason}`,
    )
  }

  await persistLink(args, platform, link)
  return link
}

/**
 * 落库。**整段包在 try 里**:不只是 supabase 返回的 error,连 fetch 抛出的网络异常
 * 也要吞掉。这一步失败只意味着「归因少了一条」,而让它抛出去会被上层当成建广告失败,
 * 进而重试建广告 —— 花钱建出重复广告,比丢一条归因严重得多。
 */
async function persistLink(
  args: LinkAdToCreativeArgs,
  platform: 'meta',
  link: AdCreativeLink,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from('ad_creative_links').upsert(
      {
        client_id: args.clientId,
        platform,
        ad_id: args.adId,
        page_id: args.pageId ?? null,
        post_id: args.postId,
        creative_ref: link.creativeRef,
        creative_source: link.creativeSource,
        link_method: link.linkMethod,
        unresolved_reason: link.unresolvedReason,
        created_by: args.createdBy,
        // 打法账本。三个字段一起写:play 为空时 source 也不该有值,
        // 否则会出现「不知道是什么打法,但知道是怎么知道的」这种自相矛盾的行。
        play: args.play ?? null,
        play_source: args.play ? (args.playSource ?? null) : null,
        play_context: args.playContext ?? null,
      },
      { onConflict: 'client_id,platform,ad_id' },
    )
    if (error) throw new Error(error.message)
  } catch (err) {
    console.error(
      `[ads/creative-link] 广告 ${args.adId} 的素材对应关系没记上(广告已建出,不回滚): ` +
        (err instanceof Error ? err.message : String(err)),
    )
  }
}

/**
 * 归因读侧:这条广告投的是哪条片子。查不到就 null。
 *
 * 永不抛异常 —— 调用方(lead 接入)不该因为归因查不到就把整条 lead 丢掉。
 */
export async function lookupCreativeRefByAdId(
  clientId: string,
  adId: string | null | undefined,
  platform: 'meta' = 'meta',
): Promise<string | null> {
  if (!adId) return null

  try {
    const { data, error } = await supabaseAdmin
      .from('ad_creative_links')
      .select('creative_ref')
      .eq('client_id', clientId)
      .eq('platform', platform)
      .eq('ad_id', adId)
      .maybeSingle()

    if (error) throw new Error(error.message)
    const ref = (data as { creative_ref?: unknown } | null)?.creative_ref
    return typeof ref === 'string' && ref ? ref : null
  } catch (err) {
    console.error(
      `[ads/creative-link] 查广告 ${adId} 的素材失败: ` +
        (err instanceof Error ? err.message : String(err)),
    )
    return null
  }
}
