/**
 * 2026-09-25（周五）那封「📋 今日待办 · 周五 · 166 件」的组成，按生产形状重建。
 *
 * 来源：那封邮件原文（逐条对过）+ 生产库只读核对（2026-09-26）。客人姓名一律换成占位，
 * 客户名保留（测试夹具，不进共享运行代码）。
 *
 * - `BEFORE`：旧代码当天实际吐出来的东西（56 条人工待办 + 各栏计数）。
 * - `AFTER`：同一天的库，换成这次改过的源头之后会吐出来的东西。源头的变化只有这几处：
 *     · 推销 / 自测邮件：从「客人来信没回」挪进一条「陌生地址来信」（自测那封直接不列）
 *     · 客人来信不再封顶 10 条 + 「还有 23 封没列」，全部下发，由今日待办合成一行
 *     · 两条同一个网址的「客户资料串台」在源头合成一条
 *     · 「文章写好了但发布通道断了」拆成单独一种（要人去接通，不是审稿）
 *     · NAL 那条「要不要对生产库执行」在方案文档里标成拍板
 *   过期的成交回传提醒**还在**：那一刀归另一个窗口（7 天时限统一），它合进去以后
 *   这 20 条会在源头就被清掉；这里先看合并成一行的效果。
 *
 * 🔴 23 封没列出来的客人来信，生产库拿不到当天的完整名单（要服务钥匙才能跑同一套判据），
 *    这里按「全是真客人」建 —— 对「今天几件」没有影响：真客人来信不管几封都合成一行。
 */

import type { ManualItem, ManualItemKind } from '../../manual-item-types'
import type { TodoCounts } from '../../daily-todo'

const CTS = 'c0000000-0000-0000-0000-000000000000'
const OZ = 'd5c98811-1c1d-4ded-bdf0-4cefec6afb84'
const ROMAN = 'e7465ac7-4f3d-4d6a-afbe-d036ab419708'
const NAL = '4ae76381-cd45-43bd-85cd-98cfd7604007'
const NZCPE = '3f3617f5-2124-475d-9212-6f8c14f0b0e2'
const ME_CLIENT = 'f1d062ca-929e-4b4e-ba6e-84752b748552'
const APP = 'https://app.magicengine.com.au'

function mi(kind: ManualItemKind, client_id: string, client_name: string, what: string, how: string, href: string, extra: Partial<ManualItem> = {}): ManualItem {
  return { kind, client_id, client_name, what, how, href, ...extra }
}

const SETUP: TodoCounts['setupTasks'] = [
  { name: 'CTS Tours NZ', id: CTS, label: '一次点完客户全部 Google 权限', href: `${APP}/api/auth/google/connect?client_id=${CTS}` },
  { name: 'oztop', id: OZ, label: '一次点完客户全部 Google 权限', href: `${APP}/api/auth/google/connect?client_id=${OZ}` },
  { name: 'Roman HU', id: ROMAN, label: '一次点完客户全部 Google 权限', href: `${APP}/api/auth/google/connect?client_id=${ROMAN}` },
]

const CONVERSION_HOW = '打开页面，在这条上点「不发送」并选原因「超过时限」即可。'
const conversions = (): ManualItem[] =>
  Array.from({ length: 20 }, (_, i) =>
    mi('conversion_needs_review', CTS, 'CTS Tours NZ',
      `客人 ${i + 1} ${13 - Math.min(i, 4)} 天前来问过一次。要把「这是个真实咨询」告诉广告平台吗？⚠️ 已超过 7 天`,
      CONVERSION_HOW, `${APP}/dashboard/conversions?client=${CTS}&focus=outcome-${i + 1}`))

const EMAIL_HOW = '点链接直接展开到这位客人，先把那封信看完整……不用回的话也得写一句话记一笔'
const emailDue = (id: string, name: string) =>
  mi('email_reply_due', CTS, 'CTS Tours NZ', `${name} 发到公司邮箱的信已经等了很久没人回`, EMAIL_HOW,
    `${APP}/dashboard/clients/${CTS}/crm/all?contact=${id}`)

