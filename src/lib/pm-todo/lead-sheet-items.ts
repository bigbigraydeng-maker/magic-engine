/**
 * 「线索没进客户的 Google 表格」→ 下发到「需要你动手」（铁律 3 下半）。
 *
 * 这条通道存在的理由很具体：线索进不了销售手上 = 留了电话没人跟 = 直接丢单，
 * 而 Facebook 只保留 90 天留资，超期永久取不回。这种事**绝不能**只躺在
 * 运行记录的 error 字段里 —— 那正是私信简报停产三天没人知道的原因
 * （2026-09-23 事故，记忆 feedback-monitoring-writer-silent-failure-inverts-health-check）。
 *
 * 本文件一行写操作都没有：只读回执、生成待办。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-items'
import { APP_BASE } from './binding-request-items'

export type LeadSheetItemKind =
  | 'lead_sheet_sync_failed'
  /** 写表被 Google 判 403 —— 授权不够，要人重新走一次「连接 Google」（跟上一条的开发活分开） */
  | 'lead_sheet_reauth_needed'
  /** 「线索同步到表格」的运行记录整个读不出来 —— 这项检查今天没跑成 */
  | 'lead_sheet_check_failed'
  | 'lead_sheet_value_unmapped'
  /** 有线索因为拼不出身份没写进表 —— 这些人是真的没到销售手里 */
  | 'lead_sheet_lead_skipped'
  /** 还有历史线索落在补档窗口之外，一直没进表 */
  | 'lead_sheet_backfill_pending'
  /** 有线索一条路线都没匹配上 —— 配置缺兜底路线 */
  | 'lead_sheet_unrouted'
  /**
   * `countLeadsBefore` 数「窗口外还剩多少条」失败了（不是写表失败，新线索这轮照常写进去了）。
   * 光靠 `receipt.warning` 没人读——不接进待办的话，`lead_sheet_backfill_pending`
   * 会一直显示 0，看起来像「历史全补完了」，其实只是这轮没数出来。
   */
  | 'lead_sheet_backfill_count_unreliable'

/** 回执在 `cron_run_logs.summary` 里的形状（只取我们要用的那几项）。 */
interface RouteReceiptLike {
  routeKey?: string
  /** 路线的人话名字。没有就退回 tabName / routeKey —— 老回执里没有这一项。 */
  label?: string | null
  spreadsheetId?: string
  tabName?: string
  appended?: number
  unmappedValues?: string[]
  skippedNoIdentity?: number
  skippedLeadIds?: string[]
  /** 落在 backfill_since 之前、这轮没碰的条数。 */
  outsideWindow?: number
  error?: string | null
}

interface ClientReceiptLike {
  clientId?: string
  clientName?: string | null
  routes?: RouteReceiptLike[]
  /** 一条路线都没匹配上的线索数。 */
  unrouted?: number
  error?: string | null
  /** 不影响本轮写入的次要问题（目前只有「数窗口外线索失败」这一种）。 */
  warning?: string | null
}

interface RunRow {
  job_name: string
  status: string | null
  started_at: string
  summary: unknown
}

export const LEAD_SHEET_JOB = 'lead-sheet-sync'

/** 回看多久。任务每小时跑一次，2 小时够覆盖每个客户最近一轮。 */
const LOOKBACK_MS = 2 * 60 * 60 * 1000

function sheetHref(spreadsheetId: string | undefined): string {
  return spreadsheetId
    ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
    : `${APP_BASE}/dashboard`
}

/** Google 判 403 / 没有可用连接 = 授权不够，要人重新点一次同意页（不是开发的活）。 */
function isReauthError(error: string): boolean {
  return /\b403\b|insufficient|PERMISSION_DENIED|没有可用的 Google 连接/.test(error)
}

