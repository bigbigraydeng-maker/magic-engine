/**
 * 人工待办的**类型与通用工具**（从 manual-items.ts 拆出，Round 1）。
 *
 * 这里只放「不依赖任何具体数据源」的东西：类型、常量、链接闸、以及
 * 未收录页面的汇总构造。具体某条通道的取数逻辑留在各自的子模块里。
 */

import {
  verifyActionLink,
  verifyActionLinkCached,
  type LinkVerdict,
  type LinkVerdictCache,
} from './action-link'
import { isHtmlPageUrl } from '@/lib/seo/url-kind'
import {
  classifyNotIndexed,
  isActionableNotIndexed,
  INDEX_CLASS_META,
  CRAWL_FRESH_DAYS,
  type IndexClass,
} from '@/lib/seo/index-status'
import type { AttributionItemKind } from './attribution-items'
import type { ClientRosterItemKind } from './client-roster'
import type { DailyPlanMeasurementItemKind } from './daily-plan-measurement-items'
import type { EmailReplyItemKind } from './email-reply-items'
import type { BindingRequestItemKind } from './binding-request-items'
import type { PageBindingItemKind } from './page-binding-items'
import type { CommentScopeTodoKind } from './comment-scope-items'
import type { CommentReplyScopeTodoKind } from './comment-reply-scope-items'
import type { CommentAutoreplyRunFailingTodo } from './comment-autoreply-run-failing-items'
import type { MetaTokenHealthKind } from './meta-token-health-items'
import type { DeployHealthItemKind } from './deploy-health-items'
import type { LeadSheetItemKind } from './lead-sheet-items'
import type { CalendarClosureItemKind } from './calendar-closure-items'
import type { TourPublishRequestItemKind } from './tour-catalog-publish-request-items'
import type { PlatformConnectionItemKind } from './platform-connection-items'
import type { FacebookSyncItemKind } from './facebook-sync-items'
import type { LeadFollowupItemKind } from './lead-followup-items'
import type { AdsAutonomyItemKind } from './ads-autonomy-items'
import type { AdsRuleFindingItemKind } from './ads-rule-finding-items'
import type { AdsCircuitItemKind } from './ads-circuit-items'
import type { AdsServicePauseItemKind } from './ads-service-pause-items'
import type { AdsAccountStatusItemKind } from './ads-account-status-items'
import type { GoalRolloverItemKind } from './goal-rollover-items'
import type { MaliangItemKind } from './maliang-render-items'
import type { LibaiItemKind } from './libai-items'
import type { SimaqianItemKind } from './simaqian-review-items'
import type { ToolLeadItemKind } from './tool-lead-items'
import type { PmKind } from './five-kinds'

/**
 * 这些条目**链接坏了也照样下发**。
 *
 * 链接闸的本意是「别给人一个白跑的链接」，但对红线类问题，
 * 「链接不好用」远不如「这条根本没人看见」严重 —— 宁可让人自己找入口，
 * 也不能让一条客户资料串台的告警因为链接问题静默消失。
 *
 * 狄仁杰 2026-08-05 实测：串台告警因为 href 写成相对路径被整条丢掉，
 * kept=0，整套排查产出为零。
 */
// facebook_page_binding_unverified：同步被暂停时客人私信/留资不进 CRM，链接坏了也得有人看见（AD-SEC-4）。
// ai_provider_exhausted / ai_alerting_broken：OpenAI 和 Cloudflare 的后台都在登录墙后面，
//   我们的探活 fetch 很可能拿到 403 → 整条被当坏链接丢掉。而这两条恰恰是
//   「全站 AI 在空跑」和「这套告警自己瞎了」—— 宁可让人自己找入口，也不能让它静默消失。
export const NEVER_DROP_KINDS = new Set<ManualItemKind>([
  // 标题效果判定的两条欠账：链接是要登录的后台页，探活会判坏链接——不能因此静默消失（2026-10-29）。
  'seo_rank_verdict_overdue',
  'seo_rank_baseline_missing',
  // diagnostic_synthesis_failing：链接是需要登录的后台页，探活大概率判成坏链接 —— 这条正是要消灭「静默」的，不能被探活悄悄丢掉（魏征 2026-10-18）。
  'diagnostic_synthesis_failing',
  'cross_client_leak',
  'facebook_page_binding_unverified',
  // facebook_sync_failing：Facebook 私信/留资同步连续失败 = 新客人进不了 CRM（2026-09-16 NAL 断了 9 天没人知道）。
  //   链接是需要登录的后台页，探活大概率判成坏链接 —— 宁可让人自己找入口，也不能让它静默消失。
  'facebook_sync_failing',
  // ads_service_pause_notice：链接是登录后的广告健康页，探活容易判成坏链接。系列已经停了，这条不能静默丢掉。
  'ads_service_pause_notice',
  // lead_followup_due：链接是登录后台页，探活易判成坏链接；这条丢了 = 有人填了表没人知道。
  'lead_followup_due',
  'lead_followup_check_failed',
  // whatsapp_number_unclaimed：链接指向需要登录的后台页，探活可能判成坏链接 —— 消息正在丢，宁可让人自己找入口，也不能静默消失。
  'whatsapp_number_unclaimed',
  'ai_provider_exhausted',
  'ai_alerting_broken',
  // 「授权体检自己读不出来了」「整条通道停了」跟 ai_alerting_broken 是同一类：
  // 这套监控自己出问题的那条消息，绝不能因为链接问题被静默丢掉。
  // （它们的 href 本来就是空的、不会被 fetch，这里是第二道保险。）
  'platform_connection_check_failed',
  'platform_connection_pipeline_down',
  // 钥匙死了 = 这个客户整条 Meta 链路在静默失败（CTS 9/21·9/23·9/25 三次都是 PM 自己问才发现）
  'meta_token_dead',
  'meta_token_check_failed',
  // 主干合进去的东西没上线（2026-09-25 断了 7 小时没人知道）。链接是 Render 后台，要登录，
  // 探活多半判成坏链接 —— 宁可让人自己找入口，也不能让它静默消失。
  'deploy_not_live',
  'deploy_check_failed',
  // 全量探测失败跟「AI 没提到我们」长得一模一样 —— 测不成被当测出来是零，
  // 2026-09-20 East International 三天没人知道。两种都进——不管原因是不是
  // 需要 PM 动手，都不能因为链接问题静默消失（Codex 复审 2026-09-28）。
  'ai_tracker_all_failed',
  'ai_tracker_all_failed_dev',
  // 待确认电话的链接是需要登录的页面，探活多半判成坏链接 —— 不能因此让「有电话没记进客人档案」静默消失。
  'phone_call_needs_review',
  // 推广计划每日检查：链接是需要登录的页面，探活多半判成坏链接——这条里还有「检查自己没跑成」，绝不能静默消失。
  'promo_plan_watch',
  'promo_plan_watch_broken',
  'plan_draft_auto_failed',
  // 广告开投前追踪检查：链接是 Events Manager / GA4 / Inngest 这类要登录的后台页，探活多半判成坏链接——
  // 这条里还有「检查自己没跑成」，绝不能因为链接问题静默消失。
  'ads_tracking_preflight_fix',
  'ads_tracking_preflight_broken',
])

