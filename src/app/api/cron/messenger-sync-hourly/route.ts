import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { syncClientMessenger, type MessengerSyncClient } from '@/lib/messenger/sync'
import { startCronRun } from '@/lib/cron/run-logger'
import { syncMailbox, type MailboxTarget } from '@/lib/microsoft/mail-ingest'
import { MICROSOFT_MAIL_PROVIDER } from '@/lib/microsoft/mail-oauth'
import { CONNECTION_STATUS } from '@/lib/platform-oauth/vocabulary'
import { readDomainRules } from '@/lib/crm/contact-kind'
import { sendInngestEvent } from '@/lib/workflows/inngest-event'
import {
  MESSENGER_SYNC_COMPLETED_EVENT,
  syncCompletedEventId,
  type MessengerSyncCompletedData,
} from '@/lib/messenger/sync-completed-event'
import { isSkippablePageTokenFailure } from '@/lib/meta/broken-page-token'

/**
 * GET /api/cron/messenger-sync-hourly
 *
 * Hourly cron — pulls each opted-in client's Facebook Page Messenger inbox into
 * conversations / conversation_messages.
 *
 * Opt-in is per client: only rows with clients.facebook_page_id set are synced.
 * As of 2026-07-26 that is CTS Tours NZ only.
 *
 * ## 为什么邮箱同步也挂在这条任务里（2026-08-03）
 *
 * 邮箱同步本来是 `render.yaml` 里一条**新的** cron 服务。Render 的蓝图对新增
 * 服务不会自动生效 —— 要有人进后台点一次 Apply。结果就是：代码上线了、连接也
 * 连好了，任务**一次都没跑过**，而这件事不会报任何错。
 *
 * 按铁律 3，能不靠人点的就不该靠人点。这条每小时任务**已经在跑**（而且干的
 * 是同一件事：把客人说的话拉回 CRM），把邮箱挂在它后面，就不需要任何人去
 * Render 点什么。`/api/cron/mailbox-sync` 那条路由保留，用于单独手动触发。
 *
 * 邮箱失败不影响私信 —— 它跑在私信之后，且各自 catch。
 *
 * ## 跑完之后谁接着干（2026-09-07 改）
 *
 * 跑到最后一行会发一张 `me/messenger.sync.completed` 条子，Inngest 那边的
 * `cloud-messenger-brief-after-sync` 收到就去写客户需求卡。
 *
 * 🔴 **原来是 `render.yaml` 里 `curl 同步 && curl 写卡`，那个 `&&` 守错了信号** ——
 *    它守的是「网关有没有在超时前把响应给 curl」，不是「同步有没有跑完」。
 *    本路由 2026-08-17 起每轮约 140 秒、网关约 125 秒掐断返 524，于是写卡那条
 *    **一次都没执行**，销售的需求卡停更 14 天。判据换成这张条子之后，响应有没有
 *    超时跟写不写卡完全无关。整段来龙去脉见 `@/lib/messenger/sync-completed-event`。
 *
 * 🔴 **发条子失败不能让本轮判失败**：私信已经跑完并且入库了。发不出去只丢一轮卡，
 *    下一轮会再发；把整轮判失败会让人以为私信也没跑（正是这次事故的形态）。
 *
 * Auth: Bearer ${CRON_SECRET}
 */

