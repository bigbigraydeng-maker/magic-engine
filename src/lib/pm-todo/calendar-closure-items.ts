/**
 * 今日待办里的「日历到期事项巡检」栏。
 *
 * 日历上带日期的验证事项（`calendar_closure/audit.due`）每天由
 * `calendar-closure-audit` 定时任务核对一遍，回执写进 `cron_run_logs.summary`。
 * 这里把回执翻成 PM 能直接动手的待办 —— 读不到日历、巡检自己没跑成、
 * 到期事项没法自动核对、自动核对没达预期/没查成/只证明了一部分、
 * 以及一堆没有 ledger-id 没法闭环的事项。
 *
 * 铁律 3 下半：发现不许死在日志里。巡检自己没跑成、日历读不出来，
 * 都必须单独出一条待办 —— 这一栏空着不等于没事。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualItem } from './manual-item-types'
import { LEDGER_ENTRY_URL } from './ledger-items'
import { streakPhrase } from './remind-cadence'
import {
  CALENDAR_CLOSURE_JOB,
  type AuditReceipt,
  type EventResult,
} from '@/lib/calendar-closure/types'

export type CalendarClosureItemKind =
  | 'calendar_closure_calendar_unreadable'
  | 'calendar_closure_check_failed'
  | 'calendar_closure_needs_human'
  | 'calendar_closure_probe_failed'
  | 'calendar_closure_probe_passed'
  | 'calendar_closure_no_ledger'
  /** 每天一行汇总：日历上到期没闭环的件数（不逐条塞满邮件） */
  | 'calendar_closure_overdue_summary'

/** 与 types.ts 里的 CALENDAR_CLOSURE_JOB 是同一个值，这里只做再导出。 */
export const CALENDAR_CLOSURE_JOB_NAME = CALENDAR_CLOSURE_JOB

const INFRA_CLIENT_ID = 'infra'
const INFRA_CLIENT_NAME = 'Magic Engine 平台治理'

const CALENDAR_CONSOLE_URL = 'https://console.cloud.google.com/iam-admin/serviceaccounts'
const CALENDAR_SETTINGS_URL = 'https://calendar.google.com/calendar/u/0/r/settings'
const CALENDAR_FALLBACK_URL = 'https://calendar.google.com/calendar'
const INNGEST_URL = 'https://app.inngest.com'
const DEV_DEBT_URL = 'https://app.magicengine.com.au/dashboard/admin/cron-health#dev-debt'

/** 巡检超过这么久没跑，就当它没在跑。 */
const STALE_MS = 36 * 60 * 60 * 1000
/** 停在 running 超过这么久就当卡死。 */
const RUNNING_STUCK_MS = 2 * 60 * 60 * 1000
/** 回看多久的运行记录。 */
const LOOKBACK_MS = 3 * 24 * 60 * 60 * 1000

