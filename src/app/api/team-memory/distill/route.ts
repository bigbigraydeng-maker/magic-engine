/**
 * POST /api/team-memory/distill
 *
 * 提炼单个会话。hook 在会话结束时**不等结果**地打一枪，
 * 打不中也没关系 —— cron sweeper 会兜底扫掉所有漏网的。
 */

import { NextRequest, NextResponse } from 'next/server'
import { checkHookAuth } from '@/lib/team-memory/auth'
import { distillSession } from '@/lib/team-memory/distill'

export const dynamic = 'force-dynamic'
// 一次 Claude 调用 + 若干次落库，给足余量
export const maxDuration = 120

export async function POST(req: NextRequest): Promise<NextResponse> {
  const fail = checkHookAuth(req.headers.get('authorization'))
  if (fail) return fail.response

  let body: { session_key?: string }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 })
  }

  if (!body.session_key) {
    return NextResponse.json({ error: 'session_key 必填' }, { status: 400 })
  }

  try {
    const result = await distillSession(body.session_key)
    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[team-memory/distill] 提炼失败:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
