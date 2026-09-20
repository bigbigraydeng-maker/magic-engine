/**
 * GET/POST /api/cron/meta-leads-sync
 *
 * 每小时把 Facebook 即时表单里的新人搬进 CRM。
 *
 * 在这之前这条路**只有人手一条**：导 CSV → 跑 `scripts/import-cts-fb-leads.ts`。
 * 2026-07-30 查 CTS 的实测后果：CRM 里最后一个新人停在 7/25，Meta 后台 7/26–7/30
 * 又进了 27 个人，销售的「今天该联系谁」里一个都没有。这个 cron 就是把那条断掉的
 * 管道接上。
 *
 * 开关：`clients.facebook_page_id` 有值的客户才同步（跟私信同步同一个开关）。
 *
 * 整轮 status 的语义（2026-09-20 改）：**只反映这一轮有没有系统性故障**。
 * 个别客户的授权缺口（令牌被拒 / 缺主页权限 / 绑定没核实）不再染红整条任务 ——
 * 它们重跑不会好，只有人动手才会好，所以改走每日待办一家一条地点名。
 * 判据和实测背景见 `lib/meta/leads-sync-blocker.ts` 与 `leads-sync-alert.ts`。
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
import {
  syncClientMetaLeads,
  type MetaLeadsSyncClient,
  type MetaLeadsSyncResult,
} from '@/lib/meta/leads-sync'
import { startCronRun } from '@/lib/cron/run-logger'
import { summariseBlocked, summariseSyncProblems } from '@/lib/meta/leads-sync-alert'

// 一个客户可能有多个表单，每个表单还要翻页；给足时间。
export const maxDuration = 600

async function run(): Promise<NextResponse> {
  const cronRun = await startCronRun('meta-leads-sync')

  const { data: clients, error } = await supabaseAdmin
    .from('clients')
    .select('id, name, facebook_page_id, country, semrush_db')
    .not('facebook_page_id', 'is', null)

  if (error) {
    await cronRun.finish({ error: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 显式标类型：兜底那支 push 的对象没有 blocked / skipped，不标就被推成一个
  // 缺字段的联合类型，下面按 blocked 分流会编不过。
  const results: MetaLeadsSyncResult[] = []
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

  const newContacts = results.reduce((n, r) => n + r.newContacts, 0)
  const leadsIngested = results.reduce((n, r) => n + r.leadsIngested, 0)
  // 语义固定：**这一轮取不到线索、而且重跑有可能好的客户数**。两类刻意不算在内：
  //   · Mailchimp 出口把人丢了 —— 那些人已经进了 CRM，标 failed 是过度告警。
  //     出口的问题走 error_message 单独成句（`summariseSyncProblems`），日报里
  //     两类病分得开。
  //   · 授权缺口（`blocked`：令牌被拒 / 缺主页权限 / 绑定没核实）—— 重跑一万次
  //     也一样，只有人动手才会好。算进来就等于把这条任务钉死在红色上：
  //     2026-09-18~09-20 实测 3 家卡在授权上，26 小时 13 次跑全红，于是正常的
  //     2 家（含 CTS Tours NZ）真断供时，日检和按 status 的报警分不出区别。
  //     这几家改由每日待办逐个点名（`pm-todo/leads-sync-blocked-items.ts`）。
  const failed = results.filter((r) => r.error && !r.blocked).length
  const blocked = results.filter((r) => r.blocked)

  // Mailchimp 出口的全局分布。摊平成一层是为了在 summary 顶层一眼看见
  // 「这一轮有多少条压根没进邮件名单、卡在哪个 reason 上」—— 逐客户的明细
  // 仍在 results 里。此前这层结果被整个丢掉，出口连着几周 100% skip 也无人知晓。
  const mailchimp: Record<string, number> = {}
  for (const r of results) {
    for (const [k, n] of Object.entries(r.mailchimp ?? {})) mailchimp[k] = (mailchimp[k] ?? 0) + n
  }

  await cronRun.finish({
    processed: results.length,
    completed: results.length - failed - blocked.length,
    failed,
    // `blocked` / `blockedSummary` 是**给人追查用的**，不参与告警条件 ——
    // 告警那一路走每日待办，一家一条、带着「点哪里」和直达链接。
    summary: {
      newContacts,
      leadsIngested,
      mailchimp,
      blocked: blocked.length,
      blockedSummary: summariseBlocked(results) ?? null,
      results,
    },
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
    //
    // 🔴 反过来也要守住：授权缺口**不从这里出**（见 summariseSyncProblems），
    // 否则这一句每轮都非空、status 每轮都 failed，这条任务就永远是红的。
    // 唯一的例外是一家跑通的都不剩 —— 那是系统性故障，必须当天红。
    error: summariseSyncProblems(results),
  })

  return NextResponse.json({
    ok: true,
    clients: results.length,
    newContacts,
    leadsIngested,
    blocked: blocked.length,
    mailchimp,
    results,
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
