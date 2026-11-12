/**
 * GET /api/clients/[id]/crm/auto-letters/[letterKey]   一封信的详情：标题、正文、每位收件人的结果和原因
 *
 * 只读，不发信，不返回任何邮箱（只有姓名）。原因都已翻成人话。权限同列表接口。
 * 信编号是不透明的字符串（里面有「:」，调用方要整串 encodeURIComponent 一次再放进路径）。
 * 形状见 src/lib/messaging/letters/types.ts（AutoLetterDetail）。
 */

import { NextRequest, NextResponse } from 'next/server'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { accessFailure, letterNotFound, resolveLetterKey, unavailable } from '@/lib/messaging/letters/http'
import { loadAutoLetterDetail } from '@/lib/messaging/letters/load'
import { supabaseAdmin } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

interface RouteParams {
  params: { id: string; letterKey: string }
}

export async function GET(_req: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  const access = await requirePaidClientAccess(params.id)
  if (!access.ok) {
    const failure = accessFailure(access)
    return NextResponse.json(failure.body, { status: failure.status })
  }
  const letterKey = resolveLetterKey(params.letterKey)
  if (letterKey === null) {
    const failure = letterNotFound()
    return NextResponse.json(failure.body, { status: failure.status })
  }
  try {
    const detail = await loadAutoLetterDetail(supabaseAdmin, params.id, letterKey)
    if (detail === null) {
      const failure = letterNotFound()
      return NextResponse.json(failure.body, { status: failure.status })
    }
    return NextResponse.json(detail)
  } catch (err) {
    console.error('[crm/auto-letters/key] 读取失败:', err instanceof Error ? err.message : err)
    const failure = unavailable()
    return NextResponse.json(failure.body, { status: failure.status })
  }
}
