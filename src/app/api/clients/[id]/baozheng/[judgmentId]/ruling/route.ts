/**
 * POST /api/clients/[id]/baozheng/[judgmentId]/ruling
 * 内部员工裁定「两个 AI 判得不一样，谁对」。只记结论（写 crm_segment_feedback），
 * 不改客人阶段、不写阶段记录。
 * Body: { ruling: 'ai_right' | 'review_right' | 'neither' }
 */

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireGlobalAdmin } from '@/lib/auth/require-admin'
import { isRuling, saveRuling } from '@/lib/baozheng/ruling'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; judgmentId: string } },
): Promise<NextResponse> {
  const auth = await requireGlobalAdmin()
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: { ruling?: unknown }
  try {
    body = (await req.json()) as { ruling?: unknown }
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  if (!isRuling(body.ruling)) {
    return NextResponse.json(
      { error: '要选一个：原来的对 / 复核的对 / 都不对' },
      { status: 400 },
    )
  }

  try {
    const result = await saveRuling(
      supabaseAdmin,
      params.id,
      params.judgmentId,
      body.ruling,
      auth.user.email ?? null,
    )
    if (result === 'not_found') {
      return NextResponse.json({ error: '找不到这条判断' }, { status: 404 })
    }
    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (e) {
    console.error(
      '[baozheng/ruling] save failed:',
      e instanceof Error ? e.message : String(e),
    )
    return NextResponse.json({ error: '保存失败' }, { status: 500 })
  }
}
