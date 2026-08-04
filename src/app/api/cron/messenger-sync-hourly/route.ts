import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { syncClientMessenger, type MessengerSyncClient } from '@/lib/messenger/sync'
import { startCronRun } from '@/lib/cron/run-logger'
import { syncMailbox, type MailboxTarget } from '@/lib/microsoft/mail-ingest'
import { MICROSOFT_MAIL_PROVIDER } from '@/lib/microsoft/mail-oauth'
import { CONNECTION_STATUS } from '@/lib/platform-oauth/vocabulary'

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
  const failed = results.filter((r) => r.error).length

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
  })
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

  const { data: clients } = await supabaseAdmin
    .from('clients')
    .select('id, name, domain')
    .in('id', Array.from(new Set(connections.map((c) => c.client_id))))

  const byClient = new Map(
    ((clients ?? []) as { id: string; name: string | null; domain: string | null }[]).map((c) => [c.id, c]),
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
    }))

  const out = []
  for (const t of targets) out.push(await syncMailbox(t))
  return out
}
