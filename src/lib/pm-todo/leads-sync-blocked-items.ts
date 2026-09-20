/**
 * 「这个客户的 Facebook 线索同步卡在授权上」→ 下发到「需要你动手」。
 *
 * 🔴 为什么必须有这条通道（2026-09-20 实测，生产库 glbdnayojixmexgofbsd）：
 *    `meta-leads-sync` 每 2 小时一跑，26 小时里跑了 13 次、13 次全部 failed，
 *    每次都是同一句「3/5 个客户取不到线索」。三家的病因分别是 Magic Lab Class /
 *    New Asian Logistics 的主页令牌被 Meta 拒了（Graph #190）、NZCPE 2026 的
 *    主页绑定没核实 —— 全都只有人动手才会好。
 *
 *    于是这条任务永远是红的：正常的 2 家（含 CTS Tours NZ）哪天真断供，
 *    日检和任何按 status 报警的东西都看不出区别。修法有两半，缺一不可：
 *      · 上半 —— 整轮 status 不再被单个客户的授权缺口染红（route.ts）；
 *      · 下半 —— 这些客户必须换一条人看得见的管道下发，**不许只剩日志**
 *        （铁律 3 下半：管道不许断头）。这个文件就是下半。
 *
 * 判据取自 cron 自己写进运行记录的那份 summary（跟 `comment_scope_missing`
 * 同一个套路）：说的话跟机器真做的事永远一致，也不用再查一遍 Meta。
 *
 * **主页绑定没核实那一类不在这里下发** —— `page-binding-items.ts` 已经在管，
 * 而且它扫的是所有绑了主页的客户、不依赖 cron 跑没跑，覆盖更全。这里重复一遍
 * 只会让同一件事在待办里出现两次。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { LeadsSyncBlocker } from '@/lib/meta/leads-sync-blocker'
import { APP_BASE } from './binding-request-items'

export type LeadsSyncBlockedItemKind = 'leads_sync_authorization_blocked'

const KIND: LeadsSyncBlockedItemKind = 'leads_sync_authorization_blocked'

/** 这个任务每 2 小时一跑；超过这个窗口就是最新这条记录已经过期，别再报旧问题。 */
const RUN_STALE_HOURS = 6

/** 只声明读得到的字段：这是**已经落库的旧数据**，当外部输入处理。 */
export interface LeadsSyncRunResult {
  clientId?: string
  clientName?: string | null
  blocked?: string
  error?: string
}

export interface LeadsSyncBlockedTodo {
  kind: LeadsSyncBlockedItemKind
  client_id: string
  client_name: string
  what: string
  how: string
  href: string
}

/** FacebookPagePanel 只挂在客户页的设置抽屉「platform」页签里，/settings 路由里没有它。 */
function panelHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}?settings=platform`
}

/**
 * 重新授权的步骤。两类卡点的做法其实是同一套 —— 令牌被拒和缺权限都只能靠
 * 「在这个主页上有管理员身份的人重新点一次授权」解决，所以不编两段话让人纠结。
 */
const HOW_RECONNECT =
  '点链接打开这个客户的设置抽屉 → 找到「Facebook 主页」卡片 → 让在这个主页上有管理员身份的人' +
  '（客户自己或我们被加进去的账号）点「连接 Meta」，在 Meta 的授权页上**所有权限都勾上**再确认。' +
  '授权完不用管，最多 2 小时这条待办会自己消失；还在就回我一句，我去看 Meta 那边的原话。'

/** 每种卡点说给人听的那半句「是什么事」。 */
const WHAT_BY_BLOCKER: Record<Exclude<LeadsSyncBlocker, 'page_binding_unverified'>, string> = {
  token_rejected:
    '这个客户的 Facebook 授权被 Meta 拒了（令牌过期、被撤销，或者当初授权的那个人在这个主页上已经没有角色了）',
  missing_permission:
    '这个客户的 Facebook 授权少了读即时表单要的权限（Meta 要 leads_retrieval + pages_manage_ads 这两条）',
}

/**
 * 一个客户的一轮结果 → 最多一条待办。认不出来的 blocker 值不下发（历史记录里
 * 可能有本版之前写的东西，宁可漏报也不要拿一句看不懂的话去占 PM 的时间）。
 */
export function buildLeadsSyncBlockedTodo(r: LeadsSyncRunResult): LeadsSyncBlockedTodo | null {
  if (!r.clientId || typeof r.clientId !== 'string') return null
  // 绑定没核实由 page-binding-items.ts 下发（见文件头），这里不重复。
  if (r.blocked !== 'token_rejected' && r.blocked !== 'missing_permission') return null

  const reason = (r.error ?? '').replace(/\s+/g, ' ').trim().slice(0, 140)
  const quote = reason ? `Meta 的原话：${reason}` : ''

  return {
    kind: KIND,
    client_id: r.clientId,
    client_name: r.clientName ?? '未知客户',
    what:
      `${WHAT_BY_BLOCKER[r.blocked]} —— 这个客户在 Facebook 广告留资表单里填过资料的人，` +
      `现在一个都进不了 CRM，销售的「今天该联系谁」里看不到他们。不会自己好。${quote}`,
    how: HOW_RECONNECT,
    href: panelHref(r.clientId),
  }
}

/** 上一轮跑完多久了。跑到一半没写完 finished_at 的当作太旧，不用。 */
function hoursSince(iso: string | null, now: Date): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return (now.getTime() - t) / 3_600_000
}

export async function fetchLeadsSyncBlockedTodos(
  supabase: SupabaseClient,
  now: Date,
): Promise<LeadsSyncBlockedTodo[]> {
  const { data, error } = await supabase
    .from('cron_run_logs')
    .select('finished_at, summary')
    // 🔴 不能只挑 `status = 'completed'`：同一轮里完全可能既有授权缺口、又有
    //    真故障（那会把整轮标成 failed），只查 completed 会让授权缺口在那些轮次里
    //    彻底消失 —— 也就是坏得越多、待办越少。
    .eq('job_name', 'meta-leads-sync')
    .not('finished_at', 'is', null)
    .order('finished_at', { ascending: false })
    .limit(1)

  if (error) throw new Error(`cron_run_logs query failed: ${error.message}`)

  const run = (data ?? [])[0] as
    | { finished_at: string | null; summary: { results?: LeadsSyncRunResult[] } | null }
    | undefined
  if (!run?.summary) return []

  // 「该跑没跑」有 pushCronHealthItems 在管，这里不重复报，只在结果够新时说话。
  const age = hoursSince(run.finished_at, now)
  if (age === null || age > RUN_STALE_HOURS) return []

  const todos: LeadsSyncBlockedTodo[] = []
  for (const r of run.summary.results ?? []) {
    const todo = r ? buildLeadsSyncBlockedTodo(r) : null
    if (todo) todos.push(todo)
  }
  return todos
}
