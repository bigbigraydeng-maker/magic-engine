/**
 * 「客人来信没人回」+「公司邮箱同步哑了」→ 下发到「需要你动手」。
 *
 * ## 为什么这两件事挤在同一个文件里
 *
 * 它们是同一条管道的两头，而且**互为对方的解释**：
 *
 *   · 上面那半（`email_reply_due`）说的是「有信没回」；
 *   · 下面那半（`email_sync_stale`）说的是「今天信根本没进来」。
 *
 * 只做上面那半会出一种最坏的情况：邮箱授权掉了 → 一封新信都没同步进来 →
 * 「没人回的信」自然是零条 → 这一栏干干净净 → 看的人读成「今天没人欠客人信」。
 * **一个哑掉的通道和一个健康的通道，在待办清单里长得一模一样。**
 * 所以「同步本身出事了」必须跟结果并排出现，否则那个零是假的。
 *
 * 「同步那趟到底怎么样」怎么读，在 `crm/mailbox-run.ts`（给销售的汇总信共用
 * 同一个读法 —— 那封信同样不能把一份不完整的名单说成完整的）。这里只管说人话。
 *
 * ## 纪律
 *
 * 这个文件**一行写操作都没有**，跟它依赖的 `crm/email-reply-due.ts` 同一条线：
 * 判中了只是让人多看一眼；判错了代价是浪费他 10 秒，不是替他发一封错信。
 *
 * ## 每条待办都必须让人留一笔
 *
 * 抑制条件在上游是「那封信之后有一笔人工触点」。所以**不用回也得写一句**——
 * 光点开看一眼不写任何东西，这条会连着冒到时间窗到期（默认 30 天）。
 * 一条说明不准的人工任务比没有更糟：照做、发现没用、下次整栏跳过
 * （PR #1037 在私信那条上踩过同一个坑，理由见 manual-items.ts 的 how 注释）。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  findEmailRepliesDue,
  REPLY_DUE_WINDOW_DAYS,
  REPLY_SLA_HOURS,
  type ReplyDueItem,
} from '@/lib/crm/email-reply-due'
import { contactCardTitle } from '@/lib/crm/display-name'
import { loadMailboxRun, type MailboxSummary } from '@/lib/crm/mailbox-run'
import type { ManualItem } from './manual-items'

export type EmailReplyItemKind =
  | 'email_reply_due'
  /** 陌生地址第一次来信没回（多半是推销，但也可能是真客人的第一封询价）—— 一个客户合成一条 */
  | 'email_first_contact'
  /** 邮箱授权掉了 / 一个都没连上 —— 要人点一次重新授权 */
  | 'email_sync_stale'
  /** 同步那趟卡住 / 整趟失败 / 读到一半停 —— 我们这边要查（开发的活） */
  | 'email_sync_broken'

/** 后台入口（登录后可见）。所有 href 都从这里拼绝对网址，见下面的 🔴。 */
const APP_BASE = 'https://app.magicengine.com.au'

/**
 * 🔴 绝对网址 —— 相对路径会被链接闸判成 broken，**整条待办被丢掉**
 *    （狄仁杰 2026-08-05 实测 kept=0，理由见 manual-items.ts 的 NEVER_DROP_KINDS）。
 *
 * 🔴 落点刻意是 CRM 里这个人的记录，**不是**收件箱那条线程页
 *    （`/business-inbox/...` 源码明写着「只读、回不了信」，而且是付费功能，
 *    点进去会扑空）。`?contact=` 这个参数「全部客人」那一页真的读：
 *    点进去自动展开到这个人，而且那一页就有写记录的入口 —— 下面 how 里
 *    要求的「写一句话记一笔」正是在那儿写。改落点前先确认新页面也满足这两条。
 */
function contactHref(clientId: string, contactId: string): string {
  return `${allContactsHref(clientId)}?contact=${encodeURIComponent(contactId)}`
}