/** Meta queued this long without being applied = the applier is stuck. */
export const META_PENDING_STALE_DAYS = 3
/** Crawl data older than this = the weekly recrawl isn't landing. Same value as seo/index-status CRAWL_FRESH_DAYS (one source of truth). */
export const CRAWL_STALE_DAYS = CRAWL_FRESH_DAYS

export type ManualItemKind =
  /** 已上线标题改动超期没有效果判定 / 上线时没记改前名次 —— 开发欠账（2026-10-29）。 */
  | 'seo_rank_verdict_overdue'
  | 'seo_rank_baseline_missing'
  /** 体检的 AI 文字叙事没写成（保存失败/模型失败）—— 开发欠账，不用 PM 动手（2026-10-18）。 */
  | 'diagnostic_synthesis_failing'
  | 'promo_plan_watch'
  | 'promo_plan_watch_broken'
  /** 同意前自动起草推广计划连续失败：系统没写成，开发看，不占批准决定 */
  | 'plan_draft_auto_failed'
  /** 开投前追踪检查里有硬门 / 软门红灯：具体怎么修（开发的活，不占 PM 的清单；PM 在推广计划页看灯） */
  | 'ads_tracking_preflight_fix'
  /** 开投前追踪检查自己没跑成 / 回执过期：没人在盯追踪（开发欠账） */
  | 'ads_tracking_preflight_broken'
  | 'blog_pr_open'
  | 'not_indexed'
  | 'meta_stuck'
  | 'crawl_stale'
  | 'crawl_blocked'
  | 'video_credits_out'
  /** Creatomate 渲染失败或超时未完成（额度用完 / 渲染卡死超过 15+20 分钟兜底轮询）—— 见
   *  docs/specs/2026-09-09-creatomate-connector-spec-v1.md §4.4，旧管线的 reapStale() 已死，
   *  这条是它的替代 */
  | 'creatomate_render_failed'
  /** 人工待办整个没读出来（loadManualItems 抛了）—— 清单不全，不许显示成「今天没事」 */
  | 'todo_items_unreadable'
  /** Creatomate 做片失败但不是额度问题 —— 要我们查是哪一步卡了（开发的活） */
  | 'creatomate_render_error'
  | 'dataforseo_credits_out'
  | 'cron_not_running'
  | 'cron_blind'
  /** 自动任务跑到一半卡死（状态永远停在 running，路由的 catch 没机会执行） */
  | 'cron_stuck'
  /**
   * 自动任务「显示跑成了，但它声明的下游表一行没写」（2026-09-23 事故）。
   * 跟 cron_stuck 的区别：那边状态位就不对，这边状态位是绿的、只有产出是空的。
   */
  | 'cron_silent_success'
  /**
   * 自动任务最近一次是**报错**结束的。
   *
   * `cron/health.ts` 从 2026-09-06 起就算出了 `failing` 这一类，但它**一次都没被下发过**——
   * 算完只去了一个没人天天开的看板页和一封每天没人细看的邮件。这条把它接上。
   */
  | 'cron_failing'
  /**
   * AI 供应商账户级失效（余额耗尽 / 钥匙不认了 / 卡在网关）。
   * 2026-09-20 那次全站断电三天没人知道，就是因为这条路以前不存在。
   */
  | 'ai_provider_exhausted'
  /** 上面那条告警**自己**读不出来了 —— 不报 ≠ 没事，必须单独说 */
  | 'ai_alerting_broken'
  /**
   * AI 调用卡在 Cloudflare 网关那一层，还没走到 OpenAI。
   *
   * 跟上面那条分开，是因为**要动手的人不一样**：那条要 PM 去充钱 / 换钥匙，
   * 这条只有我们能换网关令牌。合成一条的话，PM 的动手栏里会出现一件
   * 写着「这条不用你动手」的活（魏征 / 子牙 2026-09-23 都点了这条）。
   */
  | 'ai_gateway_broken'
  /**
   * 某客户整周的 AI 可见度探测全部失败，且最主要的原因需要 PM 动手（充值/换钥匙）——
   * 不是「没被提到」，是「根本没测成」。2026-09-20 East International 24/24 探测全挂
   * （OpenAI 没钱 + Google 报错），但在所有现有看板上跟「没什么 AI 提到我们」长得一模一样。
   */
  | 'ai_tracker_all_failed'
  /**
   * 同上，但这周全挂的原因清一色是「不用人动手」的那几类
   * （暂时限流 / 供应商自己出错 / 解析失败 / 我们数据库写入失败，见
   * ai-tracker-failure-items.ts 的 GENERIC_FIX）—— 没有一条需要充值或换钥匙。
   * 这条的 `how` 原文就写着「这条不用你动手」，不能进 PM 的「系统进不去、要你
   * 点一次」动手栏（Codex 复审 2026-09-28：整周全挂但原因不需要人管时，还是
   * 走了 ai_tracker_all_failed，把「不用你动手」的活算进了 PM 的任务数）。
   */
  | 'ai_tracker_all_failed_dev'
  | 'goal_baseline_mismatch'
  | 'diagnostic_findings'
  | 'prescription_updated'
  | 'leads_metric_untrusted'
  | 'factory_worker_idle'
  /** 渲染引擎没就绪。领单程序还在，不等于片子能做出来。 */
  | 'factory_render_worker_down'
  /** 待审超过 24 小时，只催审核的人，不自动批准。 */
  | 'factory_review_overdue'
  /** 死信不会再自动重跑，或失败原因读不到。上报，不是批准。 */
  | 'factory_dead_letter_stuck'
  /** 待审或死信清单自己没读出来。没列出来不等于没有。 */
  | 'factory_material_check_failed'
  | 'ad_readback_blocker'
  /** Mailchimp 出口 tally 里出现非预期失败（配置读不出来 / API key 失效 / 被限流 / provider 5xx） */
  | 'mailchimp_export_broken'
  /**
   * 广告每日回拉读不出客户的广告引擎配置 → 诊断 / 经营状态 / 日报对这些客户全部跳过。
   * 2026-09-25 事故：代码先于加列的数据库改动上线，三个客户一起停了一天，没人知道。
   */
  | 'ads_config_unreadable'
  | 'blog_draft_waiting'
  /** 文章写好了，但这个客户的网站发布通道是断的 —— 要人去设置里接通一次 */
  | 'blog_publish_channel_broken'
  | 'cross_client_leak'
  | 'price_claim_unbacked'
  /** 每日计划里帖子的价格数字跟客户资料里该团的价格对不上（或没资料可对）—— 发布时整批会被拦 */
  | 'price_fact_unverified'
  /** 自动发布：帖子被拦 / 多次失败 / 发布时间已过没补发 —— 没发出去，要人看 */
  | 'auto_publish_stalled'
  /** 自动发布：系统不确定帖子有没有发出去，为防重复不自动重试 —— 要人去主页核对 */
  | 'auto_publish_unknown_outcome'
  /** 自动发布：已授权的日期到了，却没有任何发布记录 —— 发布器可能没在跑 */
  | 'auto_publish_unarmed'
  /** 自动发布：记录说「已撤回」，但回执里同一天又有一条新发出的帖子 —— 主页上有帖、系统记录对不上，要人核对 */
  | 'auto_publish_record_conflict'
  /** Story 自动发布：某条 Story 被拦 / 被平台拒绝 / 时间已过没补发 —— 没发出去，要人看 */
  | 'story_stalled'
  /** Story 自动发布：不确定某条 Story 有没有发出去，为防重复不自动重试 —— 要人去主页核对 */
  | 'story_unknown_outcome'
  /** Story 自动发布：已授权的周包到点了，却没有任何发布 / 演练记录 —— 发布器可能没在跑 */
  | 'story_unarmed'
  | 'auto_run_blocked'
  | 'auto_run_stuck'
  /** 被一句「不打算去」误判成永久拒联 —— 只有人能看一眼原话再决定 */
  | 'dnc_maybe_wrong'
  /** 客人在 Facebook 私信里像是说了「别再联系」，而判据从来读不到私信 —— 只提示，不自动封 */
  | 'dm_maybe_stop'
  /** 客人身上的「⭐重要标记」到期了 —— 员工手工设的"约好周三 3 点回电"这种事，到点该做了 */
  | 'crm_important_due'
  /** 电话系统收了通话但没能自动记进客人档案（待确认 / 没记成）—— 要人看一眼是谁、补记一笔 */
  | 'phone_call_needs_review'
  /** 平台候选（docs/registry/platform-candidates.md）到了复查日期 —— 见 me-platform-tier-gate skill */
  | 'platform_candidate_review_due'
  /** 客户方案文档里写了一次性人工动作（如"明早 09:00 前扫一眼 xx"），只登记在文档里等于没下发 */
  | 'client_doc_manual_task'
  /** 台账（docs/ledger）：决定了超过 7 天没动，或过了验收日还没做 */
  | 'ledger_decided_stale'
  /** 台账：做完了、到了该验的日子还没验 */
  | 'ledger_done_unverified'
  /** 台账：验过了，不成——一直出现直到有人处理 */
  | 'ledger_verification_failed'
  /** 台账目录读不出来或某条格式不合规——这一栏空着不等于没事 */
  | 'ledger_unreadable'
  /** 台账：到期的卡两天没被夜巡盖章——夜巡没来，不是没事 */
  | 'ledger_patrol_missing'
  /** 客人像是说他付款了，但不是我们自己确认的 —— 只有人能核对到账，不许机器自己打 paid 标签 */
  | 'paid_signal_needs_review'
  /** 工具实验室有人留资（自助开通 / 网站诊断留邮箱）—— 这张表以前写完没人读，见 tool-lead-items.ts */
  | ToolLeadItemKind
  | CommentScopeTodoKind
  | CommentReplyScopeTodoKind
  /** 评论自动回复连续多轮整轮没扫完 —— 以前被记成「完成」，约一个月没人发现 */
  | CommentAutoreplyRunFailingTodo['kind']
  /** 写在 Render 里的 Meta 钥匙被 Meta 作废（错误码 190）—— 只有人能重新授权 */
  | MetaTokenHealthKind
  /** 上面那项检查自己没跑成 —— 不报 ≠ 钥匙都活着 */
  | 'meta_token_check_failed'
  /** 主干上的合并超过 30 分钟还没上线正式网站 —— 上线失败或卡住，各窗口说的「已上线」都不算数 */
  | DeployHealthItemKind
  /** 上面那项检查自己没跑成 —— 不报 ≠ 上线都正常 */
  | 'deploy_check_failed'
  /** 线索没写进客户的 Google 表格 —— 销售看的那张表缺人，留资 90 天后永久取不回 */
  | LeadSheetItemKind
  /** 日历上带日期的验证事项每日巡检：读不到日历 / 巡检没跑成 / 没法自动核对 / 核对没达预期 */
  | CalendarClosureItemKind
  /** 客户员工改了团目录、请我们上架 —— 不上架这些修改不会对外生效（对外动作，只有 ME 管理员能点） */
  | TourPublishRequestItemKind
  /** 执行内核停手 / 等审批 / 被规则挡下 —— 必须有人看见，不许死在日志里 */
  | 'kernel_needs_human'
  /** 自治开关同步到执行内核失败 —— 面板档位和内核实际档位可能不一致（WP3.1a） */
  | AdsAutonomyItemKind
  /** 每日广告巡检的广告级规则（D2 素材疲劳 / D10 点进去之后差了）：要人拍板改不改，系统不会自动改 */
  | AdsRuleFindingItemKind
  | AdsCircuitItemKind
  /** 服务把一条在投的广告系列暂停了 —— 要不要恢复由人点确认卡 */
  | AdsServicePauseItemKind
  /** Meta 广告账户状态不是正常超过 24 小时 / 状态读不到 / 账户已关闭（每周提醒一次） */
  | AdsAccountStatusItemKind
  /** 月循环目标过了月底没自动续上 —— 广告自治 / 日报会失去目标口径 */
  | GoalRolloverItemKind
  /** Facebook 删除数据请求处理失败 —— 用户在 Facebook 里要求删数据，我们答应了却没做到，不许只写日志 */
  | 'meta_data_deletion_failure'
  /** 有成交/咨询等着人核对要不要告诉广告平台 —— 撤不回，所以必须人点 */
  | 'conversion_needs_review'
  /** 公司回信确认收到款，但缺金额/疑似重复/有取消字样，系统没法自动记成交 —— 要人核对（2026-10-04） */
  | 'payment_email_needs_human'
  /** 发给广告平台时断线了，不知道对方收没收 —— 程序绝不自己重发，等人核对 */
  | 'conversion_send_in_doubt'
  /** 已批准的成交/咨询因为连接广告平台的授权失效发不出去，7 天内不修就永久丢（2026-09-22） */
  | 'conversion_capi_token_dead'
  /** D3 诊断建议暂停广告组，Kernel 待批准——PM 不点头不暂停 */
  | 'ads_auto_pause_pending'
  /** AI 全自动审核发现异常，已经自动暂停发送（PM 拍板 2026-09-15："要有异常刹车"） */
  | 'ai_auto_review_circuit_breaker'
  /** AI 客服回复草稿写好了，等人批准发送（issue #1589） */
  | 'messenger_draft_pending_approval'
  /** AI 客服回复已批准但发送失败，客户没收到（issue #1589 · P0 · H16） */
  | 'messenger_draft_send_failed'
  /** AI 客服回复草稿超过 4 小时没人批准，next-day escalation（issue #1589） */
  | 'messenger_draft_escalation'
  /** 客户资料库里的信息（团期/价格等）快到期了，过期后 AI 客服不能再用（issue #1589） */
  | 'knowledge_fact_expiring_soon'
  | AttributionItemKind
  | ClientRosterItemKind
  /** 历史：LinkedIn 自动发帖已于 2026-10 下线，不再有产出方；保留成员只为让 2026-09-25 的待办夹具继续成立 */
  | 'linkedin_progress_needs_review'
  | EmailReplyItemKind
  /** 客户在自助向导里交了广告账户号，只有内部员工能核实后接上（AD-SEC-3）*/
  | BindingRequestItemKind
  /** Facebook 主页绑定没核实：私信/线索/评论回复已暂停，或还在跑但没核实记录（AD-SEC-4）*/
  | PageBindingItemKind
  /** 排期发的 Facebook 帖子发出去了，但一直拿不到帖子编号 —— 成绩收不回来 */
  | DailyPlanMeasurementItemKind
  /** 私信客服健康心跳查出问题（issue #1587）：消息量骤降 / 验证器拦截率过高 / 退订登记写入失败 */
  | 'conversation_health_alert'
  /** 同一个心跳查出「AI 起草回复一直报错」—— 这条只有我们能修（开发的活） */
  | 'conversation_health_check_error'
  /** 经验手册（Claude 持久记忆，不在仓库）里点名的函数/路径/表名疑似过期，每周巡检自动发现 */
  | 'playbook_reference_stale'
  /** WhatsApp 收到了消息但没有客户绑定这个号码 */
  | 'whatsapp_number_unclaimed'
  /**
   * 外部平台的授权断了 / 没了心跳 / 权限清单不够用（2026-09-24 CTS 邮箱断 9 天）。
   * 只有人能重新走一次同意页，所以必须进人工车道，不许只躺在 error_message 里。
   */
  | PlatformConnectionItemKind
  /** 马良 · 出片 9 宫格自检：过关等审片 / 不过关问返工还是放弃 / 检不了 / 出片后没检 */
  | MaliangItemKind
  /** 李白 · 文案溯源：「未证实」句待改 / 检不了 / 没检；提示词库月检疑似过期（只报告不改） */
  | LibaiItemKind
  /** 司马迁 · 口碑周巡：每周四起草的 Google 评价回复草稿（一律没发）/ 本周没巡成 */
  | SimaqianItemKind
  /** Facebook 私信 / 表单留资同步连续失败（授权失效时要有主页管理员重新「连接 Meta」） */
  | FacebookSyncItemKind
  /** 客人填了表超过 24 小时没人回 / 这一栏没算出来 */
  | LeadFollowupItemKind
  /** Magic Bridge 全平台免费额度用到 80% 以上 —— 要不要加额度由 PM 定 */
  | 'magic_bridge_quota'
  /** Tools Lab 全站每月合计花费/次数上限用到 80% 以上（网站诊断+广告体检共用）—— 要不要加名额由 PM 定 */
  | 'tools_wide_budget_warning'

