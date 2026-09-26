/**
 * 手动跑一轮"从历史对话提炼接待风格/标准应对"——只针对 CTS，PM 拍板"现在就要
 * 真的跑一遍看结果"（2026-09-15，issue #1760）。
 *
 * `runStylePatternMining()`（`src/lib/knowledge/style-mining.ts`）目前没有任何
 * 调用方——没有 API 路由、没有 UI 按钮、没有定时任务（这是 issue #1760 自己的
 * 明确范围："先跑通一次性提炼的手动流程，不用同时处理自动定期重新提炼"）。这个
 * 脚本就是那唯一的手动触发口，跟 `run-ai-auto-review-nal-once.ts` 同一个存在
 * 理由：核心函数本身不含任何 HTTP 层鉴权代码（鉴权只会长在未来某个 route.ts
 * 包装层里，这次不建那层包装），跑脚本不等于绕过了任何业务安全闸——
 * `runStylePatternMining` 写库时强制 `status: 'candidate'`，`standard_response`
 * 类别强制过 `detectSensitivity()`，`tone` 类别强制 `sensitivity: 'general'`，
 * 这些闸都在核心函数里，原样生效。
 *
 * 产出**不会**自动生效：写进 `client_knowledge_facts` 的都是 `status='candidate'`，
 * 要走现成的 FDE 审核页（`/dashboard/clients/[id]/knowledge`，issue #1646）逐条
 * 批准/拒绝之后才会真正被 `getClientKnowledge()` 读到、喂给 AI 客服。
 *
 * 用主库 service-role 凭据 + 真实调用 Anthropic API（花费很小——整个函数只有
 * 一次模型调用，见 style-mining.ts 头注释），不是 dry-run，会真的写库。
 *
 * 运行：
 *   cd <worktree 根>
 *   npx tsx scripts/run-style-mining-cts-once.ts
 */

import { createClient } from '@supabase/supabase-js'
import { runStylePatternMining } from '../src/lib/knowledge/style-mining'

const CTS_CLIENT_ID = 'c0000000-0000-0000-0000-000000000000'

// CTS 目前全部历史消息约 3600 条（722 段对话）——maxMessages 留够余量一次读全。
// maxSpendUsd 只是这次跑的花费硬顶，不是预期花费：函数本身只做一次模型调用
// （最多 30 条模板打包进一个 prompt），真实花费预计远低于这个数字。
const BUDGET = { maxMessages: 5000, maxSpendUsd: 1 }

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('缺少 NEXT_PUBLIC_SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY（.env.local 里应该有）')
  }
  // runStylePatternMining 内部直接 import `@/lib/supabase` 的 `supabaseAdmin`
  // 单例（同一个 service-role 客户端），这里另建一个客户端只是为了在打印结果前
  // 补查一次候选详情，不是给核心函数用的。
  const supabase = createClient(url, serviceKey)

  const receipt = await runStylePatternMining(CTS_CLIENT_ID, BUDGET)
  console.log('=== runStylePatternMining 回执 ===')
  console.log(JSON.stringify(receipt, null, 2))

  if (receipt.status !== 'succeeded' || receipt.patternsWritten === 0) {
    console.log('\n没有新写入的候选（可能是没有符合条件的重复模板，或本次调用与之前的 request_id 撞车被判定为已跑过）。')
    return
  }

  // 把这次新写入的候选原样列出来，方便 PM/FDE 不用自己去数据库里翻。
  const { data: rows, error } = await supabase
    .from('client_knowledge_facts')
    .select('id, fact_key, statement, sensitivity, status, evidence, created_at')
    .eq('client_id', CTS_CLIENT_ID)
    .eq('source_kind', 'conversation_mining_style')
    .order('created_at', { ascending: false })
    .limit(receipt.patternsWritten)

  if (error) {
    console.error('候选详情查询失败（写入本身已成功，只是这里没能打印详情）：', error.message)
    return
  }

  console.log(`\n=== 本次新写入的 ${rows?.length ?? 0} 条候选（status 都是 candidate，需人工审核）===\n`)
  for (const row of rows ?? []) {
    console.log(`【${row.fact_key}】敏感级别=${row.sensitivity}`)
    console.log(`  内容：${row.statement}`)
    console.log(`  依据（evidence）：${JSON.stringify(row.evidence)}`)
    console.log('')
  }
  console.log(`审核入口：/dashboard/clients/${CTS_CLIENT_ID}/knowledge`)
}

main().catch((e) => {
  console.error('运行失败：', e)
  process.exit(1)
})
