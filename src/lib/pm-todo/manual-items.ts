/**
 * Manual handoff lane (PM 拍板 2026-08-01).
 *
 * "自动化无法完成的，可以交给人工用最简单的方法完成。任务下发都要保持管道
 *  畅通" — this is the second half of the 遇卡点必自动化 rule, not a retreat
 * from it: the system still automates everything it can, but whatever it
 * CANNOT finish must never dead-end in a log line only a developer reads.
 *
 * Every item here answers three questions for the FDE/PM in one glance:
 *   what  — 一句话说清问题（含影响）
 *   how   — 最简单的人工做法（具体到点哪里）
 *   href  — 直达链接，不用自己找入口
 *
 * Sources are deliberately the states that were INVISIBLE before:
 *   · blog PRs waiting on a human merge (post sat in pr_open unnoticed)
 *   · pages Google won't index (detected, but no auto-resubmit path)
 *   · meta changes queued but never applied (WP plugin stalled)
 *   · site page data gone stale (Oztop's host blocks our crawler → 65 days old)
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { pushAttributionItems } from './attribution-items'
import { clientListUnreadableItem, loadActiveClients, type ClientRow } from './client-roster'
import { pushAiTrackerFailureItems } from './ai-tracker-failure-items'
import { pushConversionReviewItems } from './conversion-review-items'
import { pushPaymentEmailNeedsHumanItems } from './payment-email-items'
import { pushAiAutoReviewCircuitBreakerItems } from './ai-auto-review-circuit-breaker-items'
import { pushMetaTokenHealthItems } from './meta-token-health-items'
import { deployCheckFailedItem, pushDeployHealthItems } from './deploy-health-items'
import { pushMessengerDraftItems } from './messenger-draft-items'
import { pushKnowledgeFactExpiringItems } from './knowledge-fact-expiring-items'
import { pushDailyPlanMeasurementItems } from './daily-plan-measurement-items'
import { pushPriceFactItems } from './price-fact-items'
import { pushTourCatalogPublishRequestItems } from './tour-catalog-publish-request-items'
import { pushAutoPublishItems } from './auto-publish-items'
import { pushStoryLiteItems } from './story-lite-items'
import { pushEmailReplyItems } from './email-reply-items'
import { pushLeadFollowupItems } from './lead-followup-items'
import { pushBindingRequestItems } from './binding-request-items'
import { pushPageBindingItems } from './page-binding-items'
import { pushFacebookSyncFailingItems } from './facebook-sync-items'
import { pushLeadSheetItems } from './lead-sheet-items'
import { foldRootCauseDuplicates } from './dedupe-root-cause'
import { pushCalendarClosureItems } from './calendar-closure-items'
import { pushToolLeadItems } from './tool-lead-items'
import { pushToolsWideBudgetItems } from './tools-wide-budget-items'
import { pushAdsAutonomySyncItems } from './ads-autonomy-items'
import { pushAdsRuleFindingItems } from './ads-rule-finding-items'
import { pushAdsCircuitItems } from './ads-circuit-items'
import { pushAdsAccountStatusItems } from './ads-account-status-items'
import { pushPromoPlanWatchItems } from './promo-plan-watch-items'
import { pushGoalRolloverItems } from './goal-rollover-items'
import { pushMagicBridgeQuotaItems } from './magic-bridge-quota-items'
import { pushDiagnosticSynthesisItems } from './diagnostic-synthesis-items'
import { pushDataDeletionFailureItems } from './data-deletion-items'
import {
  buildCrawlHealthItems,
  buildNotIndexedItems,
  daysAgo,
  META_PENDING_STALE_DAYS,
  runPushers,
  type CrawlHealthRow,
  type ManualItem,
  type ManualItemPusher,
  type NotIndexedRow,
} from './manual-item-types'
import { pushLinkedinProgressItems } from './manual-linkedin-items'
import { pushPaidSignalReviewItems, pushDncReviewItems, pushMessengerStopItems, pushImportantDueItems, pushPhoneReviewItems } from './manual-crm-items'
import { pushAdsAutoPauseItems } from './ads-auto-pause-items'

export * from './manual-item-types'
export { pushLinkedinProgressItems } from './manual-linkedin-items'
export { pushPaidSignalReviewItems, pushDncReviewItems, pushMessengerStopItems, pushImportantDueItems, pushPhoneReviewItems } from './manual-crm-items'
import { pushVideoCreditsItem, pushCreatomateRenderItems, pushPriceGateItems, pushFactoryWorkerItems } from './manual-content-items'
import { pushDataForSeoCreditsItem, pushProviderOutageItems, pushCronHealthItems, pushAdReadbackItems, pushMailchimpExportItems, pushAdsConfigReadItems, pushAdsAutoPauseConfigReadItems } from './manual-monitoring-items'
import { pushLeadsSanityItems, pushDiagnosticItems, pushPrescriptionItems } from './manual-strategy-items'

export { pushCreatomateRenderItems, pushPriceGateItems, pushFactoryWorkerItems } from './manual-content-items'
export { pushDataForSeoCreditsItem, buildProviderOutageItems, pushMailchimpExportItems } from './manual-monitoring-items'

import { fetchAll } from '@/lib/supabase-paginate'
import { auditGoalBaselines } from '@/lib/strategy/baseline-audit'
import { fetchBlogDraftTodos } from '@/lib/pm-todo/blog-drafts'
import { fetchAutoRunTodos } from '@/lib/pm-todo/auto-run-items'
import { fetchCommentScopeTodos } from '@/lib/pm-todo/comment-scope-items'
import { fetchCommentReplyScopeTodos } from '@/lib/pm-todo/comment-reply-scope-items'
import { fetchCommentAutoreplyRunFailingTodos } from '@/lib/pm-todo/comment-autoreply-run-failing-items'
import { fetchKernelHandoffTodos } from '@/lib/kernel/handoff'
import { auditCrossClientLeaks } from '@/lib/clients/cross-client-audit'
import {
  PLATFORM_CANDIDATE_REVIEWS,
  PLATFORM_CANDIDATE_REGISTRY_URL,
  type PlatformCandidateReview,
} from './platform-candidate-reviews'
import { CLIENT_DOC_MANUAL_TASKS, type ClientDocManualTask } from './client-doc-manual-tasks'
import { pushPlaybookStalenessItems } from './playbook-staleness-items'
import { pushPlatformConnectionItems } from './platform-connection-items'
import { pushWhatsappUnclaimedItems } from './whatsapp-unclaimed-items'
import { pushLedgerItems } from './ledger-items'
import { pushMaliangRenderItems } from './maliang-render-items'
import { pushLibaiItems } from './libai-items'
import { pushSimaqianReviewItems } from './simaqian-review-items'

/**
 * 每周自动重扫名单里的客户 id —— 与 site-audit-weekly 同一判据：在用 + seo_config.weekly_blog + 有域名。
 * 读失败返回空集合并打一条警告：宁可当天少一条「数据过期」提醒，也不给名单外的客户天天发噪音。
 */
async function loadWeeklyRecrawlClientIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Set<string>> {
  try {
    const { data, error } = await supabase
      .from('clients')
      .select('id')
      .in('id', ids)
      .contains('seo_config', { weekly_blog: true })
      .not('domain', 'is', null)
    if (error) throw new Error(error.message)
    return new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id))
  } catch (e) {
    console.warn(
      '[manual-items] 每周重扫名单读取失败（今天不发「数据过期」提醒）:',
      e instanceof Error ? e.message : String(e),
    )
    return new Set<string>()
  }
}

export async function loadManualItems(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<ManualItem[]> {
  const items: ManualItem[] = []

  const { clients, error: clientsError } = await loadActiveClients(supabase)
  // 基础设施类检查要放在这条提前返回**之前**：定时任务健康跟系统里有几个客户
  // 毫无关系。放在后面的话，客户表一空它就被跳过了。
  const infra = infraPushers(supabase, clients, now)
  if (clientsError || clients.size === 0) {
    await runPushers(items, infra)
    if (clientsError) items.push(clientListUnreadableItem(clientsError.message))
    return items
  }
  // 两组同时跑，拼回时仍是「基础设施在前、客户通道在后」的原顺序（见 runPushers 头注）
  await runPushers(items, [...infra, ...clientPushers(supabase, clients, now)])
  // 同一个根因报了很多次的折成一次（AI 余额用完 → 各客户体检全挂只是症状；授权断了 + 同步失败 = 同一修法）
  return foldRootCauseDuplicates(items).items
}

/** 跟客户名单无关的检查（余额、断电、定时任务、授权、钥匙……），客户表读挂了也照跑。 */
function infraPushers(supabase: SupabaseClient, clients: Map<string, ClientRow>, now: Date): ManualItemPusher[] {
  return [
    // 出片余额用完 —— 只有人能充值，必须当天摆到眼前，不能烂在工单的 error 字段里
    (b) => pushVideoCreditsItem(supabase, b, now),
    // 关键词数据供应商余额用完 —— 同样只有人能充值；仅 40210 进入人工车道。
    (b) => pushDataForSeoCreditsItem(supabase, b, now).catch((e) =>
      console.warn('[manual-items] Keyword Intelligence 余额检查失败（不阻塞其他待办）:', e),
    ),
    // AI 文字账户断电（没钱 / 钥匙失效 / 卡在网关）—— 2026-09-20 那次全站三天没人知道。
    // 跟上面两条余额待办同一条纪律：只有人能充钱，必须当天摆到眼前。
    (b) => pushProviderOutageItems(supabase, b, now).catch((e: unknown) => {
      // 只打日志就等于这只眼睛瞎了也没人知道 —— 照样下发一条
      b.push({
        kind: 'ai_alerting_broken',
        client_id: 'infra',
        client_name: 'Magic Engine 后台',
        what: `「AI 账户断电」的告警自己挂了（${(e instanceof Error ? e.message : String(e)).slice(0, 160)}）—— 今天没有这项检查的结果，不报警不等于没事`,
        how: '这条不用你动手 —— 是我们这边的欠账。回我一句「修一下断电告警」我就去修',
        href: '',
      })
    }),
    // 按时没跑 / 查不出跑没跑 —— PM 2026-08-03 要求「不能完成需要有报错」
    (b) => pushCronHealthItems(supabase, b, now),
    // 某客户的 AI 可见度探测整周全挂了 —— 没测成被当测出来是零（2026-09-20 三天没人知道）。
    // 放在 infra 区而不是 per-client 区：它自己查 ai_visibility_runs，不看 clients 表里的
    // 别的字段；但传 clients 进去是为了只对在服务的客户报警（Codex 复审 2026-09-28）。
    (b) => pushAiTrackerFailureItems(supabase, b, now, clients).catch((e) =>
      console.warn('[manual-items] AI 可见度全挂检查失败（不阻塞其他待办）:', e),
    ),
    // 外部平台的授权断了 —— 跟上面几条一样属于基础设施检查，跟「系统里有几个客户」
    // 无关，所以放在客户名单那条提前返回之前。2026-09-24：CTS 邮箱断了 9 天没人知道，
    // 全站没有任何一条路会把它端出来（模块自己会兜底，不抛给这里）。
    // 模块内部已经把取数包进 try 并自报故障；这层 catch 防的是判据/造句本身抛异常 ——
    // 不拦的话会掀掉整个 loadManualItems，当天整份待办邮件变空（比漏一条严重得多）。
    (b) => pushPlatformConnectionItems(supabase, b, now).catch((e) =>
      console.warn('[manual-items] 平台授权体检失败（不阻塞其他待办）:', e),
    ),
    // WhatsApp 收到了消息但没客户绑定这个号码 —— 消息没存下来，只有人能去设置页绑一次。
    // 表还没上线时模块自己静默返回，不抛给这里。
    (b) => pushWhatsappUnclaimedItems(supabase, b, now).catch((e) =>
      console.warn('[manual-items] WhatsApp 无人认领号码检查失败（不阻塞其他待办）:', e),
    ),
    // 写在 Render 里的 Meta 钥匙被 Meta 作废 —— 上面那条只查「连接 Meta」按钮存下的授权，
    // 这条补的是环境变量里的钥匙（CTS 9/21·9/23·9/25 三次都是 PM 自己问才发现）
    (b) => pushMetaTokenHealthItems(supabase, b).catch((e: unknown) => {
      b.push({
        kind: 'meta_token_check_failed',
        client_id: 'infra',
        client_name: 'Magic Engine 后台',
        what: `「Meta 钥匙是否失效」的每日检查自己没跑成（${(e instanceof Error ? e.message : String(e)).slice(0, 160)}）—— 今天不报警不等于钥匙都活着`,
        how: '这条不用你动手 —— 是我们这边的欠账。回我一句「修一下 Meta 钥匙检查」我就去修',
        href: '',
      })
    }),
    // 主干合进去的东西超过 30 分钟没上线正式网站（2026-09-25 编译坏了 7 小时没人知道）
    (b) => pushDeployHealthItems(b, process.env, fetch, now).catch((e: unknown) => { b.push(deployCheckFailedItem(e)) }),
    // 平台候选到了复查日期 —— 不落库、不查表，纯本地日期判断
    async (b) => pushPlatformCandidateReviewItems(b, now),
    // 台账（docs/ledger）：决定了没做 / 做了没验 / 验了不成 —— 读仓库里的文件，不查表，
    // 目录读不出来会自己下发一条「读不出来」，不靠 catch
    async (b) => pushLedgerItems(b, now),
    // 客户方案文档里写的一次性人工动作 —— 同样不落库、纯本地日期判断，过期自动消失
    async (b) => pushClientDocManualTaskItems(b, now),
    // 成交/咨询等着人核对要不要告诉广告平台 —— 撤不回的动作，只能人点（#1397）
    (b) => pushConversionReviewItems(supabase, b, clients, now).catch((e) =>
      console.warn('[manual-items] 成交待核对读取失败（不阻塞其他待办）:', e),
    ),
    // 邮件里确认收到款、但系统没法自动记成交的 —— 不写进待办就死在运行日志里
    (b) => pushPaymentEmailNeedsHumanItems(supabase, b, clients, now).catch((e) =>
      console.warn('[manual-items] 邮箱付款待核对读取失败（不阻塞其他待办）:', e),
    ),
    // AI 全自动审核被异常刹车暂停了 —— 拉模式，事件送达失败也照样出得来
    (b) => pushAiAutoReviewCircuitBreakerItems(supabase, b).catch((e) =>
      console.warn('[manual-items] AI 自动审核熔断状态读取失败（不阻塞其他待办）:', e),
    ),
    // AI 客服回复：待批准 / 已批但发送失败 / 超时升级三档（#1589）——拉模式，
    // 不依赖 Inngest 事件送达
    (b) => pushMessengerDraftItems(supabase, b, clients, now).catch((e) =>
      console.warn('[manual-items] AI 客服草稿待办读取失败（不阻塞其他待办）:', e),
    ),
    // 客户资料库信息快到期了，过期后 AI 客服不能再用这条信息回复客户（#1589）
    (b) => pushKnowledgeFactExpiringItems(supabase, b, clients, now).catch((e) =>
      console.warn('[manual-items] 客户资料库到期检查失败（不阻塞其他待办）:', e),
    ),
    // 目标数字口径对不上 —— 错的方向感比没数字更危险(2026-08-03 差点据此给出反向建议)
    (b) => pushBaselineItems(supabase, b),
    // 出片工单排队但没人干活 —— 装配跑在一台 Mac 上，不开机就没人做，而队列里看不出来
    (b) => pushFactoryWorkerItems(supabase, b, now, clients).catch((e) =>
      console.warn('[manual-items] 出片工人在岗检查失败（不阻塞其他待办）:', e),
    ),
    // Creatomate 渲染失败/超时 —— 旧路径的卡死回收已死透，这是它的替代（spec §4.4 B4）
    (b) => pushCreatomateRenderItems(supabase, b, now, clients).catch((e) =>
      console.warn('[manual-items] Creatomate 渲染检查失败（不阻塞其他待办）:', e),
    ),
    // 排期帖发出去了但拿不到帖子编号 —— 成绩收不回来，只写运行记录等于没人知道
    (b) => pushDailyPlanMeasurementItems(supabase, b, now, clients).catch((e) =>
      console.warn('[manual-items] 帖子成绩回收失败检查读取失败（不阻塞其他待办）:', e),
    ),
    // 正在花钱的广告撞上了已知的坑 —— 每天扫一遍的结果，不下发就等于没扫
    (b) => pushAdReadbackItems(supabase, b, now).catch((e) =>
      console.warn('[manual-items] 广告闸门结果读取失败（不阻塞其他待办）:', e),
    ),
    // Mailchimp 出口在 tally 里非预期失败（配置读不出来 / API key 失效 / 被限流 / 5xx）——
    // 这类失败从不设置 cron 结果的 error，cron 整体照样显示 completed，不单独捞出来就永远没人看见
    (b) => pushMailchimpExportItems(supabase, b, now).catch((e) =>
      console.warn('[manual-items] Mailchimp 出口检查失败（不阻塞其他待办）:', e),
    ),
    // 广告回拉读不出广告配置 → 诊断 / 经营状态 / 日报对这些客户静默跳过（2026-09-25 事故）。
    // 这类失败混在该任务常年的 Meta 报错里，`cron_failing` 那条看不出来，必须单独捞。
    (b) => pushAdsConfigReadItems(supabase, b, now).catch((e) =>
      console.warn('[manual-items] 广告配置读取检查失败（不阻塞其他待办）:', e),
    ),
    // 同一类：回拉读成功、自动暂停自己再读失败的窄窗口，痕迹只在它的回执里。
    (b) => pushAdsAutoPauseConfigReadItems(supabase, b, now).catch((e) =>
      console.warn('[manual-items] 自动暂停读配置检查失败（不阻塞其他待办）:', e),
    ),
    // Facebook 私信 / 表单留资同步连续失败 —— 报错原来只进运行记录，NAL 的主页授权
    // 2026-09-16 失效后 9 天没人知道，新私信新留资全没进 CRM。授权失效只有主页管理员能修，必须下发。
    (b) => pushFacebookSyncFailingItems(supabase, b, now).catch((e) =>
      console.warn('[manual-items] Facebook 同步失败检查读取失败（不阻塞其他待办）:', e),
    ),
    // 线索没写进客户自己的 Google 表格 —— 销售看的就是那张表，缺一条就是少跟一个人，
    // 而 Facebook 的留资只保留 90 天，超期永久取不回
    (b) => pushLeadSheetItems(supabase, b, now).catch((e) =>
      console.warn('[manual-items] 线索表格同步待办检查失败（不阻塞其他待办）:', e),
    ),
    // 日历上带日期的验证事项每天核对一遍 —— 读不到日历 / 巡检没跑成 / 没法自动核对都要摆到人眼前
    (b) => pushCalendarClosureItems(supabase, b, now).catch((e) =>
      console.warn('[manual-items] 日历到期事项巡检待办检查失败（不阻塞其他待办）:', e),
    ),
    // ME 产品动态自动发 LinkedIn —— 敏感内容待审 / 账号未连 / 发布失败三种卡点
    (b) => pushLinkedinProgressItems(supabase, b, now).catch((e) =>
      console.warn('[manual-items] LinkedIn 进度贴待办检查失败（不阻塞其他待办）:', e),
    ),
    // 客人说他付款了但没法自动确认 —— 只有人能对银行流水，不许机器自己打 paid 标签
    (b) => pushPaidSignalReviewItems(supabase, b, now).catch((e) =>
      console.warn('[manual-items] 待确认付款读取失败（不阻塞其他待办）:', e),
    ),
    // Magic Bridge 免费名额快用完 —— 用满后新客户这个月就生成不了报告（PM 定的全平台上限）
    (b) => pushMagicBridgeQuotaItems(supabase, b, now).catch((e) =>
      console.warn('[manual-items] Magic Bridge 免费额度待办生成失败（不阻塞其他待办）:', e),
    ),
    // 工具实验室有人留资（自助开通广告体检 / 网站诊断留邮箱）—— 这张表以前写完没人读
    (b) => pushToolLeadItems(supabase, b, clients, now).catch((e) =>
      console.warn('[manual-items] 工具实验室留资待办生成失败（不阻塞其他待办）:', e),
    ),
    // 工具实验室全站每月合计上限（网站诊断+广告体检赞助分析共用）快用完
    (b) => pushToolsWideBudgetItems(supabase, b, now).catch((e) =>
      console.warn('[manual-items] 工具实验室全站上限待办生成失败（不阻塞其他待办）:', e),
    ),
  ]
}

/** 按客户逐个查的通道 —— 只在客户名单读到且非空时跑。 */
function clientPushers(supabase: SupabaseClient, clients: Map<string, ClientRow>, now: Date): ManualItemPusher[] {
  const ids = Array.from(clients.keys())
  const nameOf = (id: string) => clients.get(id)?.name ?? '未知客户'
  return [
    // 广告 D3（花钱没结果）自动暂停建议等人批准——点一下就执行，不用去 Meta 后台
    (b) => pushAdsAutoPauseItems(supabase, b, nameOf).catch((e) =>
      console.warn('[manual-items] Ads D3 自动暂停待批准读取失败（不阻塞其他待办）:', e),
    ),
    // 体检的 AI 文字叙事没写成 —— 保存必报错被吞了三个多月没人知道（2026-10-18）。
    (b) => pushDiagnosticSynthesisItems(supabase, b, now).catch((e) =>
      console.warn('[manual-items] 体检叙事回执检查失败（不阻塞其他待办）:', e),
    ),
    // 新诊断结果 —— PM 2026-08-03 拍板要逐条看；没有消费方的自动化 = 再造一个没人看的数据源。
    // 必须放在 nameOf 定义之后：待办上显示 uuid 等于没显示。
    (b) => pushDiagnosticItems(supabase, b, now, nameOf),
    // 审批过但被价格闸拦住的帖子 —— 自动发布那条路人不在场,不捞出来就没人知道
    (b) => pushPriceGateItems(supabase, b, nameOf).catch((e) =>
      console.warn('[manual-items] 价格闸待办检查失败（不阻塞其他待办）:', e),
    ),
    // 每日计划里写了价格但跟客户资料对不上的帖子 —— 发布出口会整批拦下，不捞出来没人知道
    (b) => pushPriceFactItems(supabase, b, now, nameOf).catch((e) =>
      console.warn('[manual-items] 价格数字核对待办检查失败（不阻塞其他待办）:', e),
    ),
    // 客户员工改了团目录、点了「请 Magic Engine 上架」—— 不摆出来就没人去上架
    (b) => pushTourCatalogPublishRequestItems(supabase, b, nameOf).catch((e) =>
      console.warn('[manual-items] 团目录上架请求待办读取失败（不阻塞其他待办）:', e),
    ),
    // 自动发布没发出去 / 不确定发没发出去 / 已授权却没动静 —— 人不在场，不捞出来没人知道
    (b) => pushAutoPublishItems(supabase, b, now, nameOf, { live: process.env.DAILY_PLAN_AUTO_PUBLISH_LIVE === 'true' }).catch((e) =>
      console.warn('[manual-items] 自动发布待办检查失败（不阻塞其他待办）:', e),
    ),
    // Story 自动发布没发出去 / 不知道发没发出去 / 已授权却没动静
    (b) => pushStoryLiteItems(supabase, b, now, nameOf, { live: process.env.STORY_AUTO_PUBLISH_LIVE === 'true' }).catch((e) =>
      console.warn('[manual-items] Story 自动发布待办检查失败（不阻塞其他待办）:', e),
    ),
    // 本周方案已自动落地 —— 只通知，不要求 PM 操作（PM 2026-08-04 拍板）
    (b) => pushPrescriptionItems(supabase, b, now, nameOf),
    // 客资数值不值得信 —— 值不值得信只有查了统计后台才知道，别让人自己去翻
    (b) => pushLeadsSanityItems(supabase, b, nameOf).catch((e) =>
      console.warn('[manual-items] 客资口径检查失败（不阻塞其他待办）:', e),
    ),
    // 写好但没人看过的草稿 —— 这条待办以前只捞 pr_open，于是周更 cron 写出来的
    // 草稿一直沉在库里（实测 3 篇，最老的躺了 5 天，而上一篇真正上线的文章在 47 天前）。
    (b) => pushBlogDraftItems(supabase, b, ids, now, nameOf).catch((e) =>
      console.warn('[manual-items] 草稿待办生成失败（不阻塞其他待办）:', e),
    ),
    // 机器本来能自己做、今天却没做的动作 —— 拦下来的原因必须有人看见。
    // 只写进 cron 的运行记录 = 发现死在日志里（管道断头那条铁律的反面教材）。
    (b) => pushAutoRunItems(supabase, b, now, nameOf).catch((e) =>
      console.warn('[manual-items] 自动执行待办生成失败（不阻塞其他待办）:', e),
    ),
    // 评论读不到（缺权限 / 令牌被拒）—— 只有人能补，日志里那行 console.error 没人会看
    (b) => pushCommentScopeItems(supabase, b, now, nameOf).catch((e) =>
      console.warn('[manual-items] 评论权限待办生成失败（不阻塞其他待办）:', e),
    ),
    // 马良：Creatomate 成片的 9 宫格自检结果——过关等审片（署名）、不过关问返工还是放弃、
    // 检不了 / 出片 2 小时后没检进系统欠账栏。拉模式读工单 + 快照，事件丢了也照样出得来
    (b) => pushMaliangRenderItems(supabase, b, now, nameOf).catch((e) =>
      console.warn('[manual-items] 马良出片自检待办读取失败（不阻塞其他待办）:', e),
    ),
    // 李白：文案里「官网和 brief 都找不到依据」的句子 / 溯源检不了 / 生成后没检；
    // 另有提示词库月检结果（只报告不改）。拉模式读库和回执，事件丢了也照样出得来
    (b) => pushLibaiItems(supabase, b, now, nameOf).catch((e) =>
      console.warn('[manual-items] 李白待办读取失败（不阻塞其他待办）:', e),
    ),
    // 司马迁每周四起草的 Google 评价回复草稿（一律没发）—— 拉模式读它的回执，
    // 事件送达失败也照样出得来；巡不成的那条进系统欠账栏，不静默
    (b) => pushSimaqianReviewItems(supabase, b, now, nameOf).catch((e) =>
      console.warn('[manual-items] 司马迁口碑周巡待办读取失败（不阻塞其他待办）:', e),
    ),
    // 执行内核停手的 / 等你点头的 / 被规则挡下的 —— 死信不许只写进库里没人看
    (b) => pushKernelItems(supabase, b, now, nameOf).catch((e) =>
      console.warn('[manual-items] 执行内核待办生成失败（不阻塞其他待办）:', e),
    ),
    // 自治开关没同步到执行内核 —— 面板档位跟内核实际档位对不上，必须有人看见（WP3.1a）
    (b) => pushAdsAutonomySyncItems(supabase, b, now, nameOf).catch((e) =>
      console.warn('[manual-items] 自治开关同步待办生成失败（不阻塞其他待办）:', e),
    ),
    // 每日广告巡检的广告级规则（D2 / D10）—— 只读，要不要改由人定；同一件事按 remind-cadence 节奏提醒
    (b) => pushAdsRuleFindingItems(supabase, b, now, nameOf).catch((e) =>
      console.warn('[manual-items] 广告级规则待办生成失败（不阻塞其他待办）:', e),
    ),
    // 广告熔断中的账户 —— 判据是"现在还处在熔断中吗"，不是时间窗口（v2.5 §6.2 派生态）
    (b) => pushAdsCircuitItems(supabase, b, nameOf).catch((e) =>
      console.warn('[manual-items] 广告熔断待办生成失败（不阻塞其他待办）:', e),
    ),
    // Meta 广告账户状态不是正常（欠款 / 被限制）超过 24 小时 —— 账户停摆时不会花钱也不会有新线索，系统里没有别处会说
    (b) => pushAdsAccountStatusItems(supabase, b, now, nameOf).catch((e) =>
      console.warn('[manual-items] 广告账户状态待办生成失败（不阻塞其他待办）:', e),
    ),
    // 推广计划每日检查：草稿等批准 / 批准后被改 / 到期阶段没过 / 对账偏差 / 检查自己没跑成
    (b) => pushPromoPlanWatchItems(supabase, b, nameOf).catch((e) =>
      console.warn('[manual-items] 推广计划每日检查待办生成失败（不阻塞其他待办）:', e),
    ),
    // 月循环目标没自动续上 —— 自动续建失败不许只写日志（铁律 3）
    (b) => pushGoalRolloverItems(supabase, b, nameOf).catch((e) =>
      console.warn('[manual-items] 月目标续建缺口待办生成失败（不阻塞其他待办）:', e),
    ),
    // Facebook 删除数据请求处理失败 —— 失败不许只写日志（铁律 3）
    (b) => pushDataDeletionFailureItems(supabase, b, now).catch((e) =>
      console.warn('[manual-items] 删除数据请求失败待办生成失败（不阻塞其他待办）:', e),
    ),
    // 客户之间有没有串台 —— PM 2026-08-05：「坚决不能胡窜」。
    // 实测查到 CTS 的发布通道指向 Oztop 的网站，填错两个多月没人发现。
    (b) => pushCrossClientItems(supabase, b).catch((e) =>
      console.warn('[manual-items] 串台检查失败（不阻塞其他待办）:', e),
    ),
    // 可能被一句「不打算去」误判成永久拒联的人 —— 刻意不自动解除，交给人看一眼。
    (b) => pushDncReviewItems(supabase, b, ids, nameOf).catch((e) =>
      console.warn('[manual-items] 拒联复核待办生成失败（不阻塞其他待办）:', e),
    ),
    // 电话系统收了通话、但没能自动记进客人档案 —— 接真实客人线路前必须有人看得见（PM 2026-10-12）
    (b) => pushPhoneReviewItems(supabase, b, ids, nameOf).catch((e) =>
      console.warn('[manual-items] 待确认电话待办生成失败（不阻塞其他待办）:', e),
    ),
    // 反向的那一半：客人在私信里像是说了「别再联系」，而判据从来读不到私信（#1025）。
    // 刻意**不自动封渠道**，只提示 —— 理由见 lib/crm/messenger-stop-signal.ts 文件头。
    (b) => pushMessengerStopItems(supabase, b, ids, now, nameOf).catch((e) =>
      console.warn('[manual-items] 私信拒联提示生成失败（不阻塞其他待办）:', e),
    ),
    // 客人身上的「⭐重要标记」到期了 —— 到期日到了自动进待办，员工清 due 日期即消失
    (b) => pushImportantDueItems(supabase, b, ids, nameOf, now).catch((e) =>
      console.warn('[manual-items] 重要标记到期读取失败（不阻塞其他待办）:', e),
    ),
    // 客人来信超过一天没人回 + 公司邮箱同步哑了（后者会让前者假装成零条），见 email-reply-items.ts
    (b) => pushEmailReplyItems(supabase, b, ids, now, nameOf).catch((e) =>
      console.warn('[manual-items] 客人来信没回待办生成失败（不阻塞其他待办）:', e),
    ),
    // 客人填了表超过 24 小时没人回 —— 汇总信的开关一直关着，没有任何人被指派（CTS 积压 170 条）。
    (b) => pushLeadFollowupItems(supabase, b, ids, now, nameOf).catch((e) =>
      console.warn('[manual-items] 线索没人回待办生成失败（不阻塞其他待办）:', e),
    ),
    // 客户交了广告账户号等核实 —— 客户以为交上去了，不下发就没人知道（AD-SEC-3）
    (b) => pushBindingRequestItems(supabase, b, ids, now, nameOf).catch((e) =>
      console.warn('[manual-items] 广告账户号待核实读取失败（不阻塞其他待办）:', e),
    ),
    // 主页绑定没核实 → 私信/线索同步被暂停（AD-SEC-4）。读失败时自己生成一条待办，不靠 catch。
    (b) => pushPageBindingItems(supabase, b, process.env),
    // 归因侧两条通道（黑洞 / 孤儿数据），理由见 attribution-items.ts
    (b) => pushAttributionItems(supabase, b, ids, nameOf, now),
    // 私信客服健康心跳查出的异常（issue #1587）——拉模式，直接查
    // conversation_health_alerts，事件送达失败也照样出得来
    (b) => pushConversationHealthAlertItems(supabase, b, now, nameOf).catch((e) =>
      console.warn('[manual-items] 私信客服健康告警读取失败（不阻塞其他待办）:', e),
    ),
    (b) => pushSiteHealthItems(supabase, b, ids, nameOf, now),
    // 经验手册疑似过期——每周巡检写进 playbook_staleness_findings，这里拉模式读出来
    (b) => pushPlaybookStalenessItems(supabase, b).catch((e) =>
      console.warn('[manual-items] 经验手册过期检查读取失败（不阻塞其他待办）:', e),
    ),
  ]
}

/** 待合并的博客 PR / 未收录页面 / 标题描述改动卡住 / 站点数据健康 —— 原来末尾那一段，内部顺序不变。 */
async function pushSiteHealthItems(
  supabase: SupabaseClient, items: ManualItem[], ids: string[], nameOf: (id: string) => string, now: Date,
): Promise<void> {
  // GSC property per client —— 汇总后的「未收录页面」待办链到这里。谷歌自己的
  // 「索引 → 网页」报告才是权威的「哪些页面没被收录、为什么」清单；ME 后台没有
  // 任何展示收录状态的页面（实测 /site-audit/pages 只有网址/字数，无收录状态）。
  const { data: connectors } = await supabase
    .from('client_connectors')
    .select('client_id, config')
    .eq('anchor', 'gsc')
    .eq('status', 'connected')
    .in('client_id', ids)
  const siteUrlOf = new Map(
    ((connectors ?? []) as Array<{ client_id: string; config: { site_url?: string } | null }>)
      .filter((c) => c.config?.site_url)
      .map((c) => [c.client_id, c.config!.site_url!]),
  )

  const [prOpen, notIndexed, metaPending, crawlRows] = await Promise.all([
    supabase
      .from('blog_posts')
      .select('client_id, title, topic, pr_url, pr_number')
      .eq('status', 'pr_open')
      .in('client_id', ids),
    // 🔴 未收录页面必须读全（Codex P2）：一页一条时截断只是少报几行，但汇总
    //    报数时截断会让「N 个页面」谎报、甚至把整客户漏掉。用 fetchAll 分页读全，
    //    按 (client_id, url) 全序排序保证跨页不重不漏。
    // 🔴 fetchAll 会**抛错**（分页失败 / 触 10 万行硬顶），而普通 supabase 查询
    //    只返回 {error} 不抛。它在这个 Promise.all 里，抛出会让整个 loadManualItems
    //    失败 → daily-todo.ts 把**所有**人工待办替换成 []（广告红线、串台、LinkedIn
    //    全从邮件和看板消失，只剩一行日志）。所以这一路必须自己兜住，只丢 not_indexed，
    //    不拖垮别的通道 —— 跟本文件每条通道的 .catch 隔离纪律一致（Codex P1 #1375）。
    fetchAll<NotIndexedRow>((from, to) =>
      supabase
        .from('client_site_pages')
        .select('client_id, url, index_verdict, first_not_indexed_at, word_count, crawl_status, crawled_at')
        .not('first_not_indexed_at', 'is', null)
        .in('client_id', ids)
        .order('client_id', { ascending: true })
        .order('url', { ascending: true })
        .range(from, to),
    ).catch((e: unknown) => {
      console.warn(
        '[manual-items] 未收录页面读取失败（不阻塞其他待办）:',
        e instanceof Error ? e.message : String(e),
      )
      return [] as NotIndexedRow[]
    }),
    supabase
      .from('seo_meta_log')
      .select('client_id, page_slug, created_at, applied_channel')
      .eq('wp_updated', false)
      .in('client_id', ids),
    // 站点数据健康：分页读全（按新到旧 .limit(500) 截掉的恰恰是数据最旧的客户），
    // 读失败只丢这一路，不拖垮别的待办（同上面未收录那一路的 .catch 隔离纪律）。
    fetchAll<CrawlHealthRow>((from, to) =>
      supabase
        .from('client_site_pages')
        .select('client_id, crawled_at, crawl_status')
        .in('client_id', ids)
        .order('client_id', { ascending: true })
        .order('url', { ascending: true })
        .range(from, to),
    ).catch((e: unknown) => {
      console.warn(
        '[manual-items] 站点数据健康读取失败（不阻塞其他待办）:',
        e instanceof Error ? e.message : String(e),
      )
      return [] as CrawlHealthRow[]
    }),
  ])

  // 1. Blog PRs waiting on a human merge — the article is written and tested,
  //    it just needs someone to press the button.
  for (const row of (prOpen.data ?? []) as Array<{
    client_id: string
    title: string | null
    topic: string | null
    pr_url: string | null
  }>) {
    if (!row.pr_url) continue
    items.push({
      kind: 'blog_pr_open',
      client_id: row.client_id,
      client_name: nameOf(row.client_id),
      what: `文章《${row.title ?? row.topic ?? '未命名'}》已写好并提交到网站，还没上线`,
      how: '打开这个链接，检查通过后点 Merge —— 合并后系统会自动催谷歌收录',
      href: row.pr_url,
    })
  }

  // 2. Pages Google won't index —— 一个客户汇总成一条，见 buildNotIndexedItems。
  items.push(...buildNotIndexedItems(notIndexed, siteUrlOf, nameOf, now))

  // 3. Meta changes queued but not applied — the Oztop WP plugin polls this
  //    queue; a long backlog means the plugin stopped.
  //
  //    CTS (and any other repo-PR client — applied_channel='pr') is EXCLUDED
  //    here: its cts-meta-pr.ts / seo-meta-cycle flow always writes
  //    wp_updated=false even after the PR has been opened/merged (there is
  //    no client-side plugin polling this queue for it), so before this
  //    filter every CTS row eventually surfaced a false "Magic Engine 插件
  //    is stopped" alert — a client that has no such plugin. Detecting a
  //    genuinely stuck repo-PR (opened but never merged) needs a separate
  //    GitHub PR-state check, not this queue-age heuristic; that's tracked
  //    as follow-up work, not solved here.
  const metaByClient = new Map<string, { count: number; oldest: string }>()
  for (const row of (metaPending.data ?? []) as Array<{
    client_id: string
    created_at: string
    applied_channel?: string | null
  }>) {
    if (row.applied_channel === 'pr') continue
    const cur = metaByClient.get(row.client_id)
    if (!cur || row.created_at < cur.oldest) {
      metaByClient.set(row.client_id, { count: (cur?.count ?? 0) + 1, oldest: row.created_at })
    } else {
      cur.count += 1
    }
  }
  for (const [clientId, agg] of Array.from(metaByClient.entries())) {
    const days = daysAgo(agg.oldest, now)
    if (days === null || days < META_PENDING_STALE_DAYS) continue
    items.push({
      kind: 'meta_stuck',
      client_id: clientId,
      client_name: nameOf(clientId),
      what: `${agg.count} 条标题/描述改动排了 ${days} 天还没上到网站，说明网站那边的自动应用停了`,
      how: '登录客户网站后台看看 Magic Engine 插件是不是被停用了，启用它就会自动补上',
      href: `https://app.magicengine.com.au/dashboard/clients/${clientId}/settings`,
    })
  }

  // 4. Site page data health — stale real crawls + firewall-blocked pages.
  //    Built in manual-item-types.ts (pure, testable); see buildCrawlHealthItems.
  const weeklyRecrawlIds = await loadWeeklyRecrawlClientIds(supabase, ids)
  items.push(...buildCrawlHealthItems(crawlRows, nameOf, now, weeklyRecrawlIds))
}



/**
 * 平台候选到了复查日期 —— 接入既有 pm-daily-todo 管道（NZ 工作日早晨已在跑,
 * render.yaml 已排班,不需要新开 cron)，而不是只靠"当值 FDE 记得每月第一个
 * 周一"这句日历式 SOP。见 platform-candidate-reviews.ts 头注。
 *
 * 🔴 日期判断走 Pacific/Auckland 时区，不能用 `Date.parse('YYYY-MM-DD')`：
 * 后者把日期解释为 UTC 零点，而 cron 在 19:00 UTC 跑（次日 07:00/08:00 NZDT），
 * 复查日为 2026-09-28 时，周一 08:00 NZDT 的运行时刻仍是 2026-09-27T19:00Z，
 * 判据 `now.getTime() < due` 就跳过，提醒直到周二才出现（周五到期拖到下周一）。
 */
function nzDateStr(now: Date): string {
  // en-CA 输出 'YYYY-MM-DD' 便于字符串比较（同 formatted YYYY-MM-DD reviewDate）
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Pacific/Auckland',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

export function pushPlatformCandidateReviewItems(
  items: ManualItem[],
  now: Date,
  reviews: PlatformCandidateReview[] = PLATFORM_CANDIDATE_REVIEWS,
): void {
  const nzToday = nzDateStr(now)
  for (const c of reviews) {
    // reviewDate 必须是 'YYYY-MM-DD' 格式（platform-candidate-reviews.ts 类型约束）
    // YYYY-MM-DD 字符串按字典序比较即等于日期比较；nzToday >= reviewDate 即"NZ 当天或已过期"
    if (nzToday < c.reviewDate) continue
    items.push({
      kind: 'platform_candidate_review_due',
      client_id: 'infra',
      client_name: 'Magic Engine 平台治理',
      what: `平台候选「${c.name}」到了复查日期（${c.reviewDate}），该扫一遍有没有新客户/新行业的硬证据了`,
      how: '打开候选登记表，看这条候选的「硬证据进度」列要不要更新；凑齐晋升判据就走 2 审提案，没有就把「复查日」列往后推一个月（同时更新 platform-candidate-reviews.ts 里的日期，否则这条提醒下次不会再出现）',
      href: PLATFORM_CANDIDATE_REGISTRY_URL,
    })
  }
}

/**
 * 一次性 client ops 请求（写在客户方案文档里、只对某个日期有效）——
 * 只登记在文档里等于没下发（CLAUDE.md 铁律 3 下半：管道不许断头）。
 *
 * 与 PLATFORM_CANDIDATE_REVIEWS 同样是"纯本地日期判断，不落库"，但语义不同：
 * 那边是"到期该做"，这里是"过期就不用再提醒"——用 `expiresAt` 而不是 `dueDate`。
 * 过了 `expiresAt` 不用回来删这一行，判据本身会让它自然消失。
 *
 * 任务清单本身在 `client-doc-manual-tasks.ts`（同 platform-candidate-reviews.ts
 * 的分离方式）：这里只留通用加载逻辑，客户特例数据不进这份共享运行时文件。
 */
export function pushClientDocManualTaskItems(
  items: ManualItem[],
  now: Date,
  tasks: ClientDocManualTask[] = CLIENT_DOC_MANUAL_TASKS,
): void {
  for (const t of tasks) {
    if (now.getTime() > Date.parse(t.expiresAt)) continue
    items.push({
      kind: 'client_doc_manual_task',
      client_id: t.clientId,
      client_name: t.clientName,
      what: t.what,
      how: t.how,
      href: t.href,
      ...(t.pmKind ? { pm_kind: t.pmKind } : {}),
    })
  }
}

async function pushBaselineItems(supabase: SupabaseClient, items: ManualItem[]): Promise<void> {
  const suspects = await auditGoalBaselines(supabase).catch(() => [])
  for (const s of suspects) {
    items.push({
      kind: 'goal_baseline_mismatch',
      client_id: s.clientId,
      client_name: s.clientName,
      what: `目标「${s.title}」的仪表盘数字可能是反的 —— ${s.reason}`,
      how: `打开目标页核对：如果确认起点填错了，把它改成 ${s.recomputedBaseline}，仪表盘才会说真话。改之前先想一下这个目标当初是按哪个口径定的`,
      // 真实路径是 /clients/<客户id>/goal/<目标id> —— 首版拼成 /clients/<目标id>，那是 404
      href: `https://app.magicengine.com.au/dashboard/clients/${s.clientId}/goal/${s.goalId}`,
    })
  }
}

/**
 * 客户之间串台 —— 一个客户名下存着另一个客户的东西。
 *
 * 这条**不按客户过滤**：串台天生涉及两个客户，任何一方被过滤掉都会让问题
 * 从待办里消失。也不做「只报 active 客户」—— 潜客的资料串进正式客户同样是事故。
 */
/** 渠道代号 → 人话名字，不在 what 字段里出现 `messenger`/`whatsapp` 这种没解释过的裸词。 */
function conversationChannelLabel(channel: string): string {
  if (channel === 'messenger') return 'Facebook Messenger'
  if (channel === 'whatsapp') return 'WhatsApp'
  return channel
}

/** check_type 代号 → 人话问题描述（不把代号本身抛给 PM/FDE）。 */
function conversationHealthProblemLabel(checkType: string): string {
  switch (checkType) {
    case 'webhook_silent':
      return '收到的客户消息量突然明显变少，像是接收链路安静地断了'
    case 'verifier_block_rate_high':
      return 'AI 写的回复大多被系统自己拦下，没能发出去'
    case 'verifier_error_rate_high':
      return 'AI 起草回复这一步一直在报错'
    case 'optout_write_failed':
      return '客户说了「别再联系我」，但系统记这件事时失败了'
    default:
      return '心跳检查发现异常'
  }
}

/** check_type 代号 → 该先查什么（跟 issue #1587 原文四类问题一一对应）。 */
function conversationHealthHowLabel(checkType: string, channelLabel: string): string {
  switch (checkType) {
    case 'webhook_silent':
      return `先看 ${channelLabel} 那边的官方后台连接状态是不是掉了；如果连接正常，也可能这段时间客户确实没人来问，看一眼对话记录再判断`
    case 'verifier_block_rate_high':
      return '打开对话看几条被拦下的草稿——多半是客户资料库里的信息（团期/价格）过期了，或者 AI 理解错了客户的问题'
    case 'verifier_error_rate_high':
      return 'AI 起草回复这一步在报错，这不是你能直接修的，回一句「AI 报错」我去查'
    case 'optout_write_failed':
      return '先打开对话确认这几位客户有没有在被继续联系；需要的话在他们的记录里手动写一句「客户说别再联系」，系统会立刻停掉所有渠道'
    default:
      return '打开对话看一下最近发生了什么'
  }
}

interface ConversationHealthAlertRow {
  client_id: string
  channel: string
  check_type: string
  detail: string
  first_detected_at: string
}

/**
 * 私信客服健康心跳（issue #1587）查出的异常——拉模式，直接查
 * `conversation_health_alerts`：这张表本身就是「现在正在报警的问题」，健康了
 * 心跳函数自己会把行删掉，这里不需要再按时间过滤。
 */
async function pushConversationHealthAlertItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const { data, error } = await supabase
    .from('conversation_health_alerts')
    .select('client_id, channel, check_type, detail, first_detected_at')
  if (error) throw new Error(error.message)

  for (const row of (data ?? []) as ConversationHealthAlertRow[]) {
    const channelLabel = conversationChannelLabel(row.channel)
    const firstDetectedMs = Date.parse(row.first_detected_at)
    const hoursOngoing = Number.isNaN(firstDetectedMs)
      ? null
      : Math.max(0, Math.floor((now.getTime() - firstDetectedMs) / 3_600_000))
    const durationText =
      hoursOngoing === null
        ? ''
        : hoursOngoing < 24
          ? `，已经持续 ${hoursOngoing} 小时没恢复`
          : `，已经持续 ${Math.floor(hoursOngoing / 24)} 天没恢复`

    items.push({
      // 「AI 起草一直报错」只有我们能修，拆成单独一种，今日待办按 kind 把它转给开发
      kind: row.check_type === 'verifier_error_rate_high' ? 'conversation_health_check_error' : 'conversation_health_alert',
      client_id: row.client_id,
      client_name: nameOf(row.client_id),
      what: `${channelLabel} 私信客服：${conversationHealthProblemLabel(row.check_type)}${durationText}（${row.detail}）`,
      how: conversationHealthHowLabel(row.check_type, channelLabel),
      href: `https://app.magicengine.com.au/dashboard/clients/${row.client_id}/messenger`,
    })
  }
}

export async function pushCrossClientItems(supabase: SupabaseClient, items: ManualItem[]): Promise<void> {
  const findings = await auditCrossClientLeaks(supabase)
  // 同一个网址 / 账号查出的几条是**同一件串台**的不同侧面（2026-09-25：「CTS 名下存着
  // oztop 的网址」和「CTS 与 oztop 的发布通道指向同一网址」是一件事）—— 合成一条，
  // 所有涉及的客户和说法都留着。不同网址的不合：两件串台就是两件事。
  const groups = new Map<string, { severity: 'critical' | 'warning'; value: string; clients: string[]; whats: string[] }>()
  for (const f of findings) {
    const key = `${f.severity}|${f.value.trim().toLowerCase().replace(/\/+$/, '')}`
    const g = groups.get(key) ?? { severity: f.severity, value: f.value, clients: [], whats: [] }
    for (const c of f.clients) if (!g.clients.includes(c)) g.clients.push(c)
    g.whats.push(f.what)
    groups.set(key, g)
  }
  for (const f of Array.from(groups.values())) {
    const what = f.whats.join('；')
    items.push({
      kind: 'cross_client_leak',
      // 串台涉及多个客户，名字里全列出来，别只挂一个
      client_id: 'infra',
      client_name: f.clients.join(' / '),
      what:
        f.severity === 'critical'
          ? `🔴 客户资料串台：${what}`
          : `⚠️ ${what}`,
      how:
        f.severity === 'critical'
          ? '进客户设置页核对这条配置填的是不是本人的。在纠正之前，系统已经拒绝用它发布任何东西'
          : '确认一下归因口径：这笔花费该算给谁，或者要不要拆开记',
      // 🔴 必须是绝对网址。写成相对路径 `/dashboard/clients` 时，
      //    链接闸的 `new URL()` 会抛错 → 判成 broken → **整条待办被丢掉**，
      //    只剩一行 console.warn。狄仁杰 2026-08-05 实跑证实 kept=0 ——
      //    也就是说这套串台排查产出为零，而我正是在修「发现死在日志里」的时候
      //    又造了一个。绝对网址会命中「登录类站点」名单 → unverifiable → 保留。
      href: 'https://app.magicengine.com.au/dashboard/clients',
    })
  }
}

/**
 * 写好但没人看过的博客草稿。
 *
 * 上面那条 `blog_pr_open` 只捞 `status='pr_open'`，而 `draft → pr_open` 需要
 * 有人手动去点发布 —— 没有任何自动化在做这一步。于是周更 cron 每周写出来的
 * 草稿全部沉在库里：实测 3 篇没人看过，而上一篇真正上线的文章在 47 天前。
 */
async function pushBlogDraftItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  ids: string[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const todos = await fetchBlogDraftTodos(supabase, ids, now)
  for (const t of todos) {
    items.push({
      // 发布通道断了的那种，人要做的是去设置里接通（点一次），不是审稿
      kind: t.channelBroken ? 'blog_publish_channel_broken' : 'blog_draft_waiting',
      client_id: t.client_id,
      client_name: nameOf(t.client_id),
      what: t.what,
      how: t.how,
      href: t.href,
    })
  }
}

/**
 * 自动执行这条线今天的产出说明。
 *
 * 两类：机器已经停手的（一条一条报）、被闸门拦下的（按客户汇总一条）。
 * 判定复用 cron 自己的选择函数，所以这里说的话跟机器真做的事永远一致。
 */
async function pushAutoRunItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const todos = await fetchAutoRunTodos(supabase, now)
  for (const t of todos) {
    items.push({
      kind: t.stuck ? 'auto_run_stuck' : 'auto_run_blocked',
      client_id: t.client_id,
      client_name: nameOf(t.client_id),
      what: t.what,
      how: t.how,
      href: t.href,
    })
  }
}

