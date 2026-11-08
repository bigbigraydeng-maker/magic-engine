/**
 * POST /api/admin/agent-learning/trial/auto
 * 让 AI 把所有"未启用、在试验名单内、还没有结论"的经验各自动试一遍并给出结论。
 * 结论只写进这条经验的 evidence.ai_verdict；绝不修改 is_active（启用仍是 Ray 单独的手动动作）。
 * 花费走同一个持久化日账本（1 美元/天）；额度用完立即停止。无请求参数。
 */
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { createDeepSeekClient } from '@/lib/agent-learning/llm/deepseek-client'
import { trialSampleFor } from '@/lib/agent-learning/lesson-trial/eligibility'
import { autoJudgeLesson } from '@/lib/agent-learning/lesson-trial/auto-judge'
import { createRpcTrialStore, type RpcFn } from '@/lib/agent-learning/lesson-trial/spend-store'

/** 一次请求最多处理几条，避免超时；剩下的再点一次 */
const MAX_PER_REQUEST = 8
const MIN_INTERVAL_MS = 30_000
let lastRun = 0

interface PendingRow {
  lesson_key: string
  lesson: string
  evidence: Record<string, unknown> | null
}

export async function POST() {
  const guard = await guardGlobalAdmin()
  if (guard) return guard
  const nowMs = Date.now()
  if (nowMs - lastRun < MIN_INTERVAL_MS) {
    return NextResponse.json({ success: false, error: '请求太频繁，请稍后再试' }, { status: 429 })
  }
  lastRun = nowMs

  const llm = createDeepSeekClient()
  if (!llm.ok) return NextResponse.json({ success: false, error: '模型未配置' }, { status: 503 })

  const { data, error } = await supabaseAdmin
    .from('global_learned_lessons')
    .select('lesson_key, lesson, evidence')
    .eq('is_active', false)
  if (error) return NextResponse.json({ success: false, error: '读取经验失败' }, { status: 500 })

  const pending = ((data ?? []) as PendingRow[]).filter(
    (r) => trialSampleFor(r.lesson_key, r.evidence?.kind) && !r.evidence?.ai_verdict,
  )
  const batch = pending.slice(0, MAX_PER_REQUEST)

  const store = createRpcTrialStore(
    ((fn: string, args: Record<string, unknown>) => supabaseAdmin.rpc(fn, args)) as unknown as RpcFn,
  )
  let judged = 0
  let failed = 0
  let budgetUsedUp = false
  for (const row of batch) {
    const sample = trialSampleFor(row.lesson_key, row.evidence?.kind)
    if (!sample) continue
    const result = await autoJudgeLesson({ llm: llm.value, store, now: () => new Date() }, { sample, lesson: row.lesson })
    if (!result.ok) {
      if (result.code === 'gate_blocked') {
        budgetUsedUp = true
        break
      }
      failed += 1
      continue
    }
    // 只写 evidence；is_active 过滤是为了不覆盖期间被手动启用的经验的状态
    const { error: upErr } = await supabaseAdmin
      .from('global_learned_lessons')
      .update({ evidence: { ...(row.evidence ?? {}), ai_verdict: result.value } })
      .eq('lesson_key', row.lesson_key)
      .eq('is_active', false)
    if (upErr) failed += 1
    else judged += 1
  }

  return NextResponse.json({
    success: true,
    judged,
    failed,
    remaining: Math.max(pending.length - judged - failed, 0),
    budgetUsedUp,
  })
}