/** 授权不够（Google 判 403）时，要人做的事跟「表格没权限」完全不同，得分开说。 */
function howFor(clientId: string, error: string): string {
  if (isReauthError(error)) {
    return (
      '这是授权不够，不是表格坏了：ME 以前只要到了「看表格」的权限，写表格要重新授权一次。' +
      `点链接走一遍「连接 Google」（${APP_BASE}/api/auth/google/connect?client_id=${encodeURIComponent(clientId)}&flow=admin），` +
      '在 Google 的同意页面上会多出一条「查看、修改 Google 表格」，勾上再确认。授权完这条任务下一轮自己会追上，不用补跑。'
    )
  }
  return (
    '点链接打开那张表确认还在、没被改名或移走，用的 Google 账号对这张表有编辑权限；' +
    '表没问题的话把这条错误原话发到开发窗口。线索本身没丢，还在 CRM 里 —— 只是没写进表格。'
  )
}

/** 从最近一轮运行记录生成待办。读失败也要出一条「检查没跑成」，不能静默。 */
export async function pushLeadSheetItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date = new Date(),
): Promise<void> {
  let latest: ClientReceiptLike[]
  try {
    /**
     * 🔴 **按客户各取最新一条，不是全局只取最新一条。**
     *
     * 这条任务是 fan-out：**每个客户各写一行** `cron_run_logs`。全局
     * `.limit(1)` 在只有一个客户时看着没问题，接进第二个客户的那一刻就变成
     * 「每小时 N 行里只看见其中一个」—— 其余客户的写表失败和未映射选项
     * **永远不下发**。而这条通道存在的唯一理由就是不让这些事死在日志里。
     *
     * 回看 2 小时：这条任务每小时跑一次，2 小时足够覆盖到每个客户最近一轮，
     * 又不会把昨天已经好了的问题重新摆到人面前。
     */
    const { data, error } = await supabase
      .from('cron_run_logs')
      .select('job_name, status, started_at, summary')
      .eq('job_name', LEAD_SHEET_JOB)
      .gte('started_at', new Date(now.getTime() - LOOKBACK_MS).toISOString())
      .order('started_at', { ascending: false })
    if (error) throw new Error(error.message)

    // 已按时间倒序，每个客户第一次见到的就是它最近那一轮。
    const newestPerClient = new Map<string, ClientReceiptLike>()
    for (const run of (data ?? []) as RunRow[]) {
      const summary = run.summary as { results?: ClientReceiptLike[] } | null
      for (const client of summary?.results ?? []) {
        const key = client.clientId ?? ''
        if (!newestPerClient.has(key)) newestPerClient.set(key, client)
      }
    }
    latest = [...newestPerClient.values()]
  } catch (err) {
    items.push({
      kind: 'lead_sheet_check_failed',
      client_name: '全系统',
      client_id: '',
      what: `查不到「线索同步到表格」最近跑得怎么样（${err instanceof Error ? err.message : String(err)}），所以现在没法确认线索有没有进客户的表。`,
      how: '把这句话发到开发窗口；在那之前先自己打开客户那张表，看今天的线索在不在。',
      href: `${APP_BASE}/dashboard`,
    })
    return
  }

  for (const client of latest) {
    const clientId = client.clientId ?? ''
    const clientName = client.clientName ?? clientId

    if (client.error) {
      items.push({
        // 授权不够的那种只有人能点同意页；其余的要开发先查（today 待办按 kind 分车道）
        kind: isReauthError(client.error) ? 'lead_sheet_reauth_needed' : 'lead_sheet_sync_failed',
        client_name: clientName,
        client_id: clientId,
        what: `${clientName} 的线索这轮没能写进 Google 表格：${client.error}。销售看的那张表现在是缺的，新留资的人没人跟。`,
        how: howFor(clientId, client.error),
        href: sheetHref(undefined),
      })
    }

    /**
     * 🔴 **这是 warning，不能跟 `lead_sheet_sync_failed` 合并下发。**
     *
     * 新线索这轮照常写进表了，坏的只是「窗口外还剩多少条没补」这一个数字——
     * 按 `client.error` 那条的措辞喊「没能写进表格」是误报。但也不能什么都不做：
     * `countLeadsBefore` 一直坏下去，`lead_sheet_backfill_pending` 会一直显示 0，
     * 看起来像「历史全补完了」，没人会去查其实是数不出来。
     */
    if (client.warning) {
      items.push({
        kind: 'lead_sheet_backfill_count_unreliable',
        client_name: clientName,
        client_id: clientId,
        what:
          `${clientName} 的线索这轮正常写进了 Google 表格，但「还有多少条历史没补」这个数字这轮没数出来：` +
          `${client.warning}。不影响新线索，只是这个数字这轮不准，可能一直卡在坏之前的旧值。`,
        how: '把这句话发到开发窗口；在修好之前，「还有历史没补」那条待办里的数字先别当真。',
        href: sheetHref(undefined),
      })
    }

    /**
     * 🔴 一条路线都没匹配上的线索 = 配置缺兜底路线，这些人一行都没写进任何表。
     *    这个数字原先也只在运行记录里躺着，没有任何读者。
     */
    const unrouted = client.unrouted ?? 0
    if (unrouted > 0) {
      items.push({
        kind: 'lead_sheet_unrouted',
        client_name: clientName,
        client_id: clientId,
        what:
          `${clientName} 有 ${unrouted} 条线索没写进任何表格 —— 它们来自的表单不符合` +
          '现有的任何一条归类规则，而且没有配「其余都走这里」的兜底规则。这些人没到销售手上。',
        how:
          '把这句话发到开发窗口，给这个客户补一条兜底规则就行（一次配置，以后自动）。' +
          '线索本身没丢，还在系统里 —— 补完下一轮会自己写进去。',
        href: sheetHref(undefined),
      })
    }

    /**
     * 🔴 **按「目标表格」汇总下发，不按路线。**
     *
     * PM 2026-09-24 拍板所有表单汇总进一张表之后，几条路线指向同一张表是常态。
     * 逐路线下发的话，读表失败会让 PM 在待办里看见**一模一样的一句话两遍**，
     * 而要做的事只有一件（重新授权 / 看一眼那张表）。重复的待办不是多提醒一次，
     * 是让人开始跳着看待办 —— 这条通道就白建了。
     */
    const buckets = new Map<
      string,
      {
        spreadsheetId: string | undefined
        where: string
        errors: Set<string>
        skipped: number
        skippedIds: string[]
        outsideWindow: number
        unmapped: Set<string>
      }
    >()

    for (const route of client.routes ?? []) {
      /**
       * 🔴 桶键必须是「真正写去哪张表」（spreadsheetId + tabName），不能是展示用的
       *    `label`——同一张表配了两条路线、标签分别是「问了预算…」和「其余表单…」
       *    时，按 label 分桶会把同一张表的读表失败拆成两条一模一样的待办，
       *    跳过数和未映射值也按标签各算各的，白白违背「按表汇总，不按路线」的初衷。
       */
      const key = `${route.spreadsheetId ?? ''}\u0000${route.tabName ?? route.routeKey ?? ''}`
      /**
       * 🔴 展示名字才优先用人话。汇总进一张表之后 `tabName` 就是 `Untitled`，
       *    待办里写「线索写不进『Untitled』」= PM 还得再问一遍是哪张表。
       *    `label` 是老回执里没有的字段，所以留着两层退路。第一条路线的名字
       *    赢——同一张表上标签不同也只需要说清「是哪张表」，不需要逐条都对。
       */
      const where = route.label ?? route.tabName ?? route.routeKey ?? '目标表格'
      let b = buckets.get(key)
      if (!b) {
        b = {
          spreadsheetId: route.spreadsheetId,
          where,
          errors: new Set(),
          skipped: 0,
          skippedIds: [],
          outsideWindow: 0,
          unmapped: new Set(),
        }
        buckets.set(key, b)
      }
      // 同一张表上两条路线报同一句错只说一遍；报的错不一样就各说各的。
      if (route.error) b.errors.add(route.error)
      b.skipped += route.skippedNoIdentity ?? 0
      b.skippedIds.push(...(route.skippedLeadIds ?? []))
      b.outsideWindow += route.outsideWindow ?? 0
      for (const v of route.unmappedValues ?? []) b.unmapped.add(v)
    }

    for (const b of buckets.values()) {
      for (const err of b.errors) {
        items.push({
          kind: isReauthError(err) ? 'lead_sheet_reauth_needed' : 'lead_sheet_sync_failed',
          client_name: clientName,
          client_id: clientId,
          what: `${clientName} 的线索写不进「${b.where}」：${err}。这张表上的新线索现在是缺的。`,
          how: howFor(clientId, err),
          href: sheetHref(b.spreadsheetId),
        })
      }

      /**
       * 🔴 被跳过的线索必须单独下发。
       *
       * 它们既不算写成功、也不算「表里已经有了」——**是真的没进销售手里**。
       * 而这条路径上 `error` 是 null、定时任务记的是 completed、日报是绿的，
       * 不在这里喊一声就没有任何地方会喊。
       */
      if (b.skipped > 0) {
        const ids = b.skippedIds.slice(0, 5)
        items.push({
          kind: 'lead_sheet_lead_skipped',
          client_name: clientName,
          client_id: clientId,
          what:
            `${clientName} 有 ${b.skipped} 条线索没写进「${b.where}」——` +
            '这些人连姓名电话邮箱都没拿到，表里认不出是谁，所以没敢往里写。' +
            '他们**没有**到销售手上。',
          how:
            '这多半是 Facebook 那条线索本身就没留下联系方式。' +
            `去 Meta 后台按线索编号查原始提交${ids.length ? `（${ids.join('、')}${b.skipped > ids.length ? ' 等' : ''}）` : ''}，` +
            '有电话或邮箱就手工补进表格；确实什么都没有就不用管，不是系统坏了。',
          href: sheetHref(b.spreadsheetId),
        })
      }

      /**
       * 🔴 「还有历史没比对过」必须能被人看见。
       *
       * `outsideWindow` 每一轮都在算，写进运行记录，**但在这之前没有任何读者** ——
       * 几百条历史线索每小时被数一遍、数字一直涨，而 PM 那边什么都看不到。
       * 这正是「发现死在日志里」（铁律 3 下半）。这条待办会一直在，直到补档窗口
       * 往前调完为止 —— 它本来就是一件没做完的事，本来就该一直在。
       *
       * 🔴 **措辞不能说成「这些人没进表」**。补档窗口之外的线索，ME 这一轮压根没读
       *    它们、也就没拿它们去跟表格比对过：目标表格如果本来就有别的管道在写
       *    （CTS 就是这样，客户账号里的 Zapier/Make 每天往同一张表里进 7–16 行），
       *    这些人**多半早就在表里**。断言「销售看不到」= 每天报一次假警，而假警
       *    的代价是人开始跳着看待办，这条通道就白建了。只说我们真的知道的：
       *    「没去核对过」。
       */
      if (b.outsideWindow > 0) {
        items.push({
          kind: 'lead_sheet_backfill_pending',
          client_name: clientName,
          client_id: clientId,
          what:
            `${clientName} 有 ${b.outsideWindow} 条更早的线索落在「${b.where}」的补档窗口之外，` +
            'ME 这一轮没有拿它们跟表格核对过。它们可能早就在表里（别的管道写进去的），' +
            '也可能确实没进去 —— 只看这个数字分不出来。',
          how:
            '这是有意卡住的，不是坏了：一次全倒进去有可能把人正在用的表冲烂。' +
            '想知道到底缺不缺，跟开发窗口说一声跑一次试算（只读不写，会原样列出「会写哪几行」）；' +
            '确认安全再把补档日期往前挪一点，挪完看一眼表再挪下一段。',
          href: sheetHref(b.spreadsheetId),
        })
      }

      const unmapped = [...b.unmapped].sort()
      if (unmapped.length > 0) {
        items.push({
          kind: 'lead_sheet_value_unmapped',
          client_name: clientName,
          client_id: clientId,
          what:
            `${clientName} 的表单多了没见过的选项，表格里这几格写的是英文原文不是中文：` +
            `${unmapped.slice(0, 6).join('、')}${unmapped.length > 6 ? ` 等 ${unmapped.length} 个` : ''}。` +
            '线索本身没丢，只是看起来别扭。',
          how:
            '这是表单改版后的正常现象。把这几个英文值和它们对应的中文短语发到开发窗口，' +
            '加进这个客户的选项对照表就行（一次配置，以后自动）。急的话销售照英文也看得懂。',
          href: sheetHref(b.spreadsheetId),
        })
      }
    }
  }
}