export interface ManualItem {
  kind: ManualItemKind
  client_name: string
  client_id: string
  /** One sentence: what is wrong and why it costs something. */
  what: string
  /** The simplest human action, concrete enough to do without asking. */
  how: string
  /** Direct link to the place the action happens. */
  href: string
  /**
   * 在 PM 五类里换一类（见 five-kinds.ts `laneOf`）。**只能在五类之间换，挪不出 PM 的清单** ——
   * 一个写错的覆盖不许让一条待办悄悄消失。要把活挪给开发就拆一个新 kind。
   * 目前只有方案文档里的一次性人工动作（client-doc-manual-tasks.ts）会写它。
   */
  pm_kind?: PmKind
}

/** GSC URL-inspection deep link — the exact screen with the resubmit button. */
/**
 * @deprecated 深链在实际使用中会 404（PM 2026-08-03 实测）。
 * 用 `gscPropertyUrl` + `gscInspectSteps` 代替 —— 稳定入口 + 文字步骤。
 * 保留只为让老测试还能引用到它，新代码不要用。
 */
export function gscInspectUrl(siteUrl: string, pageUrl: string): string {
  return (
    'https://search.google.com/search-console/inspect' +
    `?resource_id=${encodeURIComponent(siteUrl)}&id=${encodeURIComponent(pageUrl)}`
  )
}

