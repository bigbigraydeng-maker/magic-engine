import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { syncMailbox, type MailboxTarget } from '@/lib/microsoft/mail-ingest'
import { MICROSOFT_MAIL_PROVIDER } from '@/lib/microsoft/mail-oauth'
import { CONNECTION_STATUS } from '@/lib/platform-oauth/vocabulary'
import { startCronRun } from '@/lib/cron/run-logger'

/**
 * GET /api/cron/mailbox-sync
 *
 * 每小时把每个**已连的邮箱**里的新邮件接进 CRM。
 *
 * 为什么按小时、不按分钟：邮件不是即时通讯，客人不会指望十分钟内回；而每次
 * 跑都要读收件箱 + 已发送两个文件夹，频率越高越容易撞上 Graph 的限流，
 * 结果是**该来的信反而来得更慢**。
 *
 * 单位是**邮箱**不是客户：一个客户可以连不止一个邮箱（设置页上就有「再连一个
 * 邮箱」）。按客户跑的话，较早连的那个邮箱一封信都读不到，而且不会报错。
 *
 * 没连邮箱的客户一次网络调用都不该为他发生，所以这里从连接表出发、不从客户表。
 *
 * 一个邮箱失败不影响其他邮箱：syncMailbox 永不抛异常。
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

  const run = await startCronRun('mailbox-sync')

  // 先问「哪些邮箱连着」，再按这批客户 id 取客户资料 —— 反过来（取全部客户
  // 再逐个试）会为每一个没连邮箱的客户白跑一次授权查询。
  const { data: conns, error: connErr } = await supabaseAdmin
    .from('platform_oauth_connections')
    .select('id, client_id, account_id')
    .eq('provider', MICROSOFT_MAIL_PROVIDER)
    .eq('status', CONNECTION_STATUS.ACTIVE)

  if (connErr) {
    await run.finish({ error: connErr.message })
    return NextResponse.json({ error: connErr.message }, { status: 500 })
  }

  const connections = (conns ?? []) as { id: string; client_id: string; account_id: string }[]
  if (connections.length === 0) {
    await run.finish({ processed: 0, completed: 0, failed: 0, summary: { note: '还没有客户连邮箱' } })
    return NextResponse.json({ ok: true, mailboxes: 0, results: [] })
  }
  const clientIds = Array.from(new Set(connections.map((c) => c.client_id)))

  const { data: clients, error } = await supabaseAdmin
    .from('clients')
    .select('id, name, domain')
    .in('id', clientIds)

  if (error) {
    await run.finish({ error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const byClient = new Map(
    ((clients ?? []) as { id: string; name: string | null; domain: string | null }[]).map((c) => [
      c.id,
      c,
    ]),
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

  const results = []
  for (const target of targets) {
    results.push(await syncMailbox(target))
  }

  const newContacts = results.reduce((n, r) => n + r.newContacts, 0)
  const messages = results.reduce((n, r) => n + r.messages, 0)
  const touchpoints = results.reduce((n, r) => n + r.touchpoints, 0)
  // 这次一共丢了多少封（noreply / 内部 / 读不出对方）。判据判错了要能从这个数
  // 看出规模 —— 突然从每天 30 跳到 300，就是有一类真客人被当成机器人了。
  const skippedMessages = results.reduce(
    (n, r) => n + r.skipped.reduce((m: number, s: { messages: number }) => m + s.messages, 0),
    0,
  )
  // 中途停下的也算没跑完 —— 它确实没把这一批读完，下一轮要接着来。
  const failed = results.filter((r) => r.error || r.stoppedEarly).length
  const stoppedEarly = results.filter((r) => r.stoppedEarly).map((r) => r.stoppedEarly)
  // 邮箱太忙一次没读完 —— 下一次水位线会接着读，但要说出来。
  const truncated = results.filter((r) => r.truncated).map((r) => r.mailbox)

  await run.finish({
    processed: results.length,
    completed: results.length - failed,
    failed,
    summary: {
      newContacts,
      messages,
      touchpoints,
      skippedMessages,
      truncated,
      stoppedEarly,
      results,
    },
  })

  return NextResponse.json({
    ok: true,
    mailboxes: results.length,
    newContacts,
    messages,
    touchpoints,
    skippedMessages,
    truncated,
    stoppedEarly,
    results,
  })
}
