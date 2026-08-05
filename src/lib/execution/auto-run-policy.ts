/**
 * 哪些动作允许系统自己跑，哪些必须停下来叫人。
 *
 * PM 2026-08-04 拍板：「做到草稿为止，对外的等你点」「遇到卡点的再让我上，这才是自动化」。
 *
 * 🔴 **白名单，不是黑名单。** 只跑这里明确列出来的；认不出的一律停下来叫人。
 *    黑名单的失败方式是「漏了一种没想到的 → 它替客户发了东西出去」，
 *    白名单的失败方式是「漏了一种能自动的 → 那件事今天没自动做」。
 *    前者不可逆，后者只是慢一天。
 *
 * 🔴 **`fix_type='me_auto'` 这个字段本身不可信，绝不能单独作为放行依据。**
 *    2026-08-04 实测：库里标着 me_auto 的待办动作里混着大量根本不是机器能干的活 ——
 *    「SourceBottle 注册 + 媒体投稿启动」「Lighthouse + PageSpeed 全站审计」
 *    「5 个 SEO 落地页生成」都是几周的人工项目，只是 AI 顺手打了这个标。
 *    动作类型也是 AI 现编的自由文本（36 种，含 `diversify_meta_ad_creatives` 和
 *    `diversify_meta_creatives` 这种同义重复）。所以判据只认**精确匹配**的类型名。
 */

/**
 * 允许系统自己跑完、不用问人的动作类型。
 *
 * 入选标准，三条全满足才进：
 *   ① 机器真的能独立做完（不是「一个几周的项目名」）
 *   ② 产物**落在草稿态**——博客走 PR 等人合、内容进待审队列，访客看不到
 *   ③ 不花钱、不发到客户的网站/商家页/社媒上
 */
export const AUTO_RUNNABLE_ACTION_TYPES = [
  // 写博客初稿 —— 产物落成 `blog_posts.status='draft'`，躺在库里等人看。
  // 🔴 注意安全闸到底在哪：**是 draft 状态，不是 PR**。
  //    早先这里写的是「落成 PR 等人点 Merge」，那是错的 —— `draft → pr_open`
  //    需要有人手动调 /api/clients/[id]/cms/publish-blog，没有任何自动化在做。
  //    照着「PR 是安全闸」的错误理解去扩这个白名单，会扩出真会发到客户网站的东西。
  'generate_blog_post',
  'generate_seo_geo_blog_post',
  'generate_flooring_blog_post',
] as const

/**
 * 🔴 `seo.refresh_blog` 曾经在上面这个白名单里，**已移除，别加回来**。
 *
 * 它根本不是一个动作，是四条不同规则共用的一个标签（`seo-patrol/rules.ts`
 * 的 R1/R2/R3/R5），而 ME 里**没有任何「刷新已有文章」的执行器** ——
 * 唯一能改已有页面的 `lib/page-rewriter/` 是浏览器里的人工流程，cron 调不了。
 *
 * 把它接到博客生成器上，会按规则不同产生四种错误，最狠的一种是：
 * 诊断说「这个词从 #8 掉到 #26，去刷新排它的那篇」，机器**新写一篇打同一个词**
 * → 跟客户自己正在排名的页面抢位置，而且是每周自动地做。
 *
 * 将来真要接，判据必须是 `(action_type, steps_json.rule_id)` 的组合，
 * 不能只看 action_type —— 这也是本白名单当前设计的局限。
 */
export const NOT_AUTO_RUNNABLE_NEEDS_EXECUTOR = ['seo.refresh_blog'] as const

/**
 * 明确认定**对外或花钱**的类型 —— 永远不自动跑，进「等你点」。
 *
 * 单独列出来不是为了判定（白名单已经挡住一切），是为了给人看的话能说准：
 * 「这条我不能自己做，因为它会发到客户的商家页上」比「不在白名单里」有用得多。
 */
export const OUTWARD_ACTION_TYPES: Record<string, string> = {
  publish_geo_directive: '会写到客户网站上',
  publish_geo_snippet: '会写到客户网站上',
  gbp_posts: '会发到客户的商家页上',
  launch_social_campaign: '会发到客户社媒并开始花钱',
  link_social_accounts_and_launch_campaign: '会发到客户社媒并开始花钱',
  launch_google_ads_campaign: '会开始花广告费',
  expand_to_google_ads: '会开始花广告费',
  refresh_meta_ad_creatives: '会改正在投放的广告',
  diversify_meta_ad_creatives: '会改正在投放的广告',
  diversify_meta_creatives: '会改正在投放的广告',
  configure_target_keywords_and_publish_blog: '里面带发布动作',
  configure_target_keywords_via_blog: '里面带发布动作',
}