export function daysAgo(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return Math.floor((now.getTime() - t) / 86_400_000)
}

/**
 * 下发前过一遍链接闸。
 *
 * PM 2026-08-03:「点过去就是 404，徒增我和 fde 的工作时间」。
 * 所以公开网址实测不通的**直接不下发** —— 宁可这条今天不提醒,也不给一个白跑的链接。
 * 登录类站点验不了(见 action-link 头注),它们的 how 里必带文字步骤,不靠链接落点。
 *
 * 单条验证失败不拖累其他条目;整体超时也只是少过滤,不阻断待办。
 */
/**
 * 相对路径 href 会被 `verifyActionLink` 里的 `new URL()` 抛成 broken，
 * 于是**整条待办被 dropBrokenLinks 静默丢掉**，只留一行 console.warn ——
 * PM 邮件里根本看不到，正是「发现死在日志里」。同一个坑早在
 * `cross_client_leak`（2026-08-05 狄仁杰实测 kept=0）上治过一次，那次的修法
 * 是「必须绝对网址」＋加进 NEVER_DROP_KINDS。这次审计（2026-09-07 PR #1467）
 * 又抓到 3 个 kind 犯了同一个 bug：blog_draft_waiting、conversion_needs_review、
 * conversion_send_in_doubt。
 *
 * 光靠人眼审 code review 显然不够 —— 加一道 fail-fast，让下次再有人写相对
 * 路径时立刻在 build/test 阶段炸出来，而不是等到线上静默丢一个月才发现。
 */
