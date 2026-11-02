/**
 * 今日待办只给 PM 留五类事（PM 2026-09-26 拍板）。
 *
 * 2026-09-25 那封邮件标题 166 件，真要 PM 管的大约 10 件。其余是：过期的咨询回传
 * 提醒、推销邮件当成「客人来信」、开发欠账、系统知会、SEO 巡逻数字。PM 的口径：
 *
 *   1. decide       要拍板的：撤不回 / 花钱 / 对外
 *   2. one_click    系统进不去、要人点一次的：授权、充值、第三方后台按钮
 *   3. client_side  要转给客户那边的：客人来信没回、客户网站 / 统计后台设置
 *   4. review       发出去前要看一眼的：文章、视频、LinkedIn 帖
 *   5. truth        系统判不了真假的：客户资料串台、共用广告账户归因
 *
 * 不属于这五类的也**不许消失**（铁律 3 下半：发现不许死在日志里），只是换一条
 * 有人读的管道：
 *
 *   dev     → 后台「自动任务健康」页的「开发欠账」栏（/dashboard/admin/cron-health#dev-debt，
 *             接口 /api/admin/dev-debt）；PM 邮件里只留一行「N 件开发欠账」+ 链接
 *   weekly  → 周一周报（weekly-seo-report）的「这周系统替你做了什么」
 *
 * ## 为什么是一张穷举表
 *
 * `LANE_OF_KIND` 的类型是 `Record<ManualItemKind, TodoLane>`：以后谁新加一种待办，
 * 不在这里给它分好车道，类型检查就过不了。之前的两份名单（开发欠账 / 知会）是
 * 「不在名单里就默认进 PM 动手栏」，新 kind 一律悄悄落进 PM 的清单 —— 166 件
 * 就是这么一条条攒出来的。
 *
 * ## 一个名字下装着两种活怎么办
 *
 * 拆成两个 kind（比如邮箱「授权掉了」email_sync_stale 要人点，「同步卡住」
 * email_sync_broken 归开发），不做逐条改车道 —— 逐条改是第二个真相源，写错一处
 * 一条待办就从 PM 眼前消失了（子牙 2026-09-26 设计复审）。唯一的逐条字段
 * `ManualItem.pm_kind` 只能在五类之间换，挪不出 PM 的清单。
 */

import type { ManualItem, ManualItemKind } from './manual-item-types'

export type PmKind = 'decide' | 'one_click' | 'client_side' | 'review' | 'truth'

export type TodoLane = PmKind | 'dev' | 'weekly'

/** 邮件和页面都按这个顺序出栏。 */
export const PM_KIND_ORDER: readonly PmKind[] = ['decide', 'one_click', 'client_side', 'review', 'truth']

export const PM_KIND_TITLE: Record<PmKind, { emoji: string; title: string }> = {
  decide: { emoji: '✋', title: '要你拍板的（撤不回 / 花钱 / 对外）' },
  one_click: { emoji: '🔌', title: '系统进不去、要你点一次的' },
  client_side: { emoji: '📨', title: '要转给客户那边的' },
  review: { emoji: '👀', title: '发出去前要你看一眼的' },
  truth: { emoji: '⚖️', title: '系统判不了真假、要你认一下的' },
}

export function isPmKind(lane: TodoLane): lane is PmKind {
  return lane !== 'dev' && lane !== 'weekly'
}