function infraItem(
  kind: CalendarClosureItemKind,
  what: string,
  how: string,
  href: string,
): ManualItem {
  return {
    kind,
    client_id: INFRA_CLIENT_ID,
    client_name: INFRA_CLIENT_NAME,
    what,
    how,
    href,
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** 日历标题进待办前去掉换行/控制字符：标题不可信，待办文字常被直接贴进别的窗口。 */
function cleanTitle(s: string, max: number): string {
  return truncate(s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').trim(), max)
}

function ledgerHref(ledgerId: string | null, htmlLink: string): string {
  return ledgerId ? `${LEDGER_ENTRY_URL}${ledgerId}.md` : htmlLink || CALENDAR_FALLBACK_URL
}

/** 读不到日历时，要人做的事。三步都要具体到能照着点。 */
function calendarUnreadableHow(error: string | null): string {
  return (
    `今天读不到日历（${error ?? '没留原因'}）——日历上所有带日期的验证事项现在没人查。` +
    '按顺序做这三步：' +
    `1) 打开 ${CALENDAR_CONSOLE_URL} 确认读日历用的机器账号还在、没被停用，密钥没被删；` +
    `2) 打开 ${CALENDAR_SETTINGS_URL} 找到 hello@magicengine.cloud 这个日历 → 「与特定用户共享」→ ` +
    '确认机器账号邮箱还在名单里，权限是「查看所有活动详情」；' +
    '3) 密钥要换的话把新密钥整段粘进 Render 后台 crazycontent 服务 Environment 里的 ' +
    'GOOGLE_SERVICE_ACCOUNT_CREDENTIALS，保存时选带 deploy 的选项。改完明天自动重试。'
  )
}

/** 从回执生成待办。回执本身已经过运行时校验。 */
export function buildCalendarClosureItems(receipt: AuditReceipt, now: Date): ManualItem[] {
  const items: ManualItem[] = []

  if (receipt.status === 'calendar_unreadable') {
    items.push(
      infraItem(
        'calendar_closure_calendar_unreadable',
        `今天读不到日历（${receipt.error ?? '没留原因'}）——日历上所有带日期的验证事项现在没人查。`,
        calendarUnreadableHow(receipt.error),
        CALENDAR_CONSOLE_URL,
      ),
    )
    return items
  }

  if (receipt.status === 'ledger_unreadable') {
    items.push(
      infraItem(
        'calendar_closure_check_failed',
        `日历到期事项巡检读不出台账（${receipt.error ?? '没留原因'}）——这一栏空着不等于没事。`,
        '找任何一个 Claude Code 窗口说「修台账」。',
        LEDGER_ENTRY_URL,
      ),
    )
    return items
  }

  const noLedger: EventResult[] = []

  for (const result of receipt.results) {
    if (result.kind === 'closed' || result.kind === 'covered') continue

    // 到期没验的事项每天都报（到期 14 天窗口内）：它不是"同一故障连续出现"，不能套降噪节奏，
    // 否则逾期第 5 天起一周只响一次（魏征 2026-10-08 复审）。无编号事项已汇总成一条，不会刷屏。
    const streak = result.overdueDays + 1

    const title = cleanTitle(result.title, 80)
    const href = ledgerHref(result.ledgerId, result.htmlLink)

    switch (result.kind) {
      case 'needs_human':
        items.push(
          infraItem(
            'calendar_closure_needs_human',
            `「${title}」到期${streakPhrase(streak)}了，没有自动核对，没人验过。`,
            `找任何一个 Claude Code 窗口说「台账 ${result.ledgerId ?? ''} 验一下」，` +
              '让它照卡里写的验证办法查完，把结果记进台账。',
            href,
          ),
        )
        break
      case 'not_yet':
        items.push(
          infraItem(
            'calendar_closure_needs_human',
            `「${title}」自动核对说还验不了：${result.fact ?? '没留事实'}。`,
            `找任何一个 Claude Code 窗口说「台账 ${result.ledgerId ?? ''} 验一下」，` +
              '让它照卡里写的验证办法查完，把结果记进台账。',
            href,
          ),
        )
        break
      case 'probe_unreadable':
        items.push(
          infraItem(
            'calendar_closure_needs_human',
            `「${title}」自动核对没查成（不是通过）：${result.fact ?? '没留事实'}。`,
            `找任何一个 Claude Code 窗口说「台账 ${result.ledgerId ?? ''} 验一下」，` +
              '让它照卡里写的验证办法查完，把结果记进台账。',
            href,
          ),
        )
        break
      case 'probe_failed':
        items.push(
          infraItem(
            'calendar_closure_probe_failed',
            `「${title}」自动核对没达预期：${result.fact ?? '没留事实'}。`,
            `找任何一个 Claude Code 窗口说「台账 ${result.ledgerId ?? ''} 重做」，` +
              '或自己判断要不要接着等 / 关闭这张卡。',
            href,
          ),
        )
        break
      case 'probe_passed':
        items.push(
          infraItem(
            'calendar_closure_probe_passed',
            `「${title}」自动核对通过，但只证明了其中一部分：${result.fact ?? '没留事实'}。`,
            `找任何一个 Claude Code 窗口确认其余成功条件都满足后，把台账卡 ${result.ledgerId ?? ''} 改成 verified。`,
            href,
          ),
        )
        break
      case 'no_ledger':
        noLedger.push(result)
        break
    }
  }

  if (noLedger.length > 0) {
    const n = noLedger.length
    const titles = noLedger.slice(0, 5).map((r) => cleanTitle(r.title, 80))
    const suffix = n > 5 ? ` 等共 ${n} 个` : ''
    items.push(
      infraItem(
        'calendar_closure_no_ledger',
        `${n} 个日历事项没法自动闭环（没有可用的 ledger-id 或台账里没这张卡）：` +
          `${titles.join('、')}${suffix}。`,
        '在事件描述第一行补上 ledger-id: <台账卡 id>，再加一行 verify_how 摘要；' +
          '或让窗口补建台账卡。',
        noLedger[0].htmlLink || CALENDAR_FALLBACK_URL,
      ),
    )
  }

  // 每天一行汇总：到期没闭环的件数。逐条清单在「开发欠账」页，不塞满邮件。
  const open = receipt.results.filter((r) => r.kind !== 'closed' && r.kind !== 'covered')
  const stale = typeof receipt.stale_open === 'number' ? receipt.stale_open : 0
  if (open.length > 0 || stale > 0) {
    const old = open.filter((r) => r.overdueDays >= 3).length
    const staleText = stale > 0 ? `；另有 ${stale} 件超过 14 天的旧事项，不再逐条提醒` : ''
    items.push(
      infraItem(
        'calendar_closure_overdue_summary',
        `日历上有 ${open.length} 件到期还没闭环的验证事项（其中 ${old} 件已超过 2 天）${staleText}。`,
        '打开开发欠账清单看逐条明细；核完一件，就在日历事件标题前加 ✅（或写「作废」），它明天就不会再出现。',
        DEV_DEBT_URL,
      ),
    )
  }

  return items
}

/** 回执在 `cron_run_logs.summary` 里的形状（只取我们要用的那几项）。 */
interface RunRow {
  job_name: string
  status: string | null
  started_at: string
  finished_at: string | null
  error_message: string | null
  summary: unknown
}

/** 运行时校验：summary 必须是个带 status 字符串和 results 数组的对象。 */
function isAuditReceiptLike(value: unknown): value is AuditReceipt {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  if (typeof v.status !== 'string') return false
  if (!Array.isArray(v.results)) return false
  for (const r of v.results) {
    if (typeof r !== 'object' || r === null) return false
    const e = r as Record<string, unknown>
    if (typeof e.kind !== 'string') return false
    if (typeof e.title !== 'string') return false
    if (typeof e.overdueDays !== 'number') return false
    if (typeof e.htmlLink !== 'string') return false
  }
  return true
}

function checkFailedItem(what: string, how: string): ManualItem {
  return infraItem('calendar_closure_check_failed', what, how, INNGEST_URL)
}

/** 从最近几轮运行记录生成待办。读失败也要出一条「检查没跑成」，不能静默。 */
export async function pushCalendarClosureItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  now: Date = new Date(),
): Promise<void> {
  let rows: RunRow[]
  try {
    const { data, error } = await supabase
      .from('cron_run_logs')
      .select('job_name, status, started_at, finished_at, error_message, summary')
      .eq('job_name', CALENDAR_CLOSURE_JOB)
      .gte('started_at', new Date(now.getTime() - LOOKBACK_MS).toISOString())
      .order('started_at', { ascending: false })
      .limit(3)
    if (error) throw new Error(error.message)
    rows = (data ?? []) as RunRow[]
  } catch (err) {
    items.push(
      checkFailedItem(
        `查不到「日历到期事项巡检」最近跑得怎么样（${err instanceof Error ? err.message : String(err)}），` +
          '所以现在没法确认日历上的到期事项有没有人查。',
        '把这句话发到开发窗口；在那之前先自己打开日历，看今天到期的验证事项有没有人跟。',
      ),
    )
    return
  }

  if (rows.length === 0) {
    items.push(
      checkFailedItem(
        '「日历到期事项巡检」三天内没有任何运行记录——没人在查日历上的到期事项。',
        '多半是定时函数没同步到 Inngest 后台：打开 https://app.inngest.com 对 /api/inngest 手动 Sync 一次；' +
          '也可能是日历授权问题。自己搞不定就把这句话发到开发窗口。',
      ),
    )
    return
  }

  const latest = rows[0]

  if (latest.status === 'running') {
    // 跑了 2 小时还停在 running = 进程中途被杀、onFailure 也没收口；不能静默
    if (now.getTime() - Date.parse(latest.started_at) <= RUNNING_STUCK_MS) return
    items.push(
      checkFailedItem(
        '「日历到期事项巡检」最近一轮开了头却超过 2 小时没收尾——多半是中途被中断了。',
        '把这句话发到开发窗口；在那之前先自己打开日历，看今天到期的验证事项有没有人跟。',
      ),
    )
    return
  }

  if (latest.status === 'failed' || latest.error_message) {
    const reason = truncate(latest.error_message ?? '没留原因', 160)
    items.push(
      checkFailedItem(
        `「日历到期事项巡检」最近一轮没跑成：${reason}。`,
        '把这句话发到开发窗口；在那之前先自己打开日历，看今天到期的验证事项有没有人跟。',
      ),
    )
    return
  }

  const startedAt = new Date(latest.started_at).getTime()
  if (Number.isFinite(startedAt) && now.getTime() - startedAt > STALE_MS) {
    items.push(
      checkFailedItem(
        '「日历到期事项巡检」超过一天没跑了——日历上的到期事项现在没人查。',
        '多半是定时函数没同步到 Inngest 后台：打开 https://app.inngest.com 对 /api/inngest 手动 Sync 一次；' +
          '也可能是日历授权问题。自己搞不定就把这句话发到开发窗口。',
      ),
    )
    return
  }

  if (!isAuditReceiptLike(latest.summary)) {
    items.push(
      checkFailedItem(
        '「日历到期事项巡检」最近一轮的回执读不出来（格式不对）——这一栏空着不等于没事。',
        '把这句话发到开发窗口。',
      ),
    )
    return
  }

  items.push(...buildCalendarClosureItems(latest.summary, now))
}
