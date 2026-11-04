/**
 * POST /api/admin/agent-learning/trial  { lessonKey }
 * 经验对照试验：固定虚构样例，没有 / 有这条经验各让模型出一次建议。
 * 只读经验表；不改 is_active；花费走持久化日账本（1 美元/天，先预留后结算）。
 * GET：今天已花多少、对照几次。
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { createDeepSeekClient } from '@/lib/agent-learning/llm/deepseek-client'
import { trialSampleFor } from '@/lib/agent-learning/lesson-trial/eligibility'
import { runTrial, TRIAL_DAILY_USD_CAP } from '@/lib/agent-learning/lesson-trial/run-trial'
import { SAMPLES, SAMPLE_NOTE } from '@/lib/agent-learning/lesson-trial/samples'
import { createRpcTrialStore, utcDay, type RpcFn } from '@/lib/agent-learning/lesson-trial/spend-store'

const RATE_LIMIT_PER_HOUR = 30
const hits: number[] = []

/** 单实例内存限流；真正的花费上限在库里的日账本 */
function rateLimited(now: number): boolean {
  while (hits.length > 0 && now - hits[0] > 3_600_000) hits.shift()
  if (hits.length >= RATE_LIMIT_PER_HOUR) return true
  hits.push(now)
  return false
}

async function spendStatus() {
  const { data, error } = await supabaseAdmin
    .from('agent_learning_trial_spend')
    .select('reserved_usd, spent_usd, comparisons')
    .eq('day', utcDay(new Date()))
    .maybeSingle()
  if (error) return null
  return {
    usedUsd: Number(data?.reserved_usd ?? 0) + Number(data?.spent_usd ?? 0),
    comparisons: Number(data?.comparisons ?? 0),
    capUsd: TRIAL_DAILY_USD_CAP,
  }
}

export async function GET() {
  const guard = await guardGlobalAdmin()
  if (guard) return guard
  return NextResponse.json({ success: true, spend: await spendStatus() })
}

export async function POST(req: NextRequest) {
  const guard = await guardGlobalAdmin()
  if (guard) return guard
  if (rateLimited(Date.now())) {
    return NextResponse.json({ success: false, error: '请求太频繁，请稍后再试' }, { status: 429 })
  }

  const body = (await req.json().catch(() => ({}))) as { lessonKey?: unknown }
  if (typeof body.lessonKey !== 'string' || !body.lessonKey) {
    return NextResponse.json({ success: false, error: 'lessonKey required' }, { status: 400 })
  }

  const { data: row } = await supabaseAdmin
    .from('global_learned_lessons')
    .select('lesson, evidence')
    .eq('lesson_key', body.lessonKey)
    .maybeSingle()
  if (!row) return NextResponse.json({ success: false, error: 'lesson not found' }, { status: 404 })

  const kind = (row.evidence as { kind?: unknown } | null)?.kind
  const sample = trialSampleFor(body.lessonKey, kind)
  if (!sample) return NextResponse.json({ success: false, error: '这条经验不在首批试验名单里' }, { status: 403 })

  const llm = createDeepSeekClient()
  if (!llm.ok) return NextResponse.json({ success: false, error: '模型未配置' }, { status: 503 })

  const store = createRpcTrialStore(
    ((fn: string, args: Record<string, unknown>) => supabaseAdmin.rpc(fn, args)) as unknown as RpcFn,
  )
  const result = await runTrial(
    { llm: llm.value, store, now: () => new Date() },
    { sample, lesson: row.lesson as string },
  )
  if (!result.ok) {
    if (result.code === 'gate_blocked') {
      return NextResponse.json({ success: false, error: '今天的额度用完了', spend: await spendStatus() }, { status: 429 })
    }
    return NextResponse.json({ success: false, error: '这次对照没跑成，请稍后再试' }, { status: 502 })
  }
  return NextResponse.json({
    success: true,
    sampleTitle: SAMPLES[sample].title,
    note: SAMPLE_NOTE,
    without: result.value.without,
    with: result.value.with,
    spend: await spendStatus(),
  })
}
