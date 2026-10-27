/**
 * 「分给我、客人在等、还没人回」的跟进名单 —— 现成三个检测器按跟进人合并。
 *
 * ## 为什么是合并，不是新判据
 *
 * 「客人在等回复」这件事，仓库里早就有三个各管一个渠道的检测器，各自带着踩过坑才有的排除规则：
 *   · Meta 表单留资   `lead-followup-due`  （填了表、24 小时没人真人回）
 *   · 邮件           `email-reply-due`    （客人最后一句话、没人回；自动回执 / 自己人 / 拒联 / 陌生发件人推销都排除）
 *   · WhatsApp       `email-reply-due`（`channel: 'whatsapp'`）同一套规则
 * 官网表单不用单独写：表单提交会同时产生一条邮件通知线程，已经被邮件检测器收进来了
 * （2026-10-27 查生产库：最近 30 天 6 位官网表单客人，6 位都有最后一句是客人的邮件线程）。
 *
 * 之前的「每日汇总」只用了第一个（Meta 表单）。Meta 线索停了 16 天，它每天都在说「窗口内 0 条」，
 * 而同一时期邮件 / WhatsApp 新客人没有一个进提醒。这个模块就是补这一块：**三个来源并起来，
 * 再按 `contacts.assigned_to` 切到每个人名下**。
 *
 * ## 三条纪律
 *
 * 1. 🔴 **某个检测器失败，必须说出来，不许当成「这个渠道没有」。** 返回值里的 `errors` 一定要被消费方
 *    读到并写进信 / 回执（`playbook-geo-general`：没测成 ≠ 零）。其余检测器的结果照常给，不因一个失败整体作废。
 * 2. 🔴 **只读，一行写操作都没有，也不发任何东西。** 这一层只回答「名单是什么」。
 * 3. **同一个人在多个来源里只出现一次**（官网表单客人既是表单又是邮件线程）。来源都记着，等的时间取最早那个。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAll } from '@/lib/supabase-paginate'
import { findLeadFollowupDue, type LeadDueItem } from './lead-followup-due'
import { findEmailRepliesDue, type ReplyDueItem } from './email-reply-due'

export type WorklistSource = 'meta_form' | 'email' | 'whatsapp'

/** 查「还没分给任何人」的名单时传这个。 */
export const UNASSIGNED = 'unassigned' as const

export interface WorklistEntry {
  contactId: string
  displayName: string | null
  /** 这个人从哪些渠道在等回复。可能不止一个。 */
  sources: WorklistSource[]
  /** 他最早开始等的时间（所有来源里最早的那个），ISO。 */
  waitingSince: string
  /** 已经等了多少个自然小时（向下取整）。 */
  waitingHours: number
  /** 一行说清他要什么：表单里选的团 / 邮件主题；没有就 null。 */
  headline: string | null
  /** 邮件 / WhatsApp 的线程，用来拼直达链接；表单来源没有。 */
  conversationId: string | null
  assignedTo: string | null
}

export interface WorklistResult {
  /** 已按跟进人过滤、等最久的排最前。 */
  entries: WorklistEntry[]
  /** 过滤之前，每个来源各自找到多少人（含不属于这个跟进人的）。 */
  detected: Record<WorklistSource, number>
  /** 过滤之前的全部去重人数，按分给谁（`unassigned` = 还没分）。让「别人名下有几位」说得出口。 */
  byAssignee: Record<string, number>
  /** 邮件里陌生地址第一次来信的数量。不进名单，但数字要说（`email-reply-due` 的纪律）。 */
  strangerEmails: number
  /** 失败的检测器 → 原因。**非空时名单不完整，消费方必须说出来。** */
  errors: Partial<Record<WorklistSource, string>>
}

export interface ComposeInput {
  metaForm: LeadDueItem[]
  email: ReplyDueItem[]
  whatsapp: ReplyDueItem[]
  /** contactId → `contacts.assigned_to`。查不到的人按「未分配」处理。 */
  assignedTo: ReadonlyMap<string, string | null>
  now: Date
  /** 只要某位跟进人名下的；传 `UNASSIGNED` = 只要没分给任何人的；不传 = 全部。 */
  assignee?: string
  errors?: Partial<Record<WorklistSource, string>>
  strangerEmails?: number
}

const HOUR_MS = 3_600_000

function hoursSince(iso: string, now: Date): number {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((now.getTime() - t) / HOUR_MS))
}

interface Acc {
  contactId: string
  displayName: string | null
  sources: Set<WorklistSource>
  waitingSince: string
  headline: string | null
  conversationId: string | null
}

function earlier(a: string, b: string): string {
  const ta = Date.parse(a)
  const tb = Date.parse(b)
  if (Number.isNaN(ta)) return b
  if (Number.isNaN(tb)) return a
  return ta <= tb ? a : b
}