export type AutoRunVerdict =
  | { run: true }
  | {
      run: false
      /** 给人看的一句话：为什么这条我不自己做 */
      reason: string
    }

/**
 * 这条动作现在还被认着吗 —— 「该不该做」的依据。
 *
 * PM 2026-08-04：「这个事情到底应不应该做，应该用 DAPE 里面的 A+P 给出靠谱的结论」。
 *
 * 🔴 实测（在服务的客户，待办状态）：**272 件里有 204 件不挂在任何方案下**，
 *    最老的是 2026-05-14，快三个月。它们来自诸葛亮的每日卡、FDE 手工添加、
 *    早期计划遗留 —— 从来没有任何一次「这事现在还该不该做」的复判。
 *    Roman HU 的 7 件更极端：一件都不属于任何方案。
 *    照着这样的看板自动跑，跑得越快错得越多。
 */
export type Endorsement =
  /** 挂在当前生效的方案下 —— A+P 现在还认这件事 */
  | { kind: 'current_prescription' }
  /** 近期分析周期刚生成的（诸葛亮当天/本周的卡）—— 也是新鲜判断 */
  | { kind: 'recent_analysis'; ageDays: number }
  /** 挂在已被替代/作废的方案下 —— 上一轮 A+P 已经不认它了 */
  | { kind: 'stale_prescription' }
  /** 不挂任何方案，也不是近期分析产物 —— 没有任何人/任何一轮判断在背书 */
  | { kind: 'unendorsed'; ageDays: number }

/** 分析产物多新还算「当前判断」。超过就该重新过一遍 A+P，不该直接跑。 */
export const ENDORSEMENT_FRESH_DAYS = 8

export interface AutoRunInput {
  actionType: string | null
  fixType: string | null
  status: string
  /** 不传时按「没有背书」处理 —— 缺省必须是保守的那一边 */
  endorsement?: Endorsement
}

/**
 * 这条动作系统能不能自己跑。
 *
 * 顺序有讲究：先看状态（只碰没人动过的），再看类型白名单，
 * **最后**才看 fix_type —— 因为那个字段最不可信，只能用来否决，不能用来放行。
 */
export function judgeAutoRun(item: AutoRunInput): AutoRunVerdict {
  if (item.status !== 'pending') {
    return { run: false, reason: '这条不是待办状态，有人动过了' }
  }

  // 🔴 「该不该做」排在「能不能做」前面（PM 2026-08-04 定的顺序）。
  //    一件不该做的事，做得再安全、再自动也是错的 ——
  //    而看板上四分之三的东西没有任何一轮 A+P 在背书。
  const e = item.endorsement ?? { kind: 'unendorsed' as const, ageDays: Infinity }
  if (e.kind === 'stale_prescription') {
    return { run: false, reason: '这条属于已经被换掉的旧方案，先让新一轮方案重新判断它还该不该做' }
  }
  if (e.kind === 'unendorsed') {
    const age = Number.isFinite(e.ageDays) ? `（躺了 ${Math.round(e.ageDays)} 天）` : ''
    return {
      run: false,
      reason: `这条不挂在任何方案下${age} —— 没有任何一轮分析说过它该做，我不能凭它自己躺在看板上就去做`,
    }
  }
  if (e.kind === 'recent_analysis' && e.ageDays > ENDORSEMENT_FRESH_DAYS) {
    return {
      run: false,
      reason: `这条是 ${Math.round(e.ageDays)} 天前分析出来的，早过期了，等新一轮重新判断`,
    }
  }

  const t = (item.actionType ?? '').trim()
  if (!t) {
    // 没有动作类型的多半是方案里的阶段性描述（「第 1 周 7 篇 post 生成」这种），
    // 不是一条机器能执行的指令
    return { run: false, reason: '这条没写明具体要做什么动作，需要人看一眼拆细' }
  }

  const outward = OUTWARD_ACTION_TYPES[t]
  if (outward) {
    return { run: false, reason: `${outward}，按规矩要等你点头` }
  }

  if (!(AUTO_RUNNABLE_ACTION_TYPES as readonly string[]).includes(t)) {
    return { run: false, reason: `「${t}」这类动作我还不会自己做，需要人来` }
  }

  // 类型在白名单里了，最后用 fix_type 兜一道：人明确标了要手工做就别抢
  if (item.fixType === 'fde_manual' || item.fixType === 'third_party') {
    return { run: false, reason: '这条被标成要人工处理' }
  }

  return { run: true }
}
