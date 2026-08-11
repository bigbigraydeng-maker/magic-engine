/**
 * POST /api/ad-engine/lessons
 *
 * 往跨客户经验池写一条经验。**这是唯一的写入口。**
 *
 * 为什么要有它（狄仁杰 2026-08-04 复验第一条）：
 *   脱敏闸 `assertShareable` 写好了却**零个生产调用方** —— 库里那 11 条全是
 *   手敲 SQL 塞进去的，零校验，其中 5 条含买家真名和每 lead 成本，每天注入
 *   至少 8 个客户的提示词。一道没人调的闸等于不存在。
 *
 *   同一张表里就躺着 `config-must-go-through-ui-not-direct-db-write`
 *   这条经验 —— 它自己曾经就是那条经验的反例。
 *
 * 200 { ok, lessonKey }
 * 422 { error, findings } 脱敏没过 —— 逐条给出命中什么、为什么不能留
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { guardGlobalAdmin } from '@/lib/auth/require-admin'
import { writeGlobalLesson, type LessonScope } from '@/lib/memory/write-lesson'

export async function POST(req: NextRequest): Promise<NextResponse> {
  // 跟停用开关同一道门：这条一写进去，全部客户的 AI 行为都跟着变。
  const guard = await guardGlobalAdmin()
  if (guard) return guard

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const scope = body['scope']
  if (scope !== 'global' && scope !== 'channel' && scope !== 'industry') {
    return NextResponse.json(
      { error: 'scope 必须是 global / channel / industry' },
      { status: 400 },
    )
  }

  const result = await writeGlobalLesson(supabaseAdmin, {
    lessonKey: String(body['lesson_key'] ?? ''),
    scope: scope as LessonScope,
    industry: typeof body['industry'] === 'string' ? body['industry'] : null,
    flywheel: typeof body['flywheel'] === 'string' ? body['flywheel'] : null,
    lesson: String(body['lesson'] ?? ''),
    rationale: typeof body['rationale'] === 'string' ? body['rationale'] : null,
    confidence: typeof body['confidence'] === 'number' ? body['confidence'] : 0.6,
    evidence:
      body['evidence'] && typeof body['evidence'] === 'object'
        ? (body['evidence'] as Record<string, unknown>)
        : null,
  })

  if (result.ok) return NextResponse.json({ ok: true, lessonKey: result.lessonKey })

  if (result.reason === 'not_shareable') {
    // 422 不是 500：闸门按设计拦下了，不是故障。
    // 逐条回命中，人才知道改哪一句；只回一句「不合规」等于让人猜。
    return NextResponse.json(
      {
        error: result.verdict.summary,
        findings: result.verdict.findings,
        hint: '个案（金额 / 客户名 / 结果数）挪进 evidence —— evidence 不进提示词。正文只留「为什么」。',
      },
      { status: 422 },
    )
  }

  return NextResponse.json(
    { error: result.error },
    { status: result.reason === 'invalid' ? 400 : 500 },
  )
}
