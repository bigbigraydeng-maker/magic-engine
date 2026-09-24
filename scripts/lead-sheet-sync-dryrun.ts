/**
 * 线索表格同步 —— 人工试算 / 真跑脚本。
 *
 * 跑的是**线上同一套代码**（`src/lib/lead-sheets/sync.ts`），不是另写一份仿真：
 * 配置从 `client_lead_sheet_routes` 读，线索从 `contact_touchpoints` 读，
 * 目标表格真读一遍。
 *
 * 默认 **dry-run，只读不写**，把「这一轮会往哪张表写哪几行」原样打出来给人看。
 * 加 `--live` 才真写 —— 真写会改客户正在用的表格，需要 PM 明确同意。
 *
 *   npx esbuild scripts/lead-sheet-sync-dryrun.ts --bundle --platform=node \
 *     --format=esm --packages=external --outfile=/tmp/dryrun.mjs
 *   node --env-file=.env.local /tmp/dryrun.mjs <client_id> [--live]
 */

import { supabaseAdmin } from '../src/lib/supabase'
import { readFileSync } from 'node:fs'
import { loadClientRoutes, parseRoute } from '../src/lib/lead-sheets/config'
import { loadLeadsSince } from '../src/lib/lead-sheets/leads'
import { buildRow, emptyNotes } from '../src/lib/lead-sheets/row'
import { pickRoute } from '../src/lib/lead-sheets/route-match'
import { destinationKey, newDestinationSnapshot, syncOneRoute } from '../src/lib/lead-sheets/sync'
import type { DestinationSnapshot } from '../src/lib/lead-sheets/sync'

async function main(): Promise<void> {
  const clientId = process.argv[2]
  const live = process.argv.includes('--live')
  if (!clientId) {
    console.error('用法: node dryrun.mjs <client_id> [--live]')
    process.exit(1)
  }

  const { data: client } = await supabaseAdmin
    .from('clients')
    .select('id, name')
    .eq('id', clientId)
    .maybeSingle<{ id: string; name: string | null }>()

  console.log(`客户: ${client?.name ?? '(查不到名字)'} ${clientId}`)
  console.log(live ? '模式: 🔴 真写（会改客户的表格）' : '模式: 试算，只读不写')

  // `--routes <file.json>` 用于「配置表还没 apply 到生产」时先验：文件里放的是
  // 跟 client_lead_sheet_routes 一模一样的行（本机沙盘跑完 seed SQL 后 dump 出来的），
  // 照样过一遍真正的 parseRoute —— 验的还是线上那套校验，不是另写一份。
  const routesFlagIdx = process.argv.indexOf('--routes')
  let routes, invalid: Array<{ routeKey: string; reason: string }>
  if (routesFlagIdx > 0) {
    const rows = JSON.parse(readFileSync(process.argv[routesFlagIdx + 1], 'utf8'))
    routes = []
    invalid = []
    for (const row of rows) {
      try { routes.push(parseRoute(row)) }
      catch (e) { invalid.push({ routeKey: row.route_key, reason: e instanceof Error ? e.message : String(e) }) }
    }
    console.log(`(配置来自文件 ${process.argv[routesFlagIdx + 1]}，不是生产库)`)
  } else {
    ;({ routes, invalid } = await loadClientRoutes(supabaseAdmin, clientId))
  }
  console.log(`\n配置了 ${routes.length} 条路线；坏掉 ${invalid.length} 条`)
  for (const i of invalid) console.log(`  ❌ ${i.routeKey}: ${i.reason}`)
  for (const r of routes) {
    console.log(
      `  · ${r.routeKey} → ${r.label ?? r.spreadsheetId}/${r.tabName}` +
        ` | 判据=${r.matchAnyAnswerFields.length ? r.matchAnyAnswerFields.join(' 或 ') : '（兜底）'}` +
        ` | 只补 ${r.backfillSince ?? '全部'} 之后`,
    )
  }
  if (routes.length === 0) return

  // 分流全景（不受 backfill 窗口限制），让人看清「库里一共多少条、各去哪」。
  const allLeads = await loadLeadsSince(supabaseAdmin, clientId, null)
  const tally = new Map<string, number>()
  for (const lead of allLeads) {
    const r = pickRoute(lead, routes)
    const k = r?.routeKey ?? '(没有路线可走)'
    tally.set(k, (tally.get(k) ?? 0) + 1)
  }
  console.log(`\n库里共 ${allLeads.length} 条线索，分流结果（不看时间窗口）：`)
  for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`)

  // 逐条路线把「这一轮会写什么」摆出来。
  const receipt = {
    clientId, clientName: client?.name ?? null, unrouted: 0, error: null as string | null,
    routes: [] as Awaited<ReturnType<typeof syncOneRoute>>[],
  }
  const byRoute = new Map<string, typeof allLeads>()
  for (const lead of allLeads) {
    const r = pickRoute(lead, routes)
    if (!r) { receipt.unrouted++; continue }
    const b = byRoute.get(r.routeKey)
    if (b) b.push(lead); else byRoute.set(r.routeKey, [lead])
  }
  // 跟线上同一个写法：同一张表只读一次，判重键在几条路线之间共享 ——
  // 否则试算会把「另一条路线已经收了这个人」重复报成还要写一行。
  const snapshots = new Map<string, DestinationSnapshot>()
  for (const route of routes) {
    const dest = destinationKey(route)
    let snapshot = snapshots.get(dest)
    if (!snapshot) {
      snapshot = newDestinationSnapshot()
      snapshots.set(dest, snapshot)
    }
    receipt.routes.push(
      await syncOneRoute(clientId, route, byRoute.get(route.routeKey) ?? [], { dryRun: !live }, snapshot),
    )
  }

  console.log(`\n${'='.repeat(70)}`)
  for (const r of receipt.routes) {
    console.log(`\n【${r.routeKey}】${r.tabName}  (${r.spreadsheetId})`)
    console.log(`  窗口内 ${r.matched} 条 | 表里已有 ${r.alreadyPresent} | 窗口外没碰 ${r.outsideWindow}`)
    console.log(live ? `  真写进去 ${r.appended} 行` : `  试算：会写 ${r.appendedLeadIds.length} 行`)
    if (r.unmappedValues.length) console.log(`  ⚠️ 没有中文对照、原样写进去的选项: ${r.unmappedValues.join(', ')}`)
    if (r.blankedFields.length) console.log(`  ⚠️ 取不到值、写成空格子的列: ${r.blankedFields.join(', ')}`)
    if (r.error) console.log(`  ❌ ${r.error}`)

    if (r.appendedLeadIds.length > 0) {
      const route = routes.find((x) => x.routeKey === r.routeKey)
      if (route) {
        const ids = new Set(r.appendedLeadIds)
        console.log('  具体这几行：')
        for (const lead of allLeads.filter((l) => ids.has(l.leadId))) {
          console.log(`    ${JSON.stringify(buildRow(lead, route, emptyNotes()))}`)
        }
      }
    }
  }
  if (receipt.unrouted > 0) console.log(`\n⚠️ ${receipt.unrouted} 条线索没有路线可走（缺兜底路线）`)
  if (receipt.error) console.log(`\n❌ 客户级错误: ${receipt.error}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
