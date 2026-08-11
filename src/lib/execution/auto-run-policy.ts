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
  /** 挂在当前生效的方案下 —— A+P 现在还认这件事。ageDays 从批准时刻算 */
  | { kind: 'current_prescription'; ageDays: number }
  /** 近期分析周期刚生成的（诸葛亮当天/本周的卡）—— 也是新鲜判断 */
  | { kind: 'recent_analysis'; ageDays: number }
  /** 挂在还在跑的营销计划下 —— 表约束不允许它同时挂方案，这是第二根有效的锚 */
  | { kind: 'current_marketing_plan'; ageDays: number }
  /** 挂在已被替代/作废的方案下 —— 上一轮 A+P 已经不认它了 */
  | { kind: 'stale_prescription' }
  /** 挂在已结束/未批准的营销计划下 —— 这一期做完了，别再补作业 */
  | { kind: 'stale_marketing_plan' }
  /** 不挂任何方案，也不是近期分析产物 —— 没有任何人/任何一轮判断在背书 */
  | { kind: 'unendorsed'; ageDays: number }

/** 分析产物多新还算「当前判断」。超过就该重新过一遍 A+P，不该直接跑。 */
export const ENDORSEMENT_FRESH_DAYS = 8

/**
 * 方案（和营销计划）批准后多久还算「当前生效」。
 *
 * 🔴 没有这个上限时，`current_prescription` 是一张**永久通行证**。
 *    2026-08-05 实测：库里仅有的 2 件「可自动跑」动作，背后的方案分别是
 *    69 天和 83 天前批的 —— 而同一套判断里，分析产物只给 8 天保鲜期。
 *    一份两个多月没复核的方案，跟一张过期分析卡的可信度不该差这么远。
 *
 * 45 天 ≈ 一个半月，比周更方案的节奏宽得多：正常滚动的客户永远碰不到这条线，
 * 碰到的只有「方案早就停更了」的客户 —— 那种情况本来就该停下来叫人。
 */
export const PRESCRIPTION_FRESH_DAYS = 45

export interface AutoRunInput {
  actionType: string | null
  fixType: string | null
  status: string
  /**
   * 客户现在是什么状态。**必填，故意不给默认值** —— 漏传就 TS 报错。
   *
   * 🔴 这道闸挡的是「潜客 / 已归档客户的看板也被机器照着干活」。
   *    给默认值等于给了一条静默放行的路，而这类漏放行是不可逆的
   *    （东西已经替一个不是我们客户的公司写出来了）。
   */
  clientStatus: string
  /**
   * 这个客户开没开「每周一篇博客」。
   *
   * 🔴 用既有的 `seo_config.weekly_blog`，**不要另发明一个开关**。
   *    `client_status` 只有 active/prospect/archived 三档，没有 demo 这一维，
   *    拦不住 `Harbourline Physio (DEMO)` 这种演示账号；而周更开关是逐客户的、
   *    FDE 早就在用的那一个，两条生成线共用同一个开关才不会各开各的。
   *
   * ⚠️ 当前白名单三种类型全是写博客，所以这个开关就是「内容总闸」。
   *    将来白名单里进了非博客类型，这里必须跟着拆 —— 见白名单那条测试。
   */
  weeklyBlogEnabled: boolean
  /**
   * 卡上指定了具体要写哪个词 / 哪一页吗（`steps_json.keyword` / `.url`）。
   * 没指定传 null。**必填** —— 同样不给默认值。
   *
   * 🔴 指定了就不自动跑。原因：自动执行复用的是周更那条线，题目由
   *    机会数据自己挑（带去重和站内已覆盖检查）。卡上写着要打 A 词、
   *    机器却按数据挑了 B 词写完、还把卡标成「已完成」——
   *    那是拿一篇不相干的文章冒充战略动作做完了。
   */
  pinnedTopic: string | null
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

  // 🔴 客户闸排在**所有**判断前面。
  //    背书、白名单这些说的都是「这件事本身怎么样」，而客户闸说的是
  //    「这家公司该不该被我们的机器碰」—— 后者不成立时，前者对不对都没意义。
  //    潜客的看板上一样有诸葛亮排的动作，一样挂着白名单里的类型。
  if (item.clientStatus !== 'active') {
    return {
      run: false,
      reason: `这个客户现在不是在服务的状态（${item.clientStatus}），机器不替非客户干活`,
    }
  }
  if (!item.weeklyBlogEnabled) {
    return {
      run: false,
      reason: '这个客户没开每周内容（客户设置里的周更开关是关的），先开了才谈自动做',
    }
  }

  // 🔴 「该不该做」排在「能不能做」前面（PM 2026-08-04 定的顺序）。
  //    一件不该做的事，做得再安全、再自动也是错的 ——
  //    而看板上四分之三的东西没有任何一轮 A+P 在背书。
  const e = item.endorsement ?? { kind: 'unendorsed' as const, ageDays: Infinity }
  if (e.kind === 'stale_prescription') {
    return { run: false, reason: '这条属于已经被换掉的旧方案，先让新一轮方案重新判断它还该不该做' }
  }
  if (e.kind === 'stale_marketing_plan') {
    return { run: false, reason: '这条属于已经结束（或还没批准）的营销计划，那一期做完了，不补做' }
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
  // 方案 / 营销计划也有保质期 —— 没有这一段，「挂在已批准方案下」就是永久通行证
  if (
    (e.kind === 'current_prescription' || e.kind === 'current_marketing_plan') &&
    e.ageDays > PRESCRIPTION_FRESH_DAYS
  ) {
    const what = e.kind === 'current_prescription' ? '方案' : '营销计划'
    return {
      run: false,
      reason: `这条挂的${what}是 ${Math.round(e.ageDays)} 天前批的，太久没复核了，等新一轮重新判断`,
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

  // 卡上点名了要打哪个词 / 改哪一页 → 停手叫人。
  // 自动执行走的是周更那条线，题目由机会数据自己挑；按数据挑一个别的题目写完
  // 再把这张卡标成「已完成」，等于拿不相干的文章冒充战略动作做完了。
  if (item.pinnedTopic) {
    return {
      run: false,
      reason: `这条点名了要做「${item.pinnedTopic}」，而我只会按数据自己挑题，怕写歪 —— 这条你来点`,
    }
  }

  return { run: true }
}
