import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { extractItinerary, applyPatch, type ChatTurn } from '@/lib/tailor-made/extract'
import type { TailorMadeItinerary } from '@/lib/tailor-made/types'

/**
 * POST /api/clients/[id]/tailor-made/extract
 * 自然语言 → 行程数据。返回合并后的完整行程 + 待确认清单。
 *
 * 不扣 MTC：CTS 是 FDE 轨付费客户，MTC 主要面向 self-serve 消费；
 * 且单次成本极低（一次 Sonnet 调用）。试点期间不想让「余额不足」
 * 变成顾问出单路上的失败点。要开计费的话，照 blog/route.ts 的
 * precheckCharge / commitCharge 包一层即可。
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60 // 20 天行程的抽取会跑较久

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: { message?: string; current?: TailorMadeItinerary; history?: ChatTurn[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: '请先输入内容' }, { status: 400 })
  if (!body.current) return NextResponse.json({ error: '缺少当前行程数据' }, { status: 400 })

  // 一次粘贴 20 天行程约 8–10k 字符；给足余量但挡住误传整本文档
  if (message.length > 60_000) {
    return NextResponse.json({ error: '内容过长，请分次粘贴（上限约 6 万字符）' }, { status: 400 })
  }

  try {
    const result = await extractItinerary({
      message,
      current: body.current,
      history: Array.isArray(body.history) ? body.history : [],
    })

    return NextResponse.json({
      payload: applyPatch(body.current, result.patch),
      review: result.review,
      reply: result.reply,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : '解析失败'
    console.error('[tailor-made/extract]', msg)
    return NextResponse.json({ error: `AI 解析失败：${msg}` }, { status: 502 })
  }
}
