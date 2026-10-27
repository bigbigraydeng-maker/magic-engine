/**
 * POST /api/admin/agent-learning/trial  { lessonKey }
 * 开/关对照试验：同一份固定虚构样例，带/不带这条经验各问 DeepSeek 一次。
 * 只读经验表（不改 is_active、不写库）；花费走进程内存账本，每天 1 美元硬上限。
 * GET 只返回今天的额度状态。
 */
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { createDeepSeekClient } from '@/lib/agent-learning/llm/deepseek-client'
import { isTrialEligible, trialSampleKind } from '@/lib/agent-learning/lesson-trial/eligible'
import { runTrial } from '@/lib/agent-learning/lesson-trial/run-trial'
import { getTrialLedger, trialStatus } from '@/lib/agent-learning/lesson-trial/trial-budget'

const RATE_LIMIT = 30
const RATE_WINDOW_MS = 60 * 60 * 1000
/** 单实例内存限流，多实例下只是近似。 */
let hits: number[] = []

function rateLimited(now: number): boolean {
  hits = hits.filter((t) => now - t < RATE_WINDOW_MS)
  if (hits.length >= RATE_LIMIT) return true
  hits.push(now)
  return false
}

export async function GET() {
  const guard = await guardGlobalAdmin()
  if (guard) return guard
  return NextResponse.json({ success: true, status: trialStatus(getTrialLedger(), new Date()) })
}

export async function POST(req: NextRequest) {
  const guard = await guardGlobalAdmin()
  if (guard) return guard

  const body = (await req.json().catch(() => ({}))) as { lessonKey?: unknown }
  const key = body.lessonKey
  if (typeof key !== 'string' || !key) {
    return NextResponse.json({ success: false, error: 'lessonKey required' }, { status: 400 })
  }
  const kind = trialSampleKind(key)
  if (!kind) return NextResponse.json({ success: false, error: '这条经验不在试验名单里' }, { status: 403 })

  if (rateLimited(Date.now())) {
    return NextResponse.json({ success: false, error: '请求太频繁，请稍后再试' }, { status: 429 })
  }

  const { data: row } = await supabaseAdmin
    .from('global_learned_lessons')
    .select('lesson, rationale, evidence')
    .eq('lesson_key', key)
    .maybeSingle()
  if (!row) return NextResponse.json({ success: false, error: 'lesson not found' }, { status: 404 })
  if (!isTrialEligible(key, row.evidence as Record<string, unknown> | null)) {
    return NextResponse.json({ success: false, error: '这条经验不在试验名单里' }, { status: 403 })
  }

  const client = createDeepSeekClient()
  if (!client.ok) return NextResponse.json({ success: false, error: '模型暂不可用' }, { status: 503 })

  const ledger = getTrialLedger()
  const now = new Date()
  const result = await runTrial(
    { llm: client.value, ledger, now },
    { lessonKey: key, lesson: row.lesson as string, rationale: (row.rationale as string | null) ?? null, kind },
  )
  const status = trialStatus(ledger, new Date())
  if (!result.ok) {
    if (result.code === 'gate_blocked') {
      return NextResponse.json({ success: false, error: '今天的额度用完了', status }, { status: 429 })
    }
    return NextResponse.json({ success: false, error: '对照没跑成，请稍后再试', status }, { status: 502 })
  }
  return NextResponse.json({ success: true, result: result.value, status })
}