export function assertAbsoluteHref(item: ManualItem): void {
  const href = item.href
  if (href === '') return // 空 href 允许（有些待办本来就没有入口，见 dropBrokenLinks 头注）
  if (!/^https?:\/\//.test(href)) {
    throw new Error(
      `[manual-items] href 必须是绝对网址（相对路径会被链接闸静默丢掉）：kind=${item.kind} href=${JSON.stringify(href)}`,
    )
  }
}

/** 单条链接的结论：相对路径按坏链接、空链接不验、其余实测（给了缓存就先查缓存）。 */
function linkVerdictFor(
  it: ManualItem,
  fetchImpl: typeof fetch,
  opts: DropBrokenLinksOptions,
): Promise<LinkVerdict> {
  try {
    // 相对路径是代码 bug（写死的 href 字符串），要比「这条链接今天恰好
    // 打不开」响得多 —— 但唯一的生产调用方 daily-todo.ts 在 dropBrokenLinks
    // 整体失败时会兜底放行 rawManualItems（未过滤），如果这里对着整批
    // items 同步 throw，一条相对路径就会让所有链接（含真正打不开的）
    // 原样下发且不留日志，比「静默丢一条」更糟。所以逐条隔离：只有这一条
    // 按坏链接处理，其余条目照常验证，且用 console.error 而不是
    // console.warn，跟普通坏链接分开，方便回头当 bug 追。
    assertAbsoluteHref(it)
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e))
    return Promise.resolve({ kind: 'broken', status: null })
  }
  // 🔴 **没有链接 ≠ 链接坏了。**
  //    有些待办本来就没有可点的地方（比如那件事的入口还没上线），
  //    它的价值全在 what / how 上。空 href 交给 verifyActionLink 会走
  //    `new URL('')` / `fetch('')` 抛错 → 判成 broken → 整条被丢掉，
  //    于是「如实告诉人这件事现在做不了」变成了「人什么都看不到」——
  //    发现死在 console.warn 里，正是铁律 3 下半句禁止的那件事。
  if (it.href.trim() === '') return Promise.resolve({ kind: 'unverifiable' })
  const check = opts.cache
    ? verifyActionLinkCached(it.href, fetchImpl, opts.cache, undefined, opts.refreshCache)
    : verifyActionLink(it.href, fetchImpl)
  return check.catch((): LinkVerdict => ({ kind: 'unverifiable' }))
}

