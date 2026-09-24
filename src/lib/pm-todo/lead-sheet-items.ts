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
  | 'lead_sheet_value_unmapped'
  /** 有线索因为拼不出身份没写进表 —— 这些人是真的没到销售手里 */
  | 'lead_sheet_lead_skipped'

/** 回执在 `cron_run_logs.summary` 里的形状（只取我们要用的那几项）。 */
interface RouteReceiptLike {
  routeKey?: string
  spreadsheetId?: string
  tabName?: string
  appended?: number
  unmappedValues?: string[]
  skippedNoIdentity?: number
  skippedLeadIds?: string[]
  error?: string | null
}

interface ClientReceiptLike {
  clientId?: string
  clientName?: string | null
  routes?: RouteReceiptLike[]
  error?: string | null
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

/** 授权不够（Google 判 403）时，要人做的事跟「表格没权限」完全不同，得分开说。 */
function howFor(clientId: string, error: string): string {
  if (/\b403\b|insufficient|PERMISSION_DENIED|没有可用的 Google 连接/.test(error)) {
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
      kind: 'lead_sheet_sync_failed',
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
        kind: 'lead_sheet_sync_failed',
        client_name: clientName,
        client_id: clientId,
        what: `${clientName} 的线索这轮没能写进 Google 表格：${client.error}。销售看的那张表现在是缺的，新留资的人没人跟。`,
        how: howFor(clientId, client.error),
        href: sheetHref(undefined),
      })
    }

    for (const route of client.routes ?? []) {
      if (route.error) {
        items.push({
          kind: 'lead_sheet_sync_failed',
          client_name: clientName,
          client_id: clientId,
          what: `${clientName} 的线索写不进「${route.tabName ?? route.routeKey ?? '目标表格'}」：${route.error}。这张表上的新线索现在是缺的。`,
          how: howFor(clientId, route.error),
          href: sheetHref(route.spreadsheetId),
        })
      }

      /**
       * 🔴 被跳过的线索必须单独下发。
       *
       * 它们既不算写成功、也不算「表里已经有了」——**是真的没进销售手里**。
       * 而这条路径上 `error` 是 null、定时任务记的是 completed、日报是绿的，
       * 不在这里喊一声就没有任何地方会喊。
       */
      const skipped = route.skippedNoIdentity ?? 0
      if (skipped > 0) {
        const ids = (route.skippedLeadIds ?? []).slice(0, 5)
        items.push({
          kind: 'lead_sheet_lead_skipped',
          client_name: clientName,
          client_id: clientId,
          what:
            `${clientName} 有 ${skipped} 条线索没写进「${route.tabName ?? route.routeKey ?? '目标表格'}」——` +
            '这些人连姓名电话邮箱都没拿到，表里认不出是谁，所以没敢往里写。' +
            '他们**没有**到销售手上。',
          how:
            '这多半是 Facebook 那条线索本身就没留下联系方式。' +
            `去 Meta 后台按线索编号查原始提交${ids.length ? `（${ids.join('、')}${skipped > ids.length ? ' 等' : ''}）` : ''}，` +
            '有电话或邮箱就手工补进表格；确实什么都没有就不用管，不是系统坏了。',
          href: sheetHref(route.spreadsheetId),
        })
      }

      const unmapped = route.unmappedValues ?? []
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
          href: sheetHref(route.spreadsheetId),
        })
      }
    }
  }
}
