/**
 * Team Working Memory — 兜底清扫 cron
 *
 * 干两件事：
 *   1. 补提炼：本机 hook 那一枪没打中（笔记本睡了 / 断网 / 进程被杀）的会话，
 *      在这里补上。没有这一步，"全自动"就会在最不起眼的地方悄悄断掉。
 *   2. 自动收拾：被推翻的教训撤下、连着砸锅的套路下架。
 *      PM 选了「不用我点」，所以收拾也必须是机器自己做。
 *
 * 建议排班：每 30 分钟一次。
 * ⚠️ 在 Render 上新建 cron 时必须手动关联 me-shared-cron-secret 环境变量组，
 *    否则 CRON_SECRET 是空的、每次 401，而且 digest 只报「失败」不报「没跑」，
 *    会像 daily-cron-digest 那样哑掉几十天没人发现。
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { startCronRun } from '@/lib/cron/run-logger'
import { distillSession } from '@/lib/team-memory/distill'
import {
  CONTRADICTION_RETIRE_THRESHOLD,
  SKILL_FAIL_RETIRE_THRESHOLD,
} from '@/lib/team-memory/evidence'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/** 一次最多补提炼几个会话，控制单次时长和花费 */
const MAX_SESSIONS_PER_RUN = 8

export async function POST(req: NextRequest): Promise<NextResponse> {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET 未配置' }, { status: 500 })
  }
  const auth = req.headers.get('authorization')
  const headerSecret = req.headers.get('x-cron-secret')
  if (auth !== `Bearer ${secret}` && headerSecret !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const run = await startCronRun('team-memory-sweeper')
  let distilled = 0
  let failed = 0
  let costUsd = 0

  try {
    const pending = await pendingSessions()
    for (const sessionKey of pending) {
      try {
        const r = await distillSession(sessionKey)
        costUsd += r.cost_usd
        distilled += 1
      } catch (err) {
        failed += 1
        console.error(`[team-memory-sweeper] ${sessionKey} 提炼失败:`, err)
      }
    }

    const retiredLessons = await retireContradictedLessons()
    const retiredSkills = await retireFailingSkills()

    await run.finish({
      processed: pending.length,
      completed: distilled,
      failed,
      summary: {
        distilled,
        retired_lessons: retiredLessons,
        retired_skills: retiredSkills,
        cost_usd: Number(costUsd.toFixed(4)),
      },
    })

    return NextResponse.json({
      distilled,
      failed,
      retired_lessons: retiredLessons,
      retired_skills: retiredSkills,
      cost_usd: Number(costUsd.toFixed(4)),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await run.finish({ processed: 0, completed: distilled, failed, error: msg })
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

async function pendingSessions(): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('work_sessions')
    .select('session_key')
    .eq('status', 'ended')
    .is('distilled_at', null)
    .order('ended_at', { ascending: true })
    .limit(MAX_SESSIONS_PER_RUN)

  return ((data as { session_key: string }[] | null) ?? []).map((r) => r.session_key)
}

/** 被推翻够次数的教训自动撤下 —— 不用 PM 点 */
async function retireContradictedLessons(): Promise<number> {
  const { data } = await supabaseAdmin
    .from('team_lessons')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('is_active', true)
    .gte('contradicted_count', CONTRADICTION_RETIRE_THRESHOLD)
    .select('id')

  return ((data as { id: string }[] | null) ?? []).length
}

/**
 * 套路连着砸锅就下架。
 * 看的是**最近连续**的结果，不是累计 —— 一个用了 50 次成功 48 次的套路
 * 不该因为历史上失败过 2 次就被拿掉。
 */
async function retireFailingSkills(): Promise<number> {
  const { data: skills } = await supabaseAdmin
    .from('team_skills')
    .select('skill_key')
    .eq('status', 'active')
    .gte('fail_count', SKILL_FAIL_RETIRE_THRESHOLD)

  const candidates = ((orEmpty(skills)) as { skill_key: string }[])
  let retired = 0

  for (const { skill_key } of candidates) {
    const { data: runs } = await supabaseAdmin
      .from('team_skill_runs')
      .select('outcome')
      .eq('skill_key', skill_key)
      .order('created_at', { ascending: false })
      .limit(SKILL_FAIL_RETIRE_THRESHOLD)

    const recent = ((orEmpty(runs)) as { outcome: string }[])
    const allFailed =
      recent.length >= SKILL_FAIL_RETIRE_THRESHOLD && recent.every((r) => r.outcome === 'fail')
    if (!allFailed) continue

    await supabaseAdmin
      .from('team_skills')
      .update({
        status: 'retired',
        retired_reason: `最近 ${SKILL_FAIL_RETIRE_THRESHOLD} 次连续失败，自动下架`,
        updated_at: new Date().toISOString(),
      })
      .eq('skill_key', skill_key)
    retired += 1
  }

  return retired
}

function orEmpty<T>(data: T[] | null): T[] {
  return data ?? []
}
