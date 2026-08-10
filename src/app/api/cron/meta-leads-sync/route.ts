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
 * 2026-08-10 起，每轮开跑前先补一步「自动接主页」：有 Meta 广告账户、却没接主页的
 * 客户，直接问 Graph「你的广告投在哪个主页」，够条件就写进去。Oztop 就是死在这一步 ——
 * 广告账户天天在采、6/24 起攒了 70 条 lead，主页字段是空的，于是这个 cron 连看都
 * 没看它一眼，70 个询价人一个没进 ME。补在这里而不是另开一个 cron，是因为接上的
 * 客户**这一轮就能被下面的同步捞到**，不用等下一个小时。
 *
 * 接不上的（要客户授权 / 投在多个主页上）不静默：结果进 `cron_run_logs`，
 * 并由今日待办转成一句人话下发（pm-todo/manual-items.ts 的 `leads_not_syncing`）。
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
import { autoBindMissingPages } from '@/lib/meta/page-discovery'
import { startCronRun } from '@/lib/cron/run-logger'

// 一个客户可能有多个表单，每个表单还要翻页；给足时间。
export const maxDuration = 600

async function run(): Promise<NextResponse> {
  const cronRun = await startCronRun('meta-leads-sync')

  // 先补「没接主页」的客户 —— 必须在下面那句查询之前，接上的这一轮就算数。
  // 整步失败也不能拦住同步：老客户本来就绑好了，不该被新客户的问题连累。
  const bindings = await autoBindMissingPages(supabaseAdmin).catch((err) => {
    console.error('[meta-leads-sync] 自动接主页整步失败:', err)
    return []
  })

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
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const newContacts = results.reduce((n, r) => n + r.newContacts, 0)
  const leadsIngested = results.reduce((n, r) => n + r.leadsIngested, 0)
  const failed = results.filter((r) => r.error).length

  // 只留「这轮真发生了什么」的那几条：本来就绑好的客户每小时都会被查一遍，
  // 全写进去会让运行记录里全是噪音，真出事那条反而看不见。
  const bindingsOfNote = bindings.filter((b) => b.outcome !== 'already_bound')

  await cronRun.finish({
    processed: results.length,
    completed: results.length - failed,
    failed,
    summary: { newContacts, leadsIngested, results, bindings: bindingsOfNote },
  })

  return NextResponse.json({
    ok: true,
    clients: results.length,
    newContacts,
    leadsIngested,
    results,
    bindings: bindingsOfNote,
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