/** 同一页，不落到具体某个人 —— 「还有 N 条没列出来」指的是一批人。 */
function allContactsHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/crm/all`
}

function settingsHref(clientId: string): string {
  return `${APP_BASE}/dashboard/clients/${encodeURIComponent(clientId)}/settings`
}

/** 客人来信超时没回 —— 一个人一条，等最久的排前面（上游已排好序）。 */
async function pushDueItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  ids: string[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  // 不再传每客户上限：今日待办会把同一个客户的这些条合成一行、带着人数
  // （daily-todo.ts `buildTodoView`），不存在「一页放不下只好说还有 N 条没列」。
  const { items: due, firstContacts } = await findEmailRepliesDue(supabase, ids, now, {
    separateFirstContacts: true,
  })

  for (const d of due) {
    const who = contactCardTitle(d.displayName)
    const subject = d.subject?.trim() ? d.subject : '（这封信没有主题）'
    items.push({
      kind: 'email_reply_due',
      client_id: d.clientId,
      client_name: nameOf(d.clientId),
      what:
        `${who} 发到公司邮箱的信已经等了 ${d.waitingHours} 小时没人回` +
        `（主题：${subject}）—— 客人这会儿多半正在问别家`,
      how:
        '点链接直接展开到这位客人，先把那封信看完整（同事可能已经在别处回过了）。' +
        '要回 → 用你平时用的邮箱直接回他，回完再在他的记录里写一句「已回复」。' +
        '不用回（已经回过 / 不是客人 / 问的不是我们的事）→ 同样在他的记录里' +
        `写一句话说明为什么不用回。**不用回的话也得写一句话记一笔，否则这条会一直冒到 ${REPLY_DUE_WINDOW_DAYS} 天**` +
        '（没写就等于没人看过，明天照样来）',
      href: contactHref(d.clientId, d.contactId),
    })
  }

  pushFirstContactItems(items, firstContacts ?? [], nameOf)
}

/** 陌生来信那一行最多点几个主题 —— 够 PM 扫一眼认出真询价，又不把一行撑成一屏。 */
const FIRST_CONTACT_SAMPLE = 5

/**
 * 陌生地址第一次来信 —— 一个客户合成**一条**，不是一人一条。
 *
 * 🔴 **不丢。** 这些人跟客户之间除了这封信什么记录都没有，十有八九是推销；但真客人的
 *    第一封询价也长这样，而且那是最值钱的一封信。所以列主题让人扫一眼，不替人判。
 *    （2026-09-26 子牙 / 魏征设计复审：「挪去销售汇总信」那条路是停着的，丢了就没人看见。）
 */
function pushFirstContactItems(
  items: ManualItem[],
  firstContacts: ReplyDueItem[],
  nameOf: (id: string) => string,
): void {
  const byClient = new Map<string, ReplyDueItem[]>()
  for (const d of firstContacts) {
    const list = byClient.get(d.clientId) ?? []
    list.push(d)
    byClient.set(d.clientId, list)
  }
  for (const [clientId, list] of Array.from(byClient.entries())) {
    // 新来的排前面：真询价多半是最近才来的，推销往往一连发好几周
    const newest = [...list].sort((a, b) => a.waitingHours - b.waitingHours)
    const samples = newest
      .slice(0, FIRST_CONTACT_SAMPLE)
      .map((d) => `${contactCardTitle(d.displayName)}《${d.subject?.trim() || '没有主题'}》`)
      .join('、')
    const more = list.length > FIRST_CONTACT_SAMPLE ? ` 等 ${list.length} 封` : ''
    items.push({
      kind: 'email_first_contact',
      client_id: clientId,
      client_name: nameOf(clientId),
      what:
        `${list.length} 封陌生地址的来信超过 ${REPLY_SLA_HOURS} 小时没回：${samples}${more}。` +
        '这些人以前跟这个客户没有任何往来（没通过信、没从广告表单或私信来过、不在邮件名单上），多半是推销',
      how:
        '扫一眼主题：像真客人来问的，点进去当普通来信回；是推销的，在他的记录里写一句「不是客人」，' +
        `这条就不会再冒出来（不写的话会一直冒到 ${REPLY_DUE_WINDOW_DAYS} 天）`,
      href: allContactsHref(clientId),
    })
  }
}

/**
 * 同步那趟卡住了 —— 开跑没写完。
 *
 * 跟「整趟失败」分开说：失败有原因可看，卡住只知道它没回来。说法说重了
 * 会让人白跑一趟重连授权。
 */
function pushStuckItem(items: ManualItem[], hours: number): void {
  items.push({
    kind: 'email_sync_broken',
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    what:
      `公司邮箱那趟同步 ${hours} 小时前开跑，到现在没写完 —— 它本来每小时一轮，这是卡住了。` +
      '卡住这段时间，客人发到公司邮箱的信一封都没进系统，' +
      '上面那条「客人来信没人回」查的是一份没更新的数据',
    how:
      '这条不用你动手 —— 是我们这边同步卡住了。回我一句「公司邮箱同步卡住了」我去看。' +
      '在我说修好之前，今天邮件这一路的待办都只当作没查过',
    href: `${APP_BASE}/dashboard/clients`,
  })
}

/** 同步整趟挂了 / 一个邮箱都没连上 —— 都是「今天信压根没进来」，挂 infra。 */
function pushMailboxWideItem(items: ManualItem[], mailbox: MailboxSummary): boolean {
  const common = {
    client_id: 'infra',
    client_name: 'Magic Engine 后台',
    href: `${APP_BASE}/dashboard/clients`,
  } as const

  if (mailbox.error) {
    items.push({
      ...common,
      kind: 'email_sync_broken',
      what:
        `公司邮箱同步整趟失败了：${mailbox.error} —— 客人发到公司邮箱的信今天一封都没进系统。` +
        '上面那条「客人来信没人回」今天查的是一份没更新的数据，别把它当成「没人在等」',
      how:
        '这条不用你动手 —— 是我们这边同步挂了。回我一句「公司邮箱同步挂了」我去修。' +
        '修好之前，今天邮件这一路的待办都只当作没查过，不能当作客户侧没问题',
    })
    return true
  }

  if (mailbox.mailboxes === 0) {
    items.push({
      ...common,
      kind: 'email_sync_stale',
      what:
        '一个公司邮箱都没连上 —— 客人发到公司邮箱的信全都进不了系统，' +
        '「客人来信没人回」那一栏永远是空的，而那个空是假的',
      how:
        '点链接进客户列表 → 挑要接邮箱的那个客户 → 设置页「公司邮箱（客人发来的信）」' +
        '那一栏点一次授权，用能收这个邮箱的账号登录。授权过又掉了的，同一处会显示「需要重新授权」',
    })
    return true
  }

  return false
}

/** 单个邮箱读失败 / 读到一半停了 —— 挂到它自己那个客户名下。 */
function pushMailboxResultItems(
  items: ManualItem[],
  mailbox: MailboxSummary,
  nameOf: (id: string) => string,
): void {
  for (const r of mailbox.results ?? []) {
    const reason = r.error ?? r.stoppedEarly
    if (!reason || typeof r.clientId !== 'string') continue

    // 提前停了 ≠ 整个读失败：水位线不会越过失败那条，下一轮会重来。
    // 两者都得说，但说法不能一样 —— 说重了会让人白跑一趟重连授权。
    const stoppedOnly = !r.error
    const where = `邮箱 ${r.mailbox ?? '（地址不详）'}`
    items.push({
      // 读到一半停了：先观察，连着几天停在同一处才是我们要查的；读不进来多半是授权掉了
      kind: stoppedOnly ? 'email_sync_broken' : 'email_sync_stale',
      client_id: r.clientId,
      client_name: nameOf(r.clientId),
      what: stoppedOnly
        ? `${where} 这一轮读到一半就停了：${reason} —— ` +
          '停之前的信进来了，之后的没有。下一轮会从停的地方重来，但要是每轮都停在同一处，就是卡死了'
        : `${where} 读不进来：${reason} —— ` +
          '这个客户的客人发到公司邮箱的信今天一封都没进系统',
      how: stoppedOnly
        ? '先什么都不用做，看明天这条还在不在。连着两三天都是同一个邮箱同一个原因 → ' +
          '回我一句「某某邮箱每轮都停在同一处」，我去查'
        : '点链接进设置页 →「公司邮箱（客人发来的信）」那一栏，看是不是显示「需要重新授权」，' +
          '是就用能收这个邮箱的账号点一次重新授权。显示正常还是读不进来 → 回我一句「邮箱读不进来」我去查',
      href: settingsHref(r.clientId),
    })
  }
}

/**
 * 两件事一起下发：客人来信没人回 · 公司邮箱同步哑了。
 *
 * 调用方在 `loadManualItems` 里，必须挂 `.catch` —— 这条通道出问题不该把
 * 整份今日待办一起带走。
 */
export async function pushEmailReplyItems(
  supabase: SupabaseClient,
  items: ManualItem[],
  ids: string[],
  now: Date,
  nameOf: (id: string) => string,
): Promise<void> {
  if (ids.length === 0) return

  await pushDueItems(supabase, items, ids, now, nameOf)

  const state = await loadMailboxRun(supabase, now)
  // 卡在「在跑」= 这趟根本没写完，信没进来。别跟「记录太旧」一起吞掉。
  if (state.kind === 'stuck') return pushStuckItem(items, state.hours)
  if (state.kind !== 'ok' || !state.mailbox) return
  // 整趟挂了的时候，逐个邮箱的失败是同一件事的下游，不重复报。
  if (pushMailboxWideItem(items, state.mailbox)) return
  pushMailboxResultItems(items, state.mailbox, nameOf)
}
