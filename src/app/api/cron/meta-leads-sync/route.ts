/**
 * GET/POST /api/cron/meta-leads-sync
 *
 * 每 30 分钟把 Facebook 即时表单里的新人搬进 CRM（每小时第 25 分和第 55 分）。
 *
 * 在这之前这条路**只有人手一条**：导 CSV → 跑 `scripts/import-cts-fb-leads.ts`。
 * 2026-07-30 查 CTS 的实测后果：CRM 里最后一个新人停在 7/25，Meta 后台 7/26–7/30
 * 又进了 27 个人，销售的「今天该联系谁」里一个都没有。这个 cron 就是把那条断掉的
 * 管道接上。
 *
 * 开关：`clients.facebook_page_id` 有值的客户才同步（跟私信同步同一个开关）。
 *
 * Auth:
 *   GET : Authorization: Bearer ${CRON_SECRET}   （Render 定时触发）
 *   POST: x-cron-secret: ${CRON_SECRET}          （人手补跑）
 *
 * ⚠️ 这个 cron 在 Render 上必须 link `me-shared-cron-secret` 环境变量组，否则每次
 *    401 静默失败 —— 上一个踩这个坑的 cron 哑了 51 天，`daily-cron-digest` 只报
 *    「失败」不报「没跑」。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { syncClientMetaLeads, type MetaLeadsSyncClient } from '@/lib/meta/leads-sync'
import { abandonAfterMs } from '@/lib/cron/expected-duration'
import { startCronRun } from '@/lib/cron/run-logger'
import { claimMetaLeadsSyncRun, type RunningLeadSync } from '@/lib/meta/leads-sync-lock'
import { buildLeadsSyncReceipts, summariseSyncProblems } from '@/lib/meta/leads-sync-alert'
import {
  probeAllAccountStatuses,
  probeBudgetFromDeadline,
  type AccountStatusProbeSummary,
} from '@/lib/ads-strategy/portfolio/account-status-probe'

// 一个客户可能有多个表单，每个表单还要翻页；给足时间。
export const maxDuration = 600

async function listRunningLeadSyncs(): Promise<{ rows: RunningLeadSync[]; readError: string | null }> {
  const since = new Date(Date.now() - abandonAfterMs('meta-leads-sync')).toISOString()
  const { data, error } = await supabaseAdmin
    .from('cron_run_logs')
    .select('id, started_at')
    .eq('job_name', 'meta-leads-sync')
    .eq('status', 'running')
    .gte('started_at', since)
  if (error) return { rows: [], readError: error.message }
  const rows: RunningLeadSync[] = []
  for (const raw of data ?? []) {
    const row = raw as { id?: unknown; started_at?: unknown }
    if (typeof row.id === 'string' && typeof row.started_at === 'string') {
      rows.push({ id: row.id, startedAt: row.started_at })
    }
  }
  return { rows, readError: null }
}

async function releaseRunningLeadSync(id: string): Promise<string | null> {
  const { error } = await supabaseAdmin
    .from('cron_run_logs')
    .delete()
    .eq('id', id)
    .eq('job_name', 'meta-leads-sync')
    .eq('status', 'running')
  return error ? error.message : null
}

async function run(): Promise<NextResponse> {
  // 整轮共享截止时间：线索同步和探测共用 maxDuration，探测只能用剩下的（并为回执预留时间）。
  const nowMs = Date.now()
  const routeDeadlineMs = nowMs + maxDuration * 1000
  const claim = await claimMetaLeadsSyncRun({
    now: new Date(nowMs),
    freshForMs: abandonAfterMs('meta-leads-sync'),
    listRunning: listRunningLeadSyncs,
    release: releaseRunningLeadSync,
    start: async () => startCronRun('meta-leads-sync'),
  })
  if (!claim.proceed) {
    return NextResponse.json({ ok: true, skipped: 'overlap', activeRunId: claim.activeRunId })
  }
  const cronRun = { finish: claim.finish }

  const { data: clients, error } = await supabaseAdmin
    .from('clients')
    .select('id, name, facebook_page_id, country, semrush_db')
    .not('facebook_page_id', 'is', null)

  if (error) {
    await cronRun.finish({ error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const results = []
  for (const client of (clients ?? []) as MetaLeadsSyncClient[]) {
    // syncClientMetaLeads 自己吞异常，这层 try 给它之外的意外兜底：
    // 一个客户炸掉不能让其它客户今天都不同步。
    try {
      results.push(await syncClientMetaLeads(client))
    } catch (err) {
      results.push({
        clientId: client.id,
        clientName: client.name,
        forms: 0,
        leadsFetched: 0,
        leadsIngested: 0,
        newContacts: 0,
        skippedNoIdentity: 0,
        failed: 0,
        mailchimp: {},
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  // 顺带探一遍广告账户状态（只读 Meta、只写账户级快照）。跟着本任务走，最坏大约 30 分钟读到一次。
  // 探测自己吞异常；它出什么事都不能影响线索同步的结论。
  const probeBudgetMs = probeBudgetFromDeadline(routeDeadlineMs)
  const accountStatusProbe: AccountStatusProbeSummary =
    probeBudgetMs > 0
      ? await probeAllAccountStatuses(new Date(), probeBudgetMs)
      : {
          clients: 0, accounts: 0, written: 0, unchanged: 0, failed: 0, rateLimited: 0,
          timedOut: true, results: [],
          error: 'accountStatusProbe skipped: lead sync used up the shared time budget',
        }

  const newContacts = results.reduce((n, r) => n + r.newContacts, 0)
  const leadsIngested = results.reduce((n, r) => n + r.leadsIngested, 0)
  // 逐客户回执：三态（ok / blocked / failed），PM todo 检测器和日报都读它。
  const receipts = buildLeadsSyncReceipts(results)
  // 语义固定：**取不到线索的客户数**。Mailchimp 出口把人丢了不算在内 —— 那些人
  // 已经进了 CRM，把整个客户标成 failed 是过度告警。出口的问题走 error_message
  // 单独成句（`summariseSyncProblems`），日报里两类病分得开。
  //
  // `blocked` 的客户（Facebook 授权过期 / 主页绑定未验证）也不算 failed：它们
  // 各有自己的 PM todo 盯着，不该把整轮跑标成失败。results 里仍然带着它们，
  // 供 PM todo 检测器使用。
  const failed = receipts.filter((x) => x.state === 'failed').length
  const blocked = receipts.filter((x) => x.state === 'blocked').length

  // Mailchimp 出口的全局分布。摊平成一层是为了在 summary 顶层一眼看见
  // 「这一轮有多少条压根没进邮件名单、卡在哪个 reason 上」—— 逐客户的明细
  // 仍在 results 里。此前这层结果被整个丢掉，出口连着几周 100% skip 也无人知晓。
  const mailchimp: Record<string, number> = {}
  for (const r of results) {
    for (const [k, n] of Object.entries(r.mailchimp ?? {})) mailchimp[k] = (mailchimp[k] ?? 0) + n
  }

  await cronRun.finish({
    processed: results.length,
    completed: results.length - failed - blocked,
    failed,
    summary: { newContacts, leadsIngested, mailchimp, blocked, receipts, results, accountStatusProbe },
    // 有客户取不到数就必须把原话带进 error_message —— 日报邮件的「错误原因」列
    // 读的就是这个字段。2026-08-21~08-30 这里一直是 null,于是日报每天照发
    // 「meta-leads-sync 4 failed —」,一屏破折号没有一个字说明是什么事,
    // 9 天没人看得懂,4 个客户的线索管道全程断供(CTS 一家漏 45 条、NZ$736)。
    // 真正的报错当时就躺在 summary 里,只是没人把它搬到人看得见的地方。
    //
    // 「线索进来了但没进邮件名单」也从这里出。日报只捞 `failed_count > 0 ||
    // status = 'failed'` 的跑,而 finish() 见到 error 才会把 status 标成
    // failed —— 只有出口坏掉(failed_count = 0)时,这一句就是这次跑能不能被
    // 日报看见的唯一开关。
    error: summariseSyncProblems(results),
  })

  return NextResponse.json({
    ok: true,
    clients: results.length,
    newContacts,
    leadsIngested,
    mailchimp,
    blocked,
    receipts,
    results,
    accountStatusProbe,
  })
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run()
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return run()
}