/** 两天都一样的那些人工待办（源头没变）。 */
const SHARED: ManualItem[] = [
  mi('ai_provider_exhausted', 'infra', 'Magic Engine 后台', '1 天前断过一次：AI 文字账户的钱用完了', '打开链接充值', 'https://platform.openai.com/settings/organization/billing/overview'),
  mi('platform_candidate_review_due', 'infra', 'Magic Engine 平台治理', '平台候选「Lead 温度打分」到了复查日期', '打开候选登记表看硬证据进度', 'https://github.com/bigbigraydeng-maker/magic-engine/blob/main/docs/registry/platform-candidates.md'),
  mi('platform_candidate_review_due', 'infra', 'Magic Engine 平台治理', '平台候选「Governed Lead-Reply Agent」到了复查日期', '打开候选登记表看硬证据进度', 'https://github.com/bigbigraydeng-maker/magic-engine/blob/main/docs/registry/platform-candidates.md'),
  mi('ledger_verification_failed', 'infra', 'Magic Engine 平台治理', '「Claude 记忆索引超过截断线」验过了，不成', '说「台账 … 重做」或「关闭」', 'https://github.com/bigbigraydeng-maker/magic-engine/blob/main/docs/ledger/2026-09-24-memory-index-over-limit.md'),
  mi('client_doc_manual_task', NAL, 'New Asian Logistics (NAL)', '系统用户令牌缺 WhatsApp 管理权限', '在 Business Settings 重新生成令牌', 'https://business.facebook.com/settings/system-users'),
  mi('client_doc_manual_task', NAL, 'New Asian Logistics (NAL)', '生产环境还没配 WhatsApp 回调要的两个变量', '登录 Render 和 Meta App 后台各填一处', 'https://developers.facebook.com/apps/'),
  mi('ai_auto_review_circuit_breaker', CTS, 'CTS Tours NZ', '成交自动审核因为异常已经自动暂停', '看一眼最近几条记录，没问题再打开开关', `${APP}/dashboard/conversions?client=${CTS}`),
  mi('factory_worker_idle', 'infra', 'Magic Engine 后台', '【CTS Tours NZ】1 个出片工单在排队，那台 Mac 没开机', '在那台 Mac 上跑出片工人', `${APP}/dashboard/factory`),
  mi('lead_sheet_backfill_pending', CTS, 'CTS Tours NZ', '709 条更早的线索没跟表格核对过', '跟开发窗口说一声跑一次试算', 'https://docs.google.com/spreadsheets/d/sheet/edit'),
  mi('linkedin_progress_needs_review', 'me', 'ME 产品动态（LinkedIn）', '9 条 LinkedIn 进度贴草稿可能带客户敏感信息', '逐条读一遍再批准', `${APP}/dashboard/clients/me/content-factory`),
  mi('leads_metric_untrusted', CTS, 'CTS Tours NZ', '目标的客资数不能信 —— 网站没有事件被标成「关键事件」', '在客户的网站统计后台改', `${APP}/dashboard/clients/${CTS}/goal/g1`),
  mi('blog_draft_waiting', CTS, 'CTS Tours NZ', '有 2 篇写好的文章还没人看过', '打开看一眼，觉得可以就点发布', `${APP}/dashboard/clients/${CTS}/blog`),
  mi('cross_client_leak', 'infra', '30 Kiteroa Rothesay Bay / Roman HU', '⚠️ 两个客户共用广告账户 act_1 —— 同一笔花费可能算进两个客户', '确认一下归因口径', `${APP}/dashboard/clients`),
  mi('dnc_maybe_wrong', CTS, 'CTS Tours NZ', '客人 D 被标成永久别再联系，但原话只说了「不打算去」', '看往来记录再决定', `${APP}/dashboard/clients/${CTS}/crm/all?contact=d1`),
  mi('facebook_page_binding_unverified', NZCPE, 'NZCPE 2026', '私信和留资已暂停：主页绑定没通过核实', '在设置里点「重新核实」', `${APP}/dashboard/clients/${NZCPE}?settings=platform`),
  mi('facebook_page_binding_unverified', ROMAN, 'Roman HU', '主页还在同步，但这个绑定没有核实记录', '在设置里点「重新核实」', `${APP}/dashboard/clients/${ROMAN}?settings=platform`),
  mi('not_indexed', CTS, 'CTS Tours NZ', '4 个页面没被谷歌收录', '打开站内清单逐页处理', `${APP}/dashboard/clients/${CTS}/site-audit/pages?filter=not-indexed`),
  mi('not_indexed', OZ, 'oztop', '148 个页面没被谷歌收录', '打开站内清单逐页处理', `${APP}/dashboard/clients/${OZ}/site-audit/pages?filter=not-indexed`),
  mi('meta_stuck', OZ, 'oztop', '25 条标题/描述改动排了 59 天还没上到网站', '看看客户网站上的 ME 插件是不是被停用了', `${APP}/dashboard/clients/${OZ}/settings`),
  mi('crawl_stale', ME_CLIENT, 'Magic Engine', '网站页面数据 38 天没更新了', '点 Start New Audit 重扫', `${APP}/dashboard/clients/${ME_CLIENT}/site-audit/pages`),
  mi('crawl_stale', ROMAN, 'Roman HU', '网站页面数据 38 天没更新了', '点 Start New Audit 重扫', `${APP}/dashboard/clients/${ROMAN}/site-audit/pages`),
  // 📣 知会 6 条 + 🛠 系统欠账 2 条（当天在邮件里，但不计数）
  ...['oztop', 'NZCPE 2026', 'CTS Tours NZ', 'Roman HU', 'NM Medspa', 'East International'].map((n, i) =>
    mi('diagnostic_findings', `diag-${i}`, n, '本周体检查出严重问题', '不用你挑 —— 每周方案会自动排成看板动作', `${APP}/dashboard/clients/diag-${i}/execution`)),
  mi('cron_stuck', 'infra', 'Magic Engine 后台', '2 个自动任务开跑了但一直没结束', '回我一句「查一下卡死的那几个」', 'https://dashboard.render.com'),
  mi('cron_failing', 'infra', 'Magic Engine 后台', '4 个自动任务最近一次是报错结束的', '回我一句「查一下报错的那几个」', `${APP}/dashboard/admin/cron-health`),
]