/**
 * 评论自动回复读不到评论 → 下发。
 *
 * 判定与文案都在 `comment-scope-items.ts`：那边直接读 cron 自己写的运行记录，
 * 所以这里说的话跟机器真遇到的失败永远一致。
 *
 * 也覆盖「读得到评论、但回复被 Meta 拒掉」的那种（缺 pages_manage_engagement）——
 * 判定与文案在 `comment-reply-scope-items.ts`。
 */
async function pushCommentScopeItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const todos = await fetchCommentScopeTodos(supabase, now)
  for (const t of todos) {
    items.push({
      kind: t.kind,
      client_id: t.client_id,
      client_name: nameOf(t.client_id),
      what: t.what,
      how: t.how,
      href: t.href,
    })
  }
  const failingTodos = await fetchCommentAutoreplyRunFailingTodos(supabase, now)
  for (const t of failingTodos) {
    items.push({
      kind: t.kind,
      client_id: t.client_id,
      client_name: nameOf(t.client_id),
      what: t.what,
      how: t.how,
      href: t.href,
    })
  }
  const replyTodos = await fetchCommentReplyScopeTodos(supabase, now)
  for (const t of replyTodos) {
    items.push({
      kind: t.kind,
      client_id: t.client_id,
      client_name: nameOf(t.client_id),
      what: t.what,
      how: t.how,
      href: t.href,
    })
  }
}

/**
 * 执行内核里需要人处理的东西 → 下发。
 *
 * 三种：重试到上限停手的（死信）、按客户规则要人点头的、被规则挡下的。
 * 判定复用 Kernel 自己的取数函数，所以这里说的话跟库里的状态永远一致。
 *
 * 🔴 这条是「管道不许断头」的执行内核侧出口。没有它，一次死信就只是
 *    `action_runs` 里一行 `status='dead_letter'` —— 没有任何人会去翻。
 */
async function pushKernelItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  const todos = await fetchKernelHandoffTodos(supabase, now)
  for (const t of todos) {
    items.push({
      kind: 'kernel_needs_human',
      client_id: t.client_id,
      client_name: nameOf(t.client_id),
      what: t.what,
      how: t.how,
      href: t.href,
    })
  }
}