export interface DropBrokenLinksOptions {
  /** 进程内的实测结论缓存；不给就每条都现场验（旧行为）。 */
  cache?: LinkVerdictCache
  /** true：不读缓存、每条现场验，结果写回缓存（每日邮件用，不吃页面留下的旧结论）。 */
  refreshCache?: boolean
  /**
   * 整批最多等多久（毫秒）。只给有人盯着转圈的页面用：到点还没验完的那条
   * 按「验不了」放行（少过滤好过整页卡住），后台那次实测照常跑完、写进缓存，
   * 下一次打开就按实测结论处理。每日邮件不给这个参数，照旧等每条验完。
   */
  budgetMs?: number
}

export async function dropBrokenLinks(
  items: ManualItem[],
  fetchImpl: typeof fetch = fetch,
  opts: DropBrokenLinksOptions = {},
): Promise<{ kept: ManualItem[]; dropped: ManualItem[] }> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const { budgetMs } = opts
  const deadline =
    budgetMs === undefined
      ? null
      : new Promise<LinkVerdict>((resolve) => {
          timer = setTimeout(() => resolve({ kind: 'unverifiable' }), budgetMs)
        })
  let verdicts: LinkVerdict[]
  try {
    verdicts = await Promise.all(
      items.map((it) => {
        const check = linkVerdictFor(it, fetchImpl, opts)
        return deadline ? Promise.race([check, deadline]) : check
      }),
    )
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
  const kept: ManualItem[] = []
  const dropped: ManualItem[] = []
  items.forEach((it, i) => {
    if (verdicts[i].kind === 'broken' && !NEVER_DROP_KINDS.has(it.kind)) {
      dropped.push(it)
      console.warn(`[manual-items] 链接打不开,本条不下发: ${it.kind} ${it.href}`)
    } else {
      if (verdicts[i].kind === 'broken') {
        console.warn(`[manual-items] 链接打不开但这是红线条目,照常下发: ${it.kind} ${it.href}`)
      }
      kept.push(it)
    }
  })
  return { kept, dropped }
}

/** 一行 `client_site_pages`（只声明这条待办用得到的列）。 */
export interface NotIndexedRow {
  client_id: string
  url: string
  index_verdict: string | null
  first_not_indexed_at: string | null
  word_count: number | null
  /** 我们自己抓这一页的状态；只有 'crawled' 时正文字数才可信（被防火墙挡住的行字数是假的）。 */
  crawl_status: string | null
  /** 我们最后一次抓这一页的时间；太久没抓的字数也不作数。 */
  crawled_at: string | null
}

/** 待办里各类的报数顺序：先报改了就能好的，再报谷歌自己排队 / 判断的。 */
export const NOT_INDEXED_REPORT_ORDER: readonly IndexClass[] = [
  'error', 'noindex', 'unknown', 'thin', 'duplicate', 'crawled', 'discovered', 'other',
]