const REAL_CUSTOMERS = ['客人 J', '客人 S', '客人 A', '客人 E', '客人 V']
const PITCHES = ['Afterpay Team', 'MyMotorland', 'Turisti in Puglia', 'Coder Nema']

const BEFORE_MANUAL: ManualItem[] = [
  ...SHARED,
  // 旧：NAL 的「要不要对生产库执行」没标类别
  mi('client_doc_manual_task', NAL, 'New Asian Logistics (NAL)', 'WhatsApp 接入卡在生产库还没加那一列 —— 要你拍板能不能执行', '确认可以就回 go apply', 'https://github.com/bigbigraydeng-maker/magic-engine/blob/main/supabase/migrations/20260902000002_whatsapp_phone_number_id.sql'),
  ...conversions(),
  // 旧：发布通道断了也叫「写好没人看」
  mi('blog_draft_waiting', OZ, 'oztop', '有 4 篇写好的文章没地方发 —— 发布通道是断的', '先去客户设置里把网站发布通道接通', `${APP}/dashboard/clients/${OZ}/settings`),
  // 旧：同一件串台两条
  mi('cross_client_leak', 'infra', 'CTS Tours NZ', '🔴 客户资料串台：CTS 名下存着 oztop 的网址', '进客户设置页核对这条配置', `${APP}/dashboard/clients`),
  mi('cross_client_leak', 'infra', 'CTS Tours NZ / oztop', '🔴 客户资料串台：CTS 和 oztop 的发布通道指向同一个网站', '进客户设置页核对这条配置', `${APP}/dashboard/clients`),
  // 旧：客人来信封顶 10 条（其中 4 封推销 + 1 封 ME 自测）+ 「还有 23 封」
  ...REAL_CUSTOMERS.map((n, i) => emailDue(`real-${i}`, n)),
  ...PITCHES.map((n, i) => emailDue(`pitch-${i}`, n)),
  emailDue('me-self', 'Big Ray Deng（ME 自测 [PREVIEW]）'),
  mi('email_reply_due', CTS, 'CTS Tours NZ', '这个客户还有 23 封客人来信没列出来', '进「全部客人」挨个看', `${APP}/dashboard/clients/${CTS}/crm/all`),
]

