/**
 * 人工待办的**类型与通用工具**（从 manual-items.ts 拆出，Round 1）。
 *
 * 这里只放「不依赖任何具体数据源」的东西：类型、常量、链接闸、以及
 * 未收录页面的汇总构造。具体某条通道的取数逻辑留在各自的子模块里。
 */

import { verifyActionLink } from './action-link'
import { isHtmlPageUrl } from '@/lib/seo/url-kind'
import { classifyNotIndexed, THIN_WORD_COUNT_THRESHOLD } from '@/lib/seo/index-status'
import type { AttributionItemKind } from './attribution-items'
import type { ClientRosterItemKind } from './client-roster'
import type { DailyPlanMeasurementItemKind } from './daily-plan-measurement-items'
import type { EmailReplyItemKind } from './email-reply-items'
import type { BindingRequestItemKind } from './binding-request-items'
import type { PageBindingItemKind } from './page-binding-items'
import type { CommentScopeTodoKind } from './comment-scope-items'
import type { MetaTokenHealthKind } from './meta-token-health-items'
import type { LeadSheetItemKind } from './lead-sheet-items'
import type { PlatformConnectionItemKind } from './platform-connection-items'
import type { FacebookSyncItemKind } from './facebook-sync-items'
import type { AdsAutonomyItemKind } from './ads-autonomy-items'
import type { AdsRuleFindingItemKind } from './ads-rule-finding-items'
import type { MaliangItemKind } from './maliang-render-items'
import type { LibaiItemKind } from './libai-items'
import type { SimaqianItemKind } from './simaqian-review-items'

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
  'cross_client_leak',
  'facebook_page_binding_unverified',
  // facebook_sync_failing：Facebook 私信/留资同步连续失败 = 新客人进不了 CRM（2026-09-16 NAL 断了 9 天没人知道）。
  //   链接是需要登录的后台页，探活大概率判成坏链接 —— 宁可让人自己找入口，也不能让它静默消失。
  'facebook_sync_failing',
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
])

/** Meta queued this long without being applied = the applier is stuck. */
export const META_PENDING_STALE_DAYS = 3
/** Crawl data older than this = the weekly recrawl isn't landing. */
export const CRAWL_STALE_DAYS = 14

export type ManualItemKind =
  | 'blog_pr_open'
  | 'not_indexed'
  | 'meta_stuck'
  | 'crawl_stale'
  | 'video_credits_out'
  /** Creatomate 渲染失败或超时未完成（额度用完 / 渲染卡死超过 15+20 分钟兜底轮询）—— 见
   *  docs/specs/2026-09-09-creatomate-connector-spec-v1.md §4.4，旧管线的 reapStale() 已死，
   *  这条是它的替代 */
  | 'creatomate_render_failed'
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
  | 'goal_baseline_mismatch'
  | 'diagnostic_findings'
  | 'prescription_updated'
  | 'leads_metric_untrusted'
  | 'factory_worker_idle'
  | 'ad_readback_blocker'
  /** Mailchimp 出口 tally 里出现非预期失败（配置读不出来 / API key 失效 / 被限流 / provider 5xx） */
  | 'mailchimp_export_broken'
  | 'blog_draft_waiting'
  | 'cross_client_leak'
  | 'price_claim_unbacked'
  | 'auto_run_blocked'
  | 'auto_run_stuck'
  /** 被一句「不打算去」误判成永久拒联 —— 只有人能看一眼原话再决定 */
  | 'dnc_maybe_wrong'
  /** 客人在 Facebook 私信里像是说了「别再联系」，而判据从来读不到私信 —— 只提示，不自动封 */
  | 'dm_maybe_stop'
  /** 客人身上的「⭐重要标记」到期了 —— 员工手工设的"约好周三 3 点回电"这种事，到点该做了 */
  | 'crm_important_due'
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
  | CommentScopeTodoKind
  /** 写在 Render 里的 Meta 钥匙被 Meta 作废（错误码 190）—— 只有人能重新授权 */
  | MetaTokenHealthKind
  /** 上面那项检查自己没跑成 —— 不报 ≠ 钥匙都活着 */
  | 'meta_token_check_failed'
  /** 线索没写进客户的 Google 表格 —— 销售看的那张表缺人，留资 90 天后永久取不回 */
  | LeadSheetItemKind
  /** 执行内核停手 / 等审批 / 被规则挡下 —— 必须有人看见，不许死在日志里 */
  | 'kernel_needs_human'
  /** 自治开关同步到执行内核失败 —— 面板档位和内核实际档位可能不一致（WP3.1a） */
  | AdsAutonomyItemKind
  /** 每日广告巡检的广告级规则（D2 素材疲劳 / D10 点进去之后差了）：要人拍板改不改，系统不会自动改 */
  | AdsRuleFindingItemKind
  /** 有成交/咨询等着人核对要不要告诉广告平台 —— 撤不回，所以必须人点 */
  | 'conversion_needs_review'
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
  | 'linkedin_progress_needs_review'
  | 'linkedin_progress_needs_setup'
  | 'linkedin_progress_failed'
  | EmailReplyItemKind
  /** 客户在自助向导里交了广告账户号，只有内部员工能核实后接上（AD-SEC-3）*/
  | BindingRequestItemKind
  /** Facebook 主页绑定没核实：私信/线索/评论回复已暂停，或还在跑但没核实记录（AD-SEC-4）*/
  | PageBindingItemKind
  /** 排期发的 Facebook 帖子发出去了，但一直拿不到帖子编号 —— 成绩收不回来 */
  | DailyPlanMeasurementItemKind
  /** 私信客服健康心跳查出问题（issue #1587）：消息量骤降 / 验证器拦截率或出错率过高 / 退订登记写入失败 */
  | 'conversation_health_alert'
  /** 经验手册（Claude 持久记忆，不在仓库）里点名的函数/路径/表名疑似过期，每周巡检自动发现 */
  | 'playbook_reference_stale'
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

