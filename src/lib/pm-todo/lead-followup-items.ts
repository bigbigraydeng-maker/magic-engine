/**
 * 「填了表、超过 24 小时没有真人回过」→ 下发到「需要你动手」。
 *
 * ## 为什么这条要单独存在
 *
 * 广告表单进来的线索是最值钱的一批人：他自己把电话留下来了。晚一天跟，
 * 这个人就更可能去选别家。所以「有没有人回过」必须有人盯着，而不是等
 * 销售自己想起来。
 *
 * ## 一个客户合成一条
 *
 * 不是一人一条 —— 一个客户一天可能进来十几条线索，逐条列会把整栏撑爆，
 * 而且看的人要的是「这个客户欠着人」，不是「第 7 条线索叫什么」。
 * 所以只报人数和最久等了几天，具体是谁在「全部客人」页里看。
 *
 * ## 纪律
 *
 * 这个文件**一行写操作都没有**，跟 `email-reply-items.ts` 同一条线：
 * 判中了只是让人多看一眼；判错了代价是浪费他 10 秒，不是替他打电话。
 *
 * ## 算不出来 ≠ 没人在等
 *
 * 取数失败时**必须**留一条 `lead_followup_check_failed`。一个哑掉的检查
 * 和一个健康的检查，在待办清单里长得一模一样 —— 那个零是假的。
 * （理由同 `email-reply-items.ts` 开头那段。）
 *
 * ## 不写人名
 *
 * what / how 里**绝不出现**客人的姓名、邮箱、电话。这条待办会进汇总信、
 * 进日志，人名不该跟着走。要认人，点链接进「全部客人」页看。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  findLeadFollowupDue,
  countLeadFollowupBacklog,
  type LeadDueResult,
  type LeadBacklogResult,
} from '@/lib/crm/lead-followup-due'
import { APP_BASE } from './binding-request-items'
import type { ManualItem } from './manual-item-types'

export type LeadFollowupItemKind =
  /** 有客人填了表、超过 24 小时没有真人回过 —— 一个客户合成一条 */
  | 'lead_followup_due'
  /** 这一栏今天没算出来 —— 我们这边要查（开发的活） */
  | 'lead_followup_check_failed'

/** 取数依赖，测试里注入假的，生产走默认实现。 */
export interface LeadFollowupDeps {
  findDue: (supabase: SupabaseClient, clientId: string, now: Date) => Promise<LeadDueResult>
  countBacklog: (supabase: SupabaseClient, clientId: string, now: Date) => Promise<LeadBacklogResult>
}

export const defaultLeadFollowupDeps: LeadFollowupDeps = {
  findDue: (s, c, n) => findLeadFollowupDue(s, c, n),
  countBacklog: (s, c, n) => countLeadFollowupBacklog(s, c, n),
}

/** 落点：CRM「全部客人」页 —— 那一页有「今天要联系」和写记录的入口。 */
function allContactsHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/crm/all`
}

/** 报错信息截断 —— 太长的堆栈塞进待办里没人看，还会把一行撑成一屏。 */
const ERROR_SNIPPET_MAX = 120

function errorSnippet(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.length > ERROR_SNIPPET_MAX ? `${msg.slice(0, ERROR_SNIPPET_MAX)}…` : msg
}

/**
 * 更早的积压 —— 单独一次查询，**自己 catch**。
 *
 * 积压算不出来不该把「今天有几个人在等」这条一起带走：前者是补充说明，
 * 后者才是要人动手的那件事。
 */
async function backlogNote(
  supabase: SupabaseClient,
  clientId: string,
  now: Date,
  deps: LeadFollowupDeps,
): Promise<string> {
  try {
    const backlog = await deps.countBacklog(supabase, clientId, now)
    if (backlog.backlog > 0) {
      return `；另有 ${backlog.backlog} 个更早的（半年内）也没人回过，不在这条里逐个催`
    }
    return ''
  } catch {
    return '（更早的积压这次没算出来）'
  }
}

/** 整天的毫秒数 —— 只用来算「最久等了几天」。 */
const DAY_MS = 24 * 3_600_000

/**
 * 两件事一起下发：填了表没人回 · 这一栏算不出来。
 *
 * 调用方在 `loadManualItems` 里，必须挂 `.catch` —— 这条通道出问题不该把
 * 整份今日待办一起带走。
 */
export async function pushLeadFollowupItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  ids: string[],
  now: Date,
  nameOf: (id: string) => string,
  deps: LeadFollowupDeps = defaultLeadFollowupDeps,
): Promise<void> {
  // 逐个客户串行：一个客户取数失败不能影响别的客户，也不能把整栏带走。
  for (const id of ids) {
    const name = nameOf(id)
    try {
      const due = await deps.findDue(supabase, id, now)
      const total = due.items.length + due.dropped
      if (total === 0) continue

      // items 已按等得最久的排前面；一条明细都没有（全被 dropped）时按 1 天算。
      const oldestLeadAt = due.items[0]?.leadAt
      const oldestDays = oldestLeadAt
        ? Math.max(1, Math.floor((now.getTime() - new Date(oldestLeadAt).getTime()) / DAY_MS))
        : 1

      const note = await backlogNote(supabase, id, now, deps)

      items.push({
        kind: 'lead_followup_due',
        client_id: id,
        client_name: name,
        what:
          `${name} 有 ${total} 个客人填了表、超过 24 小时没有真人回过` +
          `（最久已等 ${oldestDays} 天）${note}。晚一天跟，这个人就更可能去选别家`,
        how:
          '请转给客户的销售：点链接打开「全部客人」，看「今天要联系」里排前面、从表单进来的人，' +
          '逐个打电话（打不通也算打过）。处理完在他页面上记一笔，没打通也要记一句，否则这条会一直在。' +
          '注意：这里只把电话、手写记录和真人回复算作「回过」；Facebook 私信的外发整类不算' +
          '（里面混着 Meta 自家 AI 客服的自动回复），所以「今天要联系」页里显示已联系的人，' +
          '这里可能仍然列着。客户在表格里记的电话要先同步进系统，没同步时这个数会偏高',
        href: allContactsHref(id),
      })
    } catch (err) {
      // 算不出来 ≠ 没人在等 —— 必须留一条，否则那个零是假的。
      items.push({
        kind: 'lead_followup_check_failed',
        client_id: id,
        client_name: name,
        what:
          `「${name} 填了表没人回」这一栏今天没算出来（${errorSnippet(err)}）` +
          '—— 没有结果不等于没有人在等',
        how: '这条不用你动手 —— 是我们这边的欠账。回我一句「修一下线索待办」我就去修',
        href: '',
      })
    }
  }
}
