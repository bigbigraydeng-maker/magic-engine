import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { clientHasIndustryFeature } from '@/lib/clients/industry-guard'
import { detectKind, docxToText, plainToText } from '@/lib/tailor-made/read-source'
import { callExtractModel, ExtractError, mergeExtracted, preferTourCode, type ExtractSource } from '@/lib/confirmation/extract'
import { emptyConfirmation } from '@/lib/confirmation/defaults'
import { docxHeaderLogos } from '@/lib/confirmation/logos'

/**
 * POST /api/clients/[id]/confirmation/extract
 * 上传一份确认单 / 行程文件（Word、PDF、文本），AI 读出来，返回填好的表单数据，不落库。
 * 只照抄文件里写的，不补价格/酒店；员工核对后再生成。
 *
 * Body: multipart { file }
 * Responses: 200 { data, notes } / 400 / 401 / 403 / 413 / 502
 * middleware 不覆盖 /api/*，鉴权在这里自己做。
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_BYTES = 8 * 1024 * 1024

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })
  if (!(await clientHasIndustryFeature(params.id, 'tailor_made'))) {
    return NextResponse.json({ error: '这个功能只给旅游业务用。' }, { status: 403 })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: '请求格式不对，需要上传文件。' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: '没有收到文件，或文件是空的。' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: '文件超过 8 MB，请换一份小一点的。' }, { status: 413 })

  const kind = detectKind(file.name, file.type)
  if (!kind) return NextResponse.json({ error: '只支持 Word（.docx）、PDF 和文本文件。老式 .doc 请先另存为 .docx。' }, { status: 400 })

  try {
    const buf = await file.arrayBuffer()
    let source: ExtractSource
    const filename = file.name.slice(0, 200)
    if (kind === 'pdf') source = { kind: 'pdf', base64: Buffer.from(buf).toString('base64'), filename }
    else source = { kind: 'text', text: kind === 'docx' ? await docxToText(buf) : await plainToText(buf), filename }

    const raw = await callExtractModel(source)
    const { data, notes } = mergeExtracted(raw, emptyConfirmation())
    // PDFs are read by the AI only, so the "printed in the document" check needs the text: docx/text only
    if (source.kind === 'text') {
      const pick = preferTourCode(data.tourCode, filename, source.text)
      if (pick.note) {
        data.tourCode = pick.code
        // the code is filled now, so the "no tour code found" note would contradict it
        const rest = notes.filter((n) => !n.includes('没找到团号'))
        notes.length = 0
        notes.push(pick.note, ...rest)
      }
    }
    // the header logos of a Word confirmation come along too (not read by the AI, copied as-is)
    const logos = kind === 'docx' ? await docxHeaderLogos(buf).catch(() => []) : []
    if (logos.length) notes.push(`文件页眉里的 ${logos.length} 个 logo 也一起带过来了，请看一眼前后顺序对不对`)
    return NextResponse.json({ data, notes, logos })
  } catch (err) {
    const message = err instanceof Error ? err.message : '读取失败'
    const known = err instanceof ExtractError || /Word|空的/.test(message)
    if (!known) console.error('[confirmation/extract] failed', err)
    return NextResponse.json({ error: known ? message : '读取文件失败，请重试，或手动填写。' }, { status: known ? 422 : 502 })
  }
}