/**
 * 谷歌没收录的页面 —— **一个客户汇总成一条，不是一页一条**。
 *
 * 🔴 实测 oztop 一家就 116 个未收录页面（PM 2026-09-04 fix闭环），一页一条会把
 * 今日待办正文淹掉 122 行 —— 跟 pushDiagnosticItems 等
 * 早就立下的「别把待办刷屏」是同一条纪律，唯独这条线之前漏了。逐条的网址和单独
 * 深链没意义（谁也不会点 116 个链接），价值全在「哪个客户、几个、什么原因、去哪
 * 看全部」。
 *
 * 分类顺着谷歌自己给的原因走 `classifyNotIndexed`（seo/index-status），跟站点清单页
 * 共用同一份判据。跳转页 / 备用页本来就不该被收录，不是要干的活，只在 what 里报个
 * 数、说一句「不用管」。`thin` 只在「我们自己爬干净了且爬取够新」时才成立 ——
 * 2026-09-26 生产上某客户 46/46 行被判 thin，全是防火墙挑战页；另有 49 行标着
 * 「crawled」其实谷歌压根没爬过。
 */
export function buildNotIndexedItems(
  rows: NotIndexedRow[],
  /** client_id → GSC site_url。没有 GSC 连接的客户不下发（没有能直达的可执行清单）。 */
  siteUrlOf: Map<string, string>,
  nameOf: (id: string) => string,
  now: Date,
): ManualItem[] {
  const byClient = new Map<
    string,
    {
      total: number
      counts: Partial<Record<IndexClass, number>>
      notAProblem: number
      noVerdict: number
      oldest: string | null
    }
  >()
  for (const row of rows) {
    // Assets (images/PDFs) are not pages — "not indexed as a page" is normal
    // for them and flagging it burns the whole list's credibility.
    if (!isHtmlPageUrl(row.url)) continue
    const cls = classifyNotIndexed(row, now)
    const cur = byClient.get(row.client_id) ?? {
      total: 0,
      counts: {} as Partial<Record<IndexClass, number>>,
      notAProblem: 0,
      noVerdict: 0,
      oldest: null as string | null,
    }
    if (!isActionableNotIndexed(cls)) {
      if (cls === 'not_a_problem') cur.notAProblem += 1
      else if (cls === 'no_verdict') cur.noVerdict += 1
      byClient.set(row.client_id, cur)
      continue
    }
    cur.total += 1
    cur.counts[cls] = (cur.counts[cls] ?? 0) + 1
    if (row.first_not_indexed_at && (!cur.oldest || row.first_not_indexed_at < cur.oldest)) {
      cur.oldest = row.first_not_indexed_at
    }
    byClient.set(row.client_id, cur)
  }

  const items: ManualItem[] = []
  for (const [clientId, agg] of Array.from(byClient.entries())) {
    if (agg.total === 0) continue
    // 没连 GSC 的客户：我们拿不到谷歌给这些页面的原因，也没有一份读者能照着做的清单，
    // 下发也白搭（与原逐页版一致，跳过不下发）。
    if (!siteUrlOf.get(clientId)) continue

    const parts = NOT_INDEXED_REPORT_ORDER.filter((cls) => (agg.counts[cls] ?? 0) > 0)
      .map((cls) => `${agg.counts[cls]} 个${INDEX_CLASS_META[cls].label}`)
      .join('、')
    const extra =
      (agg.notAProblem > 0 ? `；另 ${agg.notAProblem} 个是正常跳转或备用页，不用管` : '') +
      (agg.noVerdict > 0 ? `；${agg.noVerdict} 个还没拿到谷歌的结论，排队等重查` : '')
    const days = daysAgo(agg.oldest, now)
    const age = days !== null && days > 0 ? `，最久的已 ${days} 天` : ''
    items.push({
      kind: 'not_indexed',
      client_id: clientId,
      client_name: nameOf(clientId),
      what: `${agg.total} 个页面没被谷歌收录（${parts}）${age}，这些网址本身不会出现在谷歌搜索结果里${extra}`,
      // 落到 ME 后台的站点页面清单（已带 ?filter=not-indexed 直达未收录）：每页都标了
      // 本地分类和该做什么。这解决 GSC「网页(Pages)」报告的两个盲区 —— 它不显示我们本地
      // 推导的「内容太薄」，「谷歌还不认识」的页面也可能压根不在它清单里（Codex #1375）。
      how:
        `打开这份站内清单（已只筛未收录），每页都标了谷歌给的原因和该做的动作。先修「${INDEX_CLASS_META.error.label}」这类，改好了谷歌才可能收；` +
        `「${INDEX_CLASS_META.noindex.label}」的先确认是不是故意的（购物车、账户页本来就不该收），要被搜到再去掉这个设置；` +
        `「${INDEX_CLASS_META.unknown.label}」的，最想被搜到的几页可以去 Search Console 点「请求编入索引」（每天限量，不保证收）；` +
        `「${INDEX_CLASS_META.discovered.label}」和「${INDEX_CLASS_META.crawled.label}」是谷歌自己在排队和判断，别反复点请求收录，靠加内链、补有用的内容慢慢来`,
      // app.magicengine.com.au 是登录类站点，链接闸判 unverifiable 会保留（见 action-link）。
      href: `https://app.magicengine.com.au/dashboard/clients/${clientId}/site-audit/pages?filter=not-indexed`,
    })
  }
  return items
}

/** 一行 `client_site_pages`（只声明站点数据健康检查用得到的列）。 */
export interface CrawlHealthRow {
  client_id: string
  crawled_at: string | null
  crawl_status: string | null
}

