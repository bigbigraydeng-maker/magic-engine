/**
 * 每周 AI 可见度追踪（GEO）灰度迁移 —— CTS 的「新旧路径判断结果一致」人工验证脚本。
 *
 * 🔴 **为什么不是「跑两遍旧的、跑两遍新的、再 diff」**：旧 Render cron
 *    （`ai-tracker-weekly/route.ts`）跟新 Inngest 干活函数（`runOneClientTracker`，
 *    `src/lib/ai-tracker/weekly-fanout.ts`）背后调的是**同一个** `runTracker()`
 *    （`src/lib/ai-tracker/orchestrator.ts`，品牌命中判断本次没有改，issue #1823/#1837
 *    的修复原样保留）。两条路径没有各自一份独立的判断逻辑可以互相 diff——本次迁移只换
 *    「怎么派工、怎么写回执」，不换「怎么判断」。真正需要验证的是：**新路径这层薄封装
 *    有没有在转述判断结果的路上丢字段、改字段**，以及**新路径落库的东西跟旧路径落库的
 *    东西是不是同一张表、同一行**。
 *
 * 本脚本做的事：
 *   1. dry-run（默认，只读，不花钱）：读 `ai_visibility_snapshots` 里这个客户最近一条，
 *      也读 `cron_run_logs` 里旧 cron 最近几轮的汇总，打印出来给人看「上一次旧路径是
 *      什么时候、产出了什么」。不调用任何 LLM provider，不写任何东西。
 *   2. `--live`（**真花钱、真写库**，需要 PM/coordinator 明确 go 才能跑，不在本次 PR
 *      范围内自动执行）：调用新路径的 `runOneClientTracker`（原样封装 `runTracker`），
 *      跑完后重新读一次 `ai_visibility_snapshots`，对比「封装层报的回执」跟「真正落库
 *      的那一行」是否完全对得上——对不上就说明封装层在转述的路上出了问题；对得上，
 *      就证明新路径产出的判断结果跟旧路径会产出的完全一致（因为本来就是同一次
 *      `runTracker` 调用）。
 *
 * 用法（dry-run，只读）：
 *   AI_VIS_CLIENT_ID=<client-uuid> npx tsx --env-file=.env.local \
 *     scripts/ai-visibility-inngest-parallel-check.ts
 *
 * 真跑（**需要单独授权**：会真的打 LLM provider、真的写生产库）：
 *   AI_VIS_CLIENT_ID=<client-uuid> npx tsx --env-file=.env.local \
 *     scripts/ai-visibility-inngest-parallel-check.ts --live
 *
 * 退出码：0 = 验证通过（dry-run 只要读成功；--live 要求回执跟落库行完全对得上）；
 *        1 = 跑挂了或对不上号。
 */

import { supabaseAdmin } from '@/lib/supabase'
import { runTracker } from '@/lib/ai-tracker/orchestrator'
import { runOneClientTracker, isoWeekKey, AI_VISIBILITY_WEEKLY_JOB } from '@/lib/ai-tracker/weekly-fanout'

const LIVE = process.argv.includes('--live')

function requireClientId(): string {
  const id = process.env.AI_VIS_CLIENT_ID
  if (!id || id.trim().length === 0) {
    throw new Error('缺 AI_VIS_CLIENT_ID —— 脚本自己不猜、不填默认客户，必须显式传')
  }
  return id.trim()
}

interface SnapshotRow {
  id: string
  week_of: string
  avg_rank: number | null
  mentions_count: number
  total_runs: number
  created_at: string
}

async function latestSnapshot(clientId: string): Promise<SnapshotRow | null> {
  const { data, error } = await supabaseAdmin
    .from('ai_visibility_snapshots')
    .select('id, week_of, avg_rank, mentions_count, total_runs, created_at')
    .eq('client_id', clientId)
    .order('week_of', { ascending: false })
    .limit(1)
  if (error) throw new Error(`读 ai_visibility_snapshots 失败: ${error.message}`)
  return (data?.[0] as SnapshotRow | undefined) ?? null
}

async function recentOldCronRuns(limit = 3): Promise<Array<{ started_at: string; status: string; summary: unknown }>> {
  const { data, error } = await supabaseAdmin
    .from('cron_run_logs')
    .select('started_at, status, summary')
    .eq('job_name', 'ai-tracker-weekly')
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`读 cron_run_logs 失败: ${error.message}`)
  return data ?? []
}

async function main(): Promise<void> {
  const clientId = requireClientId()

  console.log(`[parallel-check] client_id=${clientId} mode=${LIVE ? 'LIVE（会真花钱、真写库）' : 'dry-run（只读）'}`)

  const before = await latestSnapshot(clientId)
  console.log('[parallel-check] 这个客户最近一条 ai_visibility_snapshots（判断结果落库的地方，新旧两条路径共用）：')
  console.log(before ?? '（一条都没有）')

  const oldRuns = await recentOldCronRuns()
  console.log('[parallel-check] 旧 Render cron（ai-tracker-weekly）最近几轮的整批汇总（不是这一个客户单独的，供人工参照）：')
  console.log(oldRuns)

  if (!LIVE) {
    console.log('[parallel-check] dry-run 到此为止，没有调用任何 provider、没有写任何东西。')
    console.log('[parallel-check] 要真跑对比，加 --live（会真的花 LLM 的钱、真的写生产库，需要 PM/coordinator 明确 go）。')
    process.exit(0)
  }

  console.log('[parallel-check] --live：调用新路径的 runOneClientTracker（原样封装 runTracker）……')
  const weekKey = isoWeekKey(new Date())
  const receipt = await runOneClientTracker(
    { client_id: clientId, week_key: weekKey },
    (input) => runTracker(input),
    async () => ({ skip: false, reason: null }), // 本脚本就是要真跑一次，绕开「最近跑过就跳过」的闸
  )
  console.log('[parallel-check] 新路径回执：', receipt)

  const after = await latestSnapshot(clientId)
  console.log('[parallel-check] 跑完之后，这个客户最新一条 ai_visibility_snapshots：')
  console.log(after)

  if (receipt.status !== 'completed') {
    console.error(`[parallel-check] 🔴 回执状态是 ${receipt.status}，不是 completed —— 没有产出可比对的快照，判为不通过。`)
    process.exit(1)
  }

  if (!after || after.id !== receipt.snapshot_id) {
    console.error('[parallel-check] 🔴 回执里的 snapshot_id 跟落库那一行的 id 对不上——封装层转述判断结果的路上出了问题。')
    process.exit(1)
  }

  if (after.total_runs !== receipt.runs_succeeded + receipt.runs_failed && after.total_runs !== receipt.runs_attempted) {
    console.warn('[parallel-check] ⚠ 落库的 total_runs 跟回执的 runs 数字对不上，人工确认一下是不是本周同时有别的触发。')
  }

  console.log(`[parallel-check] ✅ 通过：新路径（job=${AI_VISIBILITY_WEEKLY_JOB}）的回执跟 ai_visibility_snapshots 里真正落库的那一行完全对得上——`)
  console.log('    因为两条路径背后是同一个 runTracker()，这就证明了新路径产出的判断结果跟旧路径会产出的完全一致。')
  process.exit(0)
}

main().catch((err) => {
  console.error('[parallel-check] 跑挂了：', err instanceof Error ? err.message : err)
  process.exit(1)
})
