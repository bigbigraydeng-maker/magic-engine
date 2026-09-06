/**
 * GET /api/cron/meta-auth-health
 *
 * 每天体检一遍所有活跃客户的 Meta（Facebook 主页）授权，把结果写进运行记录。
 * 下发给人的那一步在 `src/lib/pm-todo/meta-auth-health-items.ts`，读的就是这里
 * 写下的 summary —— 跟 `social-comment-autoreply` → `comment-scope-items` 同一个套路：
 * 说的话跟机器真做的事永远一致，也不用再问一遍 Meta。
 *
 * ## 为什么是「所有活跃客户」而不是写死 CTS
 *
 * 触发这件事的是 CTS（它的手工令牌 60 天一到期就把发帖和线索同步一起带下去），
 * 但把客户名写进共享代码就是把平台退化成客户特供系统（铁律 0）。这里按
 * 「活跃 + 档案里登记了 Facebook 主页」筛选，CTS 只是其中一个，别的客户自动同样受益。
 *
 * ## 排班
 *
 * `0 19 * * *` UTC。NZ 冬令时 NZST = UTC+12，所以 UTC 19:00 = **次日** NZ 07:00；
 * 夏令时 NZDT = UTC+13 时落在 NZ 08:00。两季都在「今日待办」那封信之前跑完，
 * 这样当天的清单读到的是当天的体检结果，而不是昨天的。见 render.yaml。
 *
 * ## 不做的事
 *
 * 不刷新令牌、不改授权记录、不发布任何内容、不碰 Google / 微软 / TikTok。
 * 全程只读 —— 唯一的写操作是往 `cron_run_logs` 记这一趟自己的结果。
 *
 * Auth: Bearer ${CRON_SECRET}，跟其它所有 cron 路由一致。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { loadActiveClients } from '@/lib/pm-todo/client-roster'
import { fetchAll } from '@/lib/supabase-paginate'
import { checkMetaAuth, needsHuman, type MetaAuthHealth } from '@/lib/meta/auth-health'

export const maxDuration = 300

/** 一个客户一次 Graph 调用，串行也够快；并发只会更容易撞 Meta 的限流。 */
async function checkAll(
  clients: Array<{ id: string; domain: string | null; page_id: string | null }>,
  now: Date,
): Promise<MetaAuthHealth[]> {
  const results: MetaAuthHealth[] = []
  for (const c of clients) {
    // 一个客户炸了不许带崩整趟 —— 但也绝不能当成「这个客户没问题」，
    // 所以塞一条 unknown 进去（fail-closed），让它照样进待办。
    try {
      results.push(
        await checkMetaAuth(supabaseAdmin, { clientId: c.id, pageId: c.page_id, domain: c.domain }, { now }),
      )
    } catch (e) {
      results.push({
        client_id: c.id,
        page_id: c.page_id,
        state: 'unknown',
        token_source: 'none',
        granted_scopes: null,
        missing_scopes: [],
        connection_status: null,
        provider_error: `体检本身出错：${e instanceof Error ? e.message : String(e)}`,
        checked_at: now.toISOString(),
      })
    }
  }
  return results
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'Server misconfiguration: CRON_SECRET not set' }, { status: 500 })
  }
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date()
  const run = await startCronRun('meta-auth-health')

  try {
    const { clients, error } = await loadActiveClients(supabaseAdmin)
    // 名单读不出来 ≠ 一个客户都没有。混成一路的话，一次读库失败会显示成
    // 「今天所有客户的授权都好」—— 正是这个功能要消灭的那种假象。
    if (error) {
      await run.finish({ failed: 1, error: `读不出客户名单：${error.message}` })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    if (clients.size === 0) {
      await run.finish({ processed: 0, completed: 0, failed: 0, summary: { clients: 0, results: [] } })
      return NextResponse.json({ ok: true, clients: 0 })
    }

    const ids = Array.from(clients.keys())

    // 主页 ID 必须按 client_id 一一对上。分页读全（PostgREST 单次 1000 行且不报错），
    // 排序唯一否则翻页会重复或漏行。
    const pageRows = await fetchAll<{ id: string; facebook_page_id: string | null }>((from, to) =>
      supabaseAdmin
        .from('clients')
        .select('id, facebook_page_id')
        .in('id', ids)
        .order('id', { ascending: true })
        .range(from, to),
    )
    const pageOf = new Map(pageRows.map((r) => [r.id, r.facebook_page_id ?? null]))

    const targets = ids.map((id) => ({
      id,
      domain: clients.get(id)?.domain ?? null,
      page_id: pageOf.get(id) ?? null,
    }))

    const results = await checkAll(targets, now)

    const withPage = results.filter((r) => r.state !== 'no_page')
    const problems = results.filter(needsHuman)
    const unknown = results.filter((r) => r.state === 'unknown')

    await run.finish({
      processed: withPage.length,
      completed: withPage.length - problems.length,
      failed: problems.length,
      // 问不到 Meta 的那些单独记一句：整趟「零个问题」和「问不到所以看不见问题」
      // 在监控上必须长得不一样。
      error: unknown.length > 0 ? `${unknown.length} 个客户的 Meta 授权问不出状态` : undefined,
      summary: {
        clients: ids.length,
        checked: withPage.length,
        ok: withPage.length - problems.length,
        problems: problems.length,
        unknown: unknown.length,
        // 待办那边读的就是这个数组 —— 改字段名前先看 meta-auth-health-items.ts。
        results,
      },
    })

    return NextResponse.json({
      ok: true,
      clients: ids.length,
      checked: withPage.length,
      problems: problems.length,
      unknown: unknown.length,
    })
  } catch (err) {
    // 🔴 抛出去的话 startCronRun 插的那行会永远停在「在跑」，健康检查分不清
    //    「崩了」和「还在跑」，这条通道会静默死掉。
    const message = err instanceof Error ? err.message : String(err)
    await run.finish({ failed: 1, error: `Meta 授权体检整趟失败：${message}` })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
