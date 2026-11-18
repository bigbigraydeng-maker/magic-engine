import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { clientHasIndustryFeature } from '@/lib/clients/industry-guard'
import { buildConfirmationDocx } from '@/lib/confirmation/docx'
import { parseConfirmation, validateConfirmation } from '@/lib/confirmation/validate'

/**
 * POST /api/clients/[id]/confirmation/docx
 * 把填好的确认单生成 Word 文件。不落库、不外发。
 * middleware 不覆盖 /api/*，鉴权必须在这里自己做。
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!(await clientHasIndustryFeature(params.id, 'tailor_made'))) {
    return NextResponse.json({ error: '这个功能只给旅游业务用。' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求格式不对。' }, { status: 400 })
  }
  const parsed = parseConfirmation(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const data = parsed.data

  const errors = validateConfirmation(data)
  if (errors.length) return NextResponse.json({ error: errors.join('；') }, { status: 400 })

  const buffer = await buildConfirmationDocx(data)
  const safeCode = data.tourCode.replace(/[^A-Za-z0-9-]/g, '')
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${safeCode}-confirmation.docx"`,
      'Cache-Control': 'no-store',
    },
  })
}