export async function dropBrokenLinks(
  items: ManualItem[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ kept: ManualItem[]; dropped: ManualItem[] }> {
  const verdicts = await Promise.all(
    items.map((it) => {
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
        return Promise.resolve({ kind: 'broken' as const, status: null })
      }
      // 🔴 **没有链接 ≠ 链接坏了。**
      //    有些待办本来就没有可点的地方（比如那件事的入口还没上线），
      //    它的价值全在 what / how 上。空 href 交给 verifyActionLink 会走
      //    `new URL('')` / `fetch('')` 抛错 → 判成 broken → 整条被丢掉，
      //    于是「如实告诉人这件事现在做不了」变成了「人什么都看不到」——
      //    发现死在 console.warn 里，正是铁律 3 下半句禁止的那件事。
      return it.href.trim() === ''
        ? Promise.resolve({ kind: 'unverifiable' as const })
        : verifyActionLink(it.href, fetchImpl).catch(() => ({ kind: 'unverifiable' as const }))
    }),
  )
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
}

/**
 * 谷歌没收录的页面 —— **一个客户汇总成一条，不是一页一条**。
 *
 * 🔴 实测 oztop 一家就 116 个未收录页面（PM 2026-09-04 fix闭环），一页一条会把
 * 今日待办正文淹掉 122 行 —— 跟 pushDiagnosticItems / pushLinkedinProgressItems
 * 早就立下的「别把待办刷屏」是同一条纪律，唯独这条线之前漏了。逐条的网址和单独
 * 深链没意义（谁也不会点 116 个链接），价值全在「哪个客户、几个、什么原因、去哪
 * 看全部」。三类页面处理方式不同（内容太薄 / 爬过没收录 / 谷歌还不认识），在 what
 * 里分别报数、在 how 里一句话说清，别让人以为一律去 GSC 点提交。
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
    { total: number; unknown: number; thin: number; declined: number; oldest: string | null }
  >()
  for (const row of rows) {
    // Assets (images/PDFs) are not pages — "not indexed as a page" is normal
    // for them and flagging it burns the whole list's credibility.
    if (!isHtmlPageUrl(row.url)) continue
    const cur = byClient.get(row.client_id) ?? {
      total: 0,
      unknown: 0,
      thin: 0,
      declined: 0,
      oldest: null as string | null,
    }
    cur.total += 1
    // 判据顺序与站点清单页共用同一份 classifyNotIndexed（seo/index-status）——
    // 「300 词」和 unknown 文案只此一处定义，两边永远同口径。
    cur[classifyNotIndexed(row)] += 1
    if (row.first_not_indexed_at && (!cur.oldest || row.first_not_indexed_at < cur.oldest)) {
      cur.oldest = row.first_not_indexed_at
    }
    byClient.set(row.client_id, cur)
  }

  const items: ManualItem[] = []
  for (const [clientId, agg] of Array.from(byClient.entries())) {
    // 未收录数据（first_not_indexed_at）只由每日收录轮检写入，而轮检只跑连了
    // GSC 的客户 —— 所以没连 GSC 的客户本就不会有未收录行。这道闸是双保险：
    // 而且「谷歌爬过没收录 / 还不认识」两类的处理动作仍要去 GSC 点「请求编入索引」，
    // 没连 GSC 这动作做不了，下发也白搭（与原逐页版一致，跳过不下发）。
    if (!siteUrlOf.get(clientId)) continue

    const parts = [
      agg.thin > 0 ? `${agg.thin} 个内容太薄` : null,
      agg.declined > 0 ? `${agg.declined} 个谷歌爬过却没收录` : null,
      agg.unknown > 0 ? `${agg.unknown} 个谷歌还不认识这网址` : null,
    ]
      .filter(Boolean)
      .join('、')
    const days = daysAgo(agg.oldest, now)
    const age = days !== null && days > 0 ? `，最久的已 ${days} 天` : ''
    items.push({
      kind: 'not_indexed',
      client_id: clientId,
      client_name: nameOf(clientId),
      what: `${agg.total} 个页面没被谷歌收录（${parts}）${age}，这些页面现在拿不到任何谷歌流量`,
      // 落到 ME 后台的站点页面清单（已带 ?filter=not-indexed 直达未收录）：每页都标了
      // 本地分类和该做什么。这解决 GSC「网页(Pages)」报告的两个盲区 —— 它不显示我们本地
      // 推导的「内容太薄」，「谷歌还不认识」的页面也可能压根不在它清单里（Codex #1375）。
      how: `打开这份站内清单（已只筛未收录），每页都标了原因和该做的动作：「内容太薄」的，去把正文补到 ${THIN_WORD_COUNT_THRESHOLD} 词以上、加内链；「爬过没收录 / 谷歌还不认识」的，去 Search Console 在最上方搜索框粘上这个网址、点「请求编入索引」。一次弄不完就先挑最想被搜到的几页`,
      // app.magicengine.com.au 是登录类站点，链接闸判 unverifiable 会保留（见 action-link）。
      href: `https://app.magicengine.com.au/dashboard/clients/${clientId}/site-audit/pages?filter=not-indexed`,
    })
  }
  return items
}