export const LANE_OF_KIND: Record<ManualItemKind, TodoLane> = {
  // ── 1 · 要拍板的（撤不回 / 花钱 / 对外）─────────────────────────────
  conversion_needs_review: 'decide', // 告诉广告平台一笔成交，撤不回
  payment_email_needs_human: 'truth', // 邮件说收到款了、系统判不了真假/金额，要人核对
  ai_auto_review_circuit_breaker: 'decide', // 重新打开「AI 自动发给广告平台」
  ads_auto_pause_pending: 'decide', // 暂停在花钱的广告组
  tour_publish_requested: 'decide', // 客户员工请我们把团目录的修改上架（对外）
  // 广告自治被熔断器冻住了，要不要恢复自动动手是个决定；同 ads_auto_pause_pending 一档
  // （WP3.1b 重做 PR A，2026-09-28 合并主干时补——这份穷举表在那个 PR 分叉之后才建）
  ads_circuit_tripped: 'decide',
  ads_service_pause_notice: 'decide', // 系列已暂停，要不要恢复由人点确认卡
  ads_account_not_active: 'one_click', // 去 Meta 付款设置结清欠款、补备用卡（系统进不去）
  ads_account_status_unreadable: 'dev', // 账户状态读不到：快照任务的问题，开发看，不占 PM 的清单
  ads_account_closed_weekly: 'decide', // 账户已关闭：要不要从客户名下解绑，由 PM 定（每周一提醒）
  goal_rollover_missing: 'dev', // 月循环目标没自动续上：广告自治/日报失去目标口径，是系统没跑通，转开发
  ads_rule_finding: 'decide', // 改不改在投的广告
  ad_readback_blocker: 'decide', // 正在花钱的广告组撞上已知坑，要改设置
  outcome_rows_orphaned: 'decide', // 旧效果数据删还是留（删了撤不回）
  maliang_render_failed: 'decide', // 成片不过关：返工（花钱）还是放弃
  // （台账的「决定了没人动」「验过不成」2026-10-12 起不在这里了：PM 拍板——邮件只发
  //  「机器完成不了、必须他本人做」的事；这两类是窗口和开发的活，一次堆出 118 张卡，
  //  PM 不会一条条看。见下面 dev 栏。）
  // 依法要求删数据我们答应了却没做到 —— 对外 / 合规义务。how 虽是「让开发查」，但主干明确
  // 要它留在 PM 可见栏（不许只写日志、进了 NEVER_DROP_KINDS），风险归 PM 拍板一栏。
  meta_data_deletion_failure: 'decide',
  // Magic Bridge 免费名额快满：加不加额度、加到多少美元由 PM 定（花钱）；不加则新客户到月底出不了报告
  magic_bridge_quota: 'decide',
  tools_wide_budget_warning: 'decide',
  // 推广计划每日检查：草稿等你批准 / 批准后内容被改 / 到期阶段检查没过 / 对账偏差——都是批准、花钱、改计划，要 PM 拍板
  promo_plan_watch: 'decide',
  lead_followup_check_failed: 'dev', // 「填了表没人回」这一栏没算出来：我们这边的欠账
  promo_plan_watch_broken: 'dev', // 每日检查自己没跑成：我们这边的欠账，PM 那一栏会留一句「今天没查成」
  plan_draft_auto_failed: 'dev', // 同意前自动起草连续失败：系统没写成，不占批准决定
  ads_tracking_preflight_fix: 'dev', // 开投前追踪检查的红灯怎么修：改官网 / 改配置，开发的活（PM 在推广计划页看灯，开投拍板走「到期阶段检查没过」）
  ads_tracking_preflight_broken: 'dev', // 开投前追踪检查自己没跑成：我们这边的欠账，PM 那一栏会留一句「今天没查成」

  // ── 2 · 系统进不去、要人点一次的 ─────────────────────────────────────
  ai_provider_exhausted: 'one_click', // 充值
  // 某客户 AI 可见度探测整周全挂，多数是余额用光/钥匙失效，需要人去充值/换钥匙
  // （Codex 复审 2026-09-28 抓到：漏了这条会让 LANE_OF_KIND 穷举表类型检查过不了，
  // laneOf() 拿到 undefined，所有新告警从 PM 清单和邮件里彻底消失）
  ai_tracker_all_failed: 'one_click',
  video_credits_out: 'one_click', // 充值
  dataforseo_credits_out: 'one_click', // 充值
  creatomate_render_failed: 'one_click', // 多数是出片额度用完，要人充值
  platform_connection_broken: 'one_click',
  platform_connection_token_expired: 'one_click',
  platform_connection_silent: 'one_click',
  platform_connection_scope_gap: 'one_click',
  meta_token_dead: 'one_click',
  facebook_sync_failing: 'one_click', // 主页管理员重新「连接 Meta」
  comment_scope_missing: 'one_click',
  comment_token_invalid: 'one_click',
  comment_autoreply_run_failing: 'dev', // 评论 cron 连续多轮没扫完：授权 / Meta 接口问题，开发看日志
  comment_reply_scope_missing: 'one_click', // 主页管理员重新「连接 Meta」并勾上管理评论权限
  comment_needs_human_reply: 'client_side', // 主页评论要人公开回，不含自动回复范围改动
  comment_human_check_failed: 'dev', // 「要人回」清单读不出来
  conversion_capi_token_dead: 'one_click',
  daily_plan_post_unmeasured: 'one_click', // 重新连接 Meta / 确认帖子公开
  daily_plan_first_comment_failed: 'one_click', // 在帖子下补发首评（文案已写好，复制即可）
  social_readback_refused: 'one_click', // 打开视频看是不是已经公开，公开了就转给开发
  mailchimp_export_broken: 'one_click', // 设置页填回 Mailchimp Audience ID
  lead_sheet_reauth_needed: 'one_click', // 写表被 Google 判 403，重新走一次「连接 Google」
  calendar_closure_overdue_summary: 'truth', // 日历到期没闭环的件数：「认一下」哪些真做了
  calendar_closure_calendar_unreadable: 'one_click', // 读不到 PM 日历：机器账号 / 日历共享要人点一次
  calendar_closure_probe_failed: 'decide', // 自动核对没达预期：接着等还是关掉，要 PM 判断
  blog_publish_channel_broken: 'one_click', // 去设置里把网站发布通道接通
  factory_worker_idle: 'one_click', // 出片机器没开机，只有人能开
  factory_render_worker_down: 'one_click', // 渲染引擎没就绪，要人在那台机器上修好
  factory_review_overdue: 'review', // 片子待审超过 24 小时，审核的人看一眼
  factory_dead_letter_stuck: 'one_click', // 死信不会再自动重跑，要人看这张工单
  factory_material_check_failed: 'dev', // 待审/死信清单没读出来，是检查自己的欠账
  email_sync_stale: 'one_click', // 邮箱授权掉了 / 一个都没连上
  whatsapp_number_unclaimed: 'one_click', // 号码在发消息但没客户绑定它，去设置页绑一次
  client_doc_manual_task: 'one_click', // 方案文档里的一次性人工动作；条目可用 pmKind 换一类
  // 主干合进去的代码没上线（各窗口说的「已上线」不算数）：看上线记录，催修复 PR 尽快合、或回一句
  // 「修上线」。主干明确要它留在 PM 可见栏（进了 NEVER_DROP_KINDS），不进开发欠账被埋掉。
  deploy_not_live: 'one_click',

  // ── 3 · 要转给客户那边的 ─────────────────────────────────────────────
  email_reply_due: 'client_side', // 客人来信没回
  lead_followup_due: 'client_side', // 客人填了表超过 24 小时没人回，转给客户的销售
  email_first_contact: 'client_side', // 陌生地址第一次来信：扫一眼主题，真询价就回
  lead_sheet_lead_skipped: 'client_side', // 线索没联系方式，去 Meta 后台查原始提交再补进客户的表
  // 线索写不进客户的表（不是授权问题）：先确认客户那张表还在、账号能编辑 —— 新线索没到销售手上
  lead_sheet_sync_failed: 'client_side',
  meta_stuck: 'client_side', // 客户网站上的 ME 插件停了
  leads_metric_untrusted: 'client_side', // 客户统计后台的「关键事件」设置
  knowledge_fact_expiring_soon: 'client_side', // 团期 / 价格要跟客户确认
  crm_important_due: 'client_side', // 客户员工约好的回电
  phone_call_needs_review: 'client_side', // 电话没能自动记进客人档案，客户销售要看一眼是谁
  messenger_draft_send_failed: 'client_side', // 回复没发出去，要人工发给客人
  tool_lead_needs_followup: 'client_side', // 工具实验室有人留资，值得联系一下

  // ── 4 · 发出去前要看一眼的 ───────────────────────────────────────────
  blog_draft_waiting: 'review',
  blog_pr_open: 'review',
  linkedin_progress_needs_review: 'review', // 历史：LinkedIn 自动发帖已下线，仅夹具使用
  maliang_render_passed: 'review',
  libai_copy_unverified: 'review',
  simaqian_review_drafts: 'review',
  messenger_draft_pending_approval: 'review',
  messenger_draft_escalation: 'review',
  price_claim_unbacked: 'review',
  price_fact_unverified: 'review',
  auto_publish_stalled: 'review', // 该发的帖子没发出去：看原因、决定重发还是改
  auto_publish_unknown_outcome: 'truth', // 系统判不了真假：帖子到底有没有发出去，只有看主页的人知道
  auto_publish_unarmed: 'review', // 已授权却没动静：发布器可能没跑
  story_stalled: 'review', // 某条 Story 没发出去：看原因、决定重发还是改
  story_unknown_outcome: 'truth', // 系统判不了真假：Story 到底有没有发出去，只有看主页的人知道
  story_unarmed: 'review', // 已授权却没动静：发布器可能没跑
  auto_publish_record_conflict: 'truth', // 记录说撤回了、回执说又发了：帖子到底在不在主页，只有看主页的人知道

  // ── 5 · 系统判不了真假的 ─────────────────────────────────────────────
  cross_client_leak: 'truth',
  dnc_maybe_wrong: 'truth',
  dm_maybe_stop: 'truth',
  paid_signal_needs_review: 'truth',
  goal_baseline_mismatch: 'truth',
  facebook_page_binding_unverified: 'truth',
  ad_account_binding_requested: 'truth',
  conversion_send_in_doubt: 'truth',
  conversation_health_alert: 'truth',

  // ── 开发的活 → 每天的系统故障日报 ────────────────────────────────────
  // how 字段自己写着「这条不用你动手 / 回我一句我去修」的，都是我们代码或基础设施的欠账
  auto_run_stuck: 'dev',
  kernel_needs_human: 'dev', // 三种文案都写「不用你做 / 回我一句」，审批页还没建
  email_sync_broken: 'dev',
  creatomate_render_error: 'dev', // 不是额度问题的做片失败
  conversation_health_check_error: 'dev', // AI 起草回复一直报错
  action_unattributable: 'dev',
  attribution_audit_failed: 'dev',
  client_list_unreadable: 'dev',
  cron_blind: 'dev',
  cron_stuck: 'dev',
  cron_failing: 'dev',
  ads_config_unreadable: 'dev', // 广告回拉读不出广告设置，字段没对齐或临时故障，都是我们的活
  cron_not_running: 'dev',
  cron_silent_success: 'dev',
  ai_alerting_broken: 'dev',
  // 某客户整周 AI 可见度全挂，但原因清一色是「不用你动手」的那几类（限流/供应商出错/
  // 解析失败/我们数据库写入失败）—— 没有充值或换钥匙这种需要人点一次的动作，
  // 同 ai_tracker_all_failed 的 how 原文就写「这条不用你动手」，不该进 PM 动手栏
  // （Codex 复审 2026-09-28）。
  ai_tracker_all_failed_dev: 'dev',
  diagnostic_synthesis_failing: 'dev',
  seo_rank_verdict_overdue: 'dev', // 标题改动效果判定没出：我们的欠账
  seo_rank_baseline_missing: 'dev', // 标题改动没记改前名次：我们的欠账 // 体检叙事没写成：我们的欠账，不用 PM 动手
  ai_gateway_broken: 'dev',
  playbook_reference_stale: 'dev',
  platform_connection_pipeline_down: 'dev',
  platform_connection_check_failed: 'dev',
  platform_connection_not_enrolled: 'dev',
  platform_connection_no_reconnect_ui: 'dev',
  platform_connection_orphan: 'dev',
  maliang_check_unverifiable: 'dev',
  maliang_check_missing: 'dev',
  libai_check_unverifiable: 'dev',
  libai_check_missing: 'dev',
  libai_prompt_library_stale: 'dev',
  simaqian_patrol_failed: 'dev',
  meta_token_check_failed: 'dev',
  deploy_check_failed: 'dev', // 「合了没上线」这个检查自己没跑成 —— how 写「不用你动手 / 回我一句我去修」
  ads_autonomy_sync_failed: 'dev',
  crawl_stale: 'dev', // 重扫本该系统自己跑；还不好就是要换读取通道
  crawl_blocked: 'dev', // how 原文：「先别找客户…回一句『换通道』」
  lead_sheet_value_unmapped: 'dev', // 「发到开发窗口加进对照表」
  lead_sheet_unrouted: 'dev', // 「发到开发窗口补一条兜底规则」
  lead_sheet_backfill_pending: 'dev', // 「跟开发窗口说一声跑一次试算」
  lead_sheet_backfill_count_unreliable: 'dev',
  lead_sheet_check_failed: 'dev',
  calendar_closure_check_failed: 'dev', // 日历巡检自己没跑成
  calendar_closure_needs_human: 'dev', // 到期事项没法自动核对：找窗口验一下
  calendar_closure_no_ledger: 'dev', // 日历事件没有可用 ledger-id：补上编号或补建台账卡
  todo_items_unreadable: 'dev',
  // 平台治理：复查候选有没有新证据不是撤不回 / 花钱 / 对外，是开发窗口的日常活
  // （me-platform-tier-gate：L1 候选由子牙 / 魏征扫）。真要晋升时是商业决定，会作为
  // 一件新的拍板事再来找 PM。
  platform_candidate_review_due: 'dev',
  // 台账：做完了去验、目录读不出、夜巡没来 —— 都是做事的窗口 / 开发的活
  // 台账：决定了没人动、验过不成 —— 窗口 / 开发去取消、认领或重做；PM 邮件里只留一行总数。
  // CLAUDE.md §9.6「台账每个工作日被今日待办读一遍」仍成立：它们在「开发欠账」清单里每天重算。
  ledger_decided_stale: 'dev',
  ledger_verification_failed: 'dev',
  ledger_done_unverified: 'dev',
  ledger_unreadable: 'dev',
  ledger_patrol_missing: 'dev',

  // ── 知会 → 周一周报 ──────────────────────────────────────────────────
  calendar_closure_probe_passed: 'weekly', // 自动核对通过但只是部分证据：周报里报，窗口去补确认
  prescription_updated: 'weekly', // 本周已批准方案的进度复查
  diagnostic_findings: 'weekly', // 本周体检结果，已排成看板动作
  not_indexed: 'weekly', // 未收录页面汇总：SEO 日常活（FDE / 开发在修），周报里报进度
  auto_run_blocked: 'weekly', // 「多数情况下不用你动手，周二会自动重判」
}