export const maxDuration = 600

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfiguration: CRON_SECRET not set' },
      { status: 500 },
    )
  }

  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 🔴 **必须留着裸的 `startCronRun('messenger-sync-hourly')` 字面量。**
  //    CRON_REGISTRY 的对账测试是用 AST 找 `startCronRun(...)` 的入参来认这个任务的；
  //    改成 `startCronRunId` 之类的别名，扫描器当场认不出来 —— 这条任务会从监控清单里
  //    静默消失，而「不在监控范围」和「一切正常」在告警里长得一模一样。
  const run = await startCronRun('messenger-sync-hourly')

  const { data: clients, error } = await supabaseAdmin
    .from('clients')
    .select('id, name, facebook_page_id')
    .not('facebook_page_id', 'is', null)

  if (error) {
    await run.finish({ error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const results = []
  for (const client of (clients ?? []) as MessengerSyncClient[]) {
    results.push(await syncClientMessenger(client))
  }

  const conversations = results.reduce((n, r) => n + r.conversations, 0)
  const messages = results.reduce((n, r) => n + r.messages, 0)
  // 「今天 Messenger 带进来几个新人」—— PM 真正会问的那个数。
  const newContacts = results.reduce((n, r) => n + r.created, 0)
  // 补挂历史老对话认出来的人 + 还剩多少没挂上（能看出还要几轮清完积压）。
  const backfilled = results.reduce((n, r) => n + r.backfilled, 0)
  const backfillRemaining = results.reduce((n, r) => n + r.backfillRemaining, 0)
  // 已知坏令牌（190 / 缺角色 / 未核实公用令牌）有自己的待办，不算进这轮 failed，
  // 否则这条每小时任务会永远停在 partial。其它客户错误照常计数。
  const failed = results.filter((r) => !!r.error && !isSkippablePageTokenFailure(r)).length

  // ── 顺带把邮箱也同步了（理由见文件头）────────────────────────────────
  // 整段包在 try 里：邮箱那边出任何问题都不能让私信这条报失败 ——
  // 私信已经跑完并且入库了，为邮箱把整次判失败会让人以为私信也没跑。
  let mail: Awaited<ReturnType<typeof syncMailbox>>[] = []
  let mailError: string | null = null
  try {
    mail = await syncConnectedMailboxes()
  } catch (err) {
    mailError = err instanceof Error ? err.message : String(err)
    console.error('[messenger-sync-hourly] 邮箱同步失败（不影响私信）:', mailError)
  }
  const mailFailed = mail.filter((m) => m.error || m.stoppedEarly).length

  // ── 接力：告诉写卡那一步「同步跑完了」（理由见文件头）──────────────────
  //
  // 🔴 **必须在 run.finish 之前发**（2026-09-07 加观测那次揪出来的）。
  //    原来放在 finish 之后：handoff 结果只写进 HTTP 响应，而这个响应会被网关
  //    在 125 秒时掐断 —— 观测数据被扔进了正好看不见的地方，正是这次事故
  //    自己的失败模式。放进 summary 之后，即便响应被掐，运行记录里也留得下
  //    「发条子成功了没 / 失败原因是什么」。
  const handoff = await dispatchBriefHandoff({
    clients: results.length,
    conversations,
    messages,
    new_contacts: newContacts,
    failed,
    mailbox_error: mailError,
    completed_at: new Date().toISOString(),
  })

  await run.finish({
    processed: results.length + mail.length,
    completed: results.length - failed + (mail.length - mailFailed),
    failed: failed + mailFailed + (mailError ? 1 : 0),
    summary: {
      conversations, messages, newContacts, backfilled, backfillRemaining, results,
      mailbox: {
        mailboxes: mail.length,
        newContacts: mail.reduce((n, m) => n + m.newContacts, 0),
        messages: mail.reduce((n, m) => n + m.messages, 0),
        error: mailError,
        results: mail,
      },
      // 🔴 写卡接力那张条子发出去没 —— 上一次事故就是这一步安静地失败了，
      //    响应被网关吞掉、监控里看着一切正常。留在 summary 里以后一眼可查。
      briefHandoff: handoff,
    },
  })

  return NextResponse.json({
    ok: true,
    clients: results.length,
    conversations,
    messages,
    newContacts,
    backfilled,
    backfillRemaining,
    results,
    mailbox: { mailboxes: mail.length, error: mailError, results: mail },
    briefHandoff: handoff,
  })
}

/**
 * 把「同步跑完了」这张条子发出去。**永不抛异常。**
 *
 * 发不出去只丢一轮卡（下一轮会再发），而把整轮判失败会让人以为私信也没跑 ——
 * 那正是这次事故的形态：一个下游步骤的问题被误报成上游没跑。
 */
async function dispatchBriefHandoff(
  data: MessengerSyncCompletedData,
): Promise<{ sent: boolean; error: string | null }> {
  try {
    await sendInngestEvent({
      id: syncCompletedEventId(new Date(data.completed_at)),
      name: MESSENGER_SYNC_COMPLETED_EVENT,
      data,
    })
    return { sent: true, error: null }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[messenger-sync-hourly] 写卡接力条子没发出去（私信已入库）:', message)
    return { sent: false, error: message }
  }
}

/**
 * 把每一个**已连的邮箱**同步一遍。
 *
 * 单位是邮箱不是客户：一个客户可以连不止一个邮箱，按客户跑的话较早连的那个
 * 一封信都读不到（而且不报错）。跟 /api/cron/mailbox-sync 走同一套逻辑，
 * 只是换了个触发点。
 */
async function syncConnectedMailboxes() {
  const { data: conns } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('id, client_id, account_id')
    .eq('provider', MICROSOFT_MAIL_PROVIDER)
    .eq('status', CONNECTION_STATUS.ACTIVE)

  const connections = (conns ?? []) as { id: string; client_id: string; account_id: string }[]
  if (connections.length === 0) return []

  // leads_config 一起取回来：里面有设置页填的「客户自己的邮件域名」（关联公司），
  // 官网域名和收信域名都覆盖不到它 —— 漏了它同事来信会被当成新客人建档。
  const { data: clients } = await supabaseAdmin
    .from('clients')
    .select('id, name, domain, leads_config')
    .in('id', Array.from(new Set(connections.map((c) => c.client_id))))

  const byClient = new Map(
    (
      (clients ?? []) as {
        id: string
        name: string | null
        domain: string | null
        leads_config: unknown
      }[]
    ).map((c) => [c.id, c]),
  )

  const targets: MailboxTarget[] = connections
    // 连接指向一个查不到的客户（删过客户但连接还在）—— 跳过，不为它报错。
    .filter((c) => byClient.has(c.client_id))
    .map((c) => ({
      clientId: c.client_id,
      clientName: byClient.get(c.client_id)?.name ?? null,
      domain: byClient.get(c.client_id)?.domain ?? null,
      connectionId: c.id,
      mailbox: c.account_id,
      ownDomains: readDomainRules(byClient.get(c.client_id)?.leads_config).own,
    }))

  const out = []
  for (const t of targets) out.push(await syncMailbox(t))
  return out
}