const AFTER_MANUAL: ManualItem[] = [
  ...SHARED,
  mi('client_doc_manual_task', NAL, 'New Asian Logistics (NAL)', 'WhatsApp 接入卡在生产库还没加那一列 —— 要你拍板能不能执行', '确认可以就回 go apply', 'https://github.com/bigbigraydeng-maker/magic-engine/blob/main/supabase/migrations/20260902000002_whatsapp_phone_number_id.sql', { pm_kind: 'decide' }),
  ...conversions(),
  mi('blog_publish_channel_broken', OZ, 'oztop', '有 4 篇写好的文章没地方发 —— 发布通道是断的', '先去客户设置里把网站发布通道接通', `${APP}/dashboard/clients/${OZ}/settings`),
  mi('cross_client_leak', 'infra', 'CTS Tours NZ / oztop', '🔴 客户资料串台：CTS 名下存着 oztop 的网址；CTS 和 oztop 的发布通道指向同一个网站', '进客户设置页核对这条配置', `${APP}/dashboard/clients`),
  ...REAL_CUSTOMERS.map((n, i) => emailDue(`real-${i}`, n)),
  ...Array.from({ length: 23 }, (_, i) => emailDue(`hidden-${i}`, `客人 H${i + 1}`)),
  mi('email_first_contact', CTS, 'CTS Tours NZ', `${PITCHES.length} 封陌生地址的来信超过 24 小时没回：${PITCHES.join('、')}。多半是推销`, '扫一眼主题：像真客人的回；推销的写一句「不是客人」', `${APP}/dashboard/clients/${CTS}/crm/all`),
]

const COMMON: Omit<TodoCounts, 'manualItems'> = {
  setupTasks: SETUP,
  draftsByClient: [
    { name: 'CTS Tours NZ', id: CTS, drafts: 2 },
    { name: 'oztop', id: OZ, drafts: 4 },
  ],
  findingsByClient: [
    { name: 'CTS Tours NZ', id: CTS, findings: 2 },
    { name: 'Magic Engine', id: ME_CLIENT, findings: 1 },
    { name: 'oztop', id: OZ, findings: 145 },
  ],
  recentCardsByClient: [
    { name: 'CTS Tours NZ', id: CTS, cards: 6 },
    { name: 'oztop', id: OZ, cards: 11 },
  ],
  reelsByClient: [
    { name: 'CTS Tours NZ', id: CTS, reels: 11 },
    { name: 'oztop', id: OZ, reels: 3 },
  ],
  cronFailures24h: 70,
}

export const BEFORE: TodoCounts = { ...COMMON, manualItems: BEFORE_MANUAL }
export const AFTER: TodoCounts = { ...COMMON, manualItems: AFTER_MANUAL }

/**
 * 旧 `buildTodoEmail` 的「今天有几件」口径，原样抄下来只为对账：
 * 连接 + 「需要你动手」栏条数 + 草稿篇数 + 建议卡张数 + 成片条数 + 24 小时失败次数。
 * （知会 prescription_updated / diagnostic_findings 和旧的系统欠账名单不计。）
 */
const OLD_UNCOUNTED = new Set<ManualItemKind>([
  'prescription_updated', 'diagnostic_findings',
  'auto_run_stuck', 'action_unattributable', 'attribution_audit_failed', 'client_list_unreadable', 'cron_blind',
  'cron_stuck', 'cron_failing', 'ai_alerting_broken', 'ai_gateway_broken', 'playbook_reference_stale',
  'platform_connection_pipeline_down', 'platform_connection_check_failed', 'platform_connection_not_enrolled',
  'platform_connection_no_reconnect_ui', 'platform_connection_orphan', 'maliang_check_unverifiable',
  'maliang_check_missing', 'libai_check_unverifiable', 'libai_check_missing', 'libai_prompt_library_stale',
  'simaqian_patrol_failed', 'meta_token_check_failed',
])

export function legacyTotal(c: TodoCounts): number {
  const sum = (xs: number[]) => xs.reduce((s, n) => s + n, 0)
  return (
    c.setupTasks.length +
    c.manualItems.filter((m) => !OLD_UNCOUNTED.has(m.kind)).length +
    sum(c.draftsByClient.map((x) => x.drafts)) +
    sum(c.recentCardsByClient.map((x) => x.cards)) +
    sum(c.reelsByClient.map((x) => x.reels)) +
    c.cronFailures24h
  )
}