/**
 * 这条待办该进哪条管道。
 *
 * 条目自带的 `pm_kind` 只在「默认本来就在 PM 五类里」时生效 —— 它只能在五类之间换，
 * 永远不能把一条待办挪出 PM 的清单。
 */
export function laneOf(item: ManualItem): TodoLane {
  const lane = LANE_OF_KIND[item.kind]
  return isPmKind(lane) && item.pm_kind ? item.pm_kind : lane
}

/**
 * 这些开发欠账**一出现，就说明 PM 某一栏今天其实没查成**。
 *
 * 把它们挪给开发之后，PM 那一栏会显示「没有」—— 而「没查」和「查了没有」在清单上
 * 长得一模一样（子牙 2026-09-26 设计复审）。所以挪走的同时，在清单顶上留一句不计数的
 * 「今天没查成」，让他知道这一栏的空是假的。
 */
export const BLIND_SPOT_NOTE: Partial<Record<ManualItemKind, string>> = {
  client_list_unreadable: '客户名单今天读不出来，大部分检查都没跑 —— 下面的清单不全',
  email_sync_broken: '公司邮箱同步出了问题，「客人来信没回」今天可能不全',
  platform_connection_check_failed: '授权体检今天没跑成，断了的连接可能没列出来',
  platform_connection_pipeline_down: '有个平台所有客户一起没了心跳，那边断没断今天看不出来',
  ai_alerting_broken: 'AI 账户断电告警今天自己没读出来 —— 没报不等于没事',
  meta_token_check_failed: 'Meta 钥匙检查今天没跑成 —— 钥匙死了可能没报出来',
  deploy_check_failed: '上线检查今天没跑成 —— 合进去的代码没上线也可能没报出来',
  ledger_unreadable: '台账今天读不出来，「决定了没动 / 验了不成」可能没列出来',
  simaqian_patrol_failed: '口碑周巡没跑成，这周的评价回复草稿可能没出来',
  todo_items_unreadable: '人工待办今天整个没读出来 —— 下面的清单不全',
  lead_sheet_check_failed: '「线索进客户表格」的检查今天没跑成，表格缺没缺人看不出来',
  calendar_closure_check_failed: '日历到期事项巡检今天没跑成，带日期的验证事项可能没人查',
  calendar_closure_calendar_unreadable: '今天读不到 PM 日历，带日期的验证事项没人查',
  maliang_check_missing: '有成片出来后没做自检，「等你审片」可能没列全',
  ai_gateway_broken: 'AI 调用卡在网关，今天写稿 / 起草类的东西可能都没出来',
  cron_not_running: '有自动任务没按时跑，它负责的那一栏今天可能不全',
  cron_silent_success: '有自动任务显示跑完了但一行没写，它负责的那一栏今天可能不全',
  promo_plan_watch_broken: '推广计划每日检查今天没跑成，计划有没有问题看不出来',
  ads_tracking_preflight_broken: '开投前追踪检查今天没跑成，像素 / 落地页 / 留资有没有问题看不出来',
  libai_check_missing: '有文案生成后没做溯源检查，「未证实的句子」可能没列全',
  comment_human_check_failed: '主页评论「要人回」清单今天没读成，可能漏报',
}

export function blindSpotNotes(items: readonly ManualItem[]): string[] {
  const notes = new Set<string>()
  for (const m of items) {
    const note = BLIND_SPOT_NOTE[m.kind]
    if (note) notes.add(note)
  }
  return Array.from(notes)
}