/** 纯函数：把三个来源去重合并、切到某个跟进人名下。 */
export function composeWorklist(input: ComposeInput): WorklistResult {
  const acc = new Map<string, Acc>()
  const detected: Record<WorklistSource, number> = { meta_form: 0, email: 0, whatsapp: 0 }

  const add = (
    source: WorklistSource,
    contactId: string,
    displayName: string | null,
    since: string,
    headline: string | null,
    conversationId: string | null,
  ) => {
    detected[source]++
    const cur = acc.get(contactId)
    if (!cur) {
      acc.set(contactId, {
        contactId,
        displayName,
        sources: new Set([source]),
        waitingSince: since,
        headline,
        conversationId,
      })
      return
    }
    cur.sources.add(source)
    cur.waitingSince = earlier(cur.waitingSince, since)
    cur.displayName = cur.displayName ?? displayName
    cur.headline = cur.headline ?? headline
    cur.conversationId = cur.conversationId ?? conversationId
  }

  for (const m of input.metaForm) add('meta_form', m.contactId, m.displayName, m.leadAt, m.interest, null)
  for (const e of input.email) add('email', e.contactId, e.displayName, e.lastMessageAt, e.subject, e.conversationId)
  for (const w of input.whatsapp) add('whatsapp', w.contactId, w.displayName, w.lastMessageAt, null, w.conversationId)

  const byAssignee: Record<string, number> = {}
  const all: WorklistEntry[] = []
  for (const a of acc.values()) {
    const assignedTo = input.assignedTo.get(a.contactId) ?? null
    const key = assignedTo ?? UNASSIGNED
    byAssignee[key] = (byAssignee[key] ?? 0) + 1
    all.push({
      contactId: a.contactId,
      displayName: a.displayName,
      sources: [...a.sources].sort(),
      waitingSince: a.waitingSince,
      waitingHours: hoursSince(a.waitingSince, input.now),
      headline: a.headline,
      conversationId: a.conversationId,
      assignedTo,
    })
  }

  const wanted =
    input.assignee === undefined
      ? all
      : all.filter((e) => (input.assignee === UNASSIGNED ? e.assignedTo === null : e.assignedTo === input.assignee))

  wanted.sort((x, y) => y.waitingHours - x.waitingHours)

  return {
    entries: wanted,
    detected,
    byAssignee,
    strangerEmails: input.strangerEmails ?? 0,
    errors: input.errors ?? {},
  }
}

const IN_CHUNK = 100

async function loadAssignedTo(supabase: SupabaseClient, contactIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  for (let i = 0; i < contactIds.length; i += IN_CHUNK) {
    const part = contactIds.slice(i, i + IN_CHUNK)
    const rows = await fetchAll<{ id: string; assigned_to: string | null }>((from, to) =>
      supabase.from('contacts').select('id, assigned_to').in('id', part).order('id', { ascending: true }).range(from, to),
    )
    for (const r of rows) out.set(r.id, r.assigned_to)
  }
  return out
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export interface FindWorklistOptions {
  /** 只要某位跟进人名下的；`UNASSIGNED` = 没分的；不传 = 全部。 */
  assignee?: string
}

/**
 * 取数 + 合并。**只读。** 三个检测器并行跑，任何一个失败只记进 `errors`，不连累别的。
 *
 * 不封顶：封顶是消费方（信件）的事，名单这一层要如实给出全部，「别人名下几位」才算得对。
 */
export async function findAssigneeWorklist(
  supabase: SupabaseClient,
  clientId: string,
  now: Date,
  opts: FindWorklistOptions = {},
): Promise<WorklistResult> {
  const [meta, mail, wa] = await Promise.allSettled([
    findLeadFollowupDue(supabase, clientId, now, 0),
    findEmailRepliesDue(supabase, [clientId], now, { separateFirstContacts: true }),
    findEmailRepliesDue(supabase, [clientId], now, { channel: 'whatsapp' }),
  ])

  const errors: Partial<Record<WorklistSource, string>> = {}
  const settle = <T>(r: PromiseSettledResult<T>, source: WorklistSource, empty: T): T => {
    if (r.status === 'fulfilled') return r.value
    errors[source] = errText(r.reason)
    return empty
  }
  const metaForm = settle(meta, 'meta_form', { items: [], dropped: 0, orphans: 0 }).items
  const mailResult = settle(mail, 'email', { items: [], dropped: 0, droppedByClient: {} })
  const email = mailResult.items
  const whatsapp = settle(wa, 'whatsapp', { items: [], dropped: 0, droppedByClient: {} }).items
  const strangerEmails = mailResult.firstContacts?.length ?? 0

  const ids = [...new Set([...metaForm.map((i) => i.contactId), ...email.map((i) => i.contactId), ...whatsapp.map((i) => i.contactId)])]
  const assignedTo = await loadAssignedTo(supabase, ids)

  return composeWorklist({ metaForm, email, whatsapp, assignedTo, now, assignee: opts.assignee, errors, strangerEmails })
}