/** 客户网站防火墙挡住我们读页面时的处理说明：先由我们换读取通道，再请客户放行 ME 服务器（SiteGround 步骤）。 */
export const SITE_FIREWALL_ALLOWLIST_SOP_URL =
  'https://github.com/bigbigraydeng-maker/magic-engine/blob/main/docs/sops/client-site-siteground-allowlist.md'

/**
 * 站点页面数据健康：两件事，各出一条待办。
 *
 * - crawl_stale：只有真抓到正文的行（crawl_status='crawled'）才算「新鲜」。被防火墙
 *   挡住的行（antibot_challenged）每次重爬都会刷新 crawled_at，拿它算新鲜会把
 *   「每次都被挡」的客户误判成数据很新，把告警静音。只对每周自动重扫名单里的客户报：
 *   不在名单里的客户数据旧是常态，天天提醒是噪音。
 * - crawl_blocked：最近 CRAWL_FRESH_DAYS 天里有页面被网站防火墙挡住 —— 我们读不到正文。
 *   只数最近被挡的：每周重扫最多 150 页，碰不到的旧行会永远停在被挡状态，全数会让这条
 *   永远消不掉。我们读网页经第三方阅读服务转手，客户白名单只放行 ME 服务器没用，
 *   所以先由我们换读取通道，再请客户放行。
 */
export function buildCrawlHealthItems(
  rows: CrawlHealthRow[],
  nameOf: (id: string) => string,
  now: Date,
  /** 在每周自动重扫名单里的客户（与 site-audit-weekly 同一判据）。只有它们的「数据过期」才值得提醒。 */
  weeklyRecrawlClientIds: ReadonlySet<string>,
): ManualItem[] {
  const newestReal = new Map<string, string>()
  const blocked = new Map<string, number>()
  for (const row of rows) {
    if (row.crawl_status === 'crawled' && row.crawled_at) {
      const cur = newestReal.get(row.client_id)
      if (!cur || row.crawled_at > cur) newestReal.set(row.client_id, row.crawled_at)
    }
    if (row.crawl_status === 'antibot_challenged') {
      const days = daysAgo(row.crawled_at, now)
      if (days !== null && days < CRAWL_FRESH_DAYS) {
        blocked.set(row.client_id, (blocked.get(row.client_id) ?? 0) + 1)
      }
    }
  }

  const items: ManualItem[] = []

  for (const [clientId, iso] of Array.from(newestReal.entries())) {
    if (!weeklyRecrawlClientIds.has(clientId)) continue
    const days = daysAgo(iso, now)
    if (days === null || days < CRAWL_STALE_DAYS) continue
    items.push({
      kind: 'crawl_stale',
      client_id: clientId,
      client_name: nameOf(clientId),
      what: `网站页面数据 ${days} 天没更新了，内链和孤儿页检查还在用旧数据`,
      // 🔴 落地路径必须落到 /site-audit/pages —— /site-audit 本身没有 page.tsx，
      //    Next.js 直接 404（2026-09-07 每日待办 href 落地页审计 PR #1467 实测）。
      //    /site-audit/pages 是「页面清单」页，右上就有「Start New Audit」按钮，
      //    功能刚好对上「重新扫描网站」这句 how。
      how: '打开链接（是「页面清单」页），右上点「Start New Audit」重扫；如果还是不行说明对方主机挡了我们，回一句我来换通道',
      href: `https://app.magicengine.com.au/dashboard/clients/${clientId}/site-audit/pages`,
    })
  }

  for (const [clientId, count] of Array.from(blocked.entries())) {
    items.push({
      kind: 'crawl_blocked',
      client_id: clientId,
      client_name: nameOf(clientId),
      what: `最近 ${CRAWL_FRESH_DAYS} 天里有 ${count} 个页面被客户网站的防火墙挡住，我们读不到正文 —— 这些页「正文偏薄」「内链」这类要看正文的判断都用不上真数据`,
      how: `先别找客户：我们读网页是经第三方阅读服务转手的，客户的防火墙挡的是它，只把 ME 服务器加进客户白名单，这一路照样被挡。回一句「换通道」，我来把这个站改成由 ME 服务器直接读；改好后才需要客户按链接里的步骤放行 ME 服务器。最近 ${CRAWL_FRESH_DAYS} 天没有页面再被挡时，这条会自动消失`,
      href: SITE_FIREWALL_ALLOWLIST_SOP_URL,
    })
  }

  return items
}

/** 一条待办通道：往自己的格子里放条目。 */
export type ManualItemPusher = (bucket: ManualItem[]) => Promise<void>

/**
 * 各条通道同时取数，结果按**列出的先后顺序**拼回 `items`（2026-09-26）。
 *
 * 之前四十多条通道一条接一条地 await，实测（本地假库，每次查库 40ms）排队 73 轮、
 * 光等数据库就 3 秒，每次查库 100ms 时 7.4 秒 —— PM 报的「loading 非常慢」主要就是这个。
 * 各通道只读库、只往自己的格子里放，互不读别人的条目，所以可以并行；
 * 每条一个格子、最后按顺序拼，保证待办的先后跟原来一模一样。
 * 某条通道没自己 catch 就抛错时，整体照旧抛出（调用方兜底行为不变）。
 */
export async function runPushers(items: ManualItem[], pushers: ManualItemPusher[]): Promise<void> {
  const buckets = pushers.map(() => [] as ManualItem[])
  await Promise.all(pushers.map((push, i) => push(buckets[i])))
  for (const bucket of buckets) items.push(...bucket)
}
