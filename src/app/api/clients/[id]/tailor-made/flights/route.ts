import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { parseFlightPdf } from '@/lib/tailor-made/flights'

/**
 * POST /api/clients/[id]/tailor-made/flights
 *
 * 上传出票单 PDF，读出航段。
 *
 * 顾问手里的航班信息是另一份 PDF（Amadeus / 航司出的），跟行程单是两份
 * 文件。以前只能人工照抄一遍到行程里 —— 抄错一个航站楼，客人就跑错地方。
 *
 * 走 multipart 而不是让顾问复制粘贴：出票单是排版复杂的表格，
 * 复制出来的文本顺序全乱，人也不会愿意做这一步。
 *
 * Responses: 200 { bookingRef, flights, note } / 400 / 401 / 403 / 413 / 502
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Claude 的 PDF 输入上限考虑在内；出票单通常 1-3 页、几十 KB */
const MAX_BYTES = 8 * 1024 * 1024

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let file: File | null = null
  try {
    const form = await req.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  if (!file) return NextResponse.json({ error: '请选择一个 PDF 文件' }, { status: 400 })

  if (!/pdf$/i.test(file.type) && !/\.pdf$/i.test(file.name)) {
    return NextResponse.json({ error: '只支持 PDF —— 出票单请存成 PDF 再上传' }, { status: 400 })
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: '文件过大（上限 8MB）' }, { status: 413 })
  }

  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')
    const result = await parseFlightPdf(base64, file.name)
    return NextResponse.json(result)
  } catch (error) {
    const msg = error instanceof Error ? error.message : '解析失败'
    console.error('[tailor-made/flights]', msg)
    return NextResponse.json({ error: `出票单解析失败：${msg}` }, { status: 502 })
  }
}
