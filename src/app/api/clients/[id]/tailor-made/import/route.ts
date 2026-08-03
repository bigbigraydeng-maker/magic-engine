import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { callClaudeWithDocs } from '@/lib/anthropic/client'
import { extractItinerary, applyPatch } from '@/lib/tailor-made/extract'
import { detectKind, docxToText, plainToText } from '@/lib/tailor-made/read-source'
import { heroForTrip, pickHeroName } from '@/lib/tailor-made/hero'
import type { TailorMadeItinerary } from '@/lib/tailor-made/types'

/**
 * POST /api/clients/[id]/tailor-made/import
 *
 * 上传每日行程文件（Word / PDF / 纯文本），解析成行程数据。
 *
 * 这是新流程的第一步：顾问上传两份文件（这份 + 出票单 PDF），
 * 系统直接出预览，中间不填表。
 *
 * 三种格式各走各的最优路径：
 *   docx  → 解 zip 取正文（保住表格单元格边界，否则「Day 10」会和正文黏成一坨）
 *   pdf   → 直接以 document 喂 Claude，版式不丢，表格类行程解析明显更准
 *   text  → 原样
 * 三条路最后汇到同一个既有抽取链，规则一致：只照抄，不补价格/酒店/餐食。
 *
 * 顺带按目的地选好封面图 —— 甲方原话「重庆团封面就该是重庆」。
 *
 * Body: multipart { file, current? }
 * Responses: 200 { payload, review, reply, heroPicked } / 400 / 401 / 403 / 413 / 502
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_BYTES = 12 * 1024 * 1024

/** PDF 走文档通道：先让 Claude 转成保结构的纯文本，再进抽取链 */
async function pdfToText(base64: string, filename: string): Promise<string> {
  const res = await callClaudeWithDocs({
    systemPrompt:
      'Transcribe this travel itinerary document to plain text. Preserve the day-by-day structure, ' +
      'each day on its own lines, keeping dates, routes, descriptions, hotels and any pricing/inclusion ' +
      'sections. Do not summarise, do not omit, do not add. Output text only.',
    userMessage: '把这份行程文件转成保留结构的纯文本。',
    docs: [{ type: 'pdf', content: base64, filename }],
    maxOutputTokens: 8096,
  })
  return res.text.trim()
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let file: File | null = null
  let current: TailorMadeItinerary | null = null
  try {
    const form = await req.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
    const cur = form.get('current')
    if (typeof cur === 'string' && cur) current = JSON.parse(cur) as TailorMadeItinerary
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  if (!file) return NextResponse.json({ error: '请选择行程文件' }, { status: 400 })
  if (!current) return NextResponse.json({ error: '缺少当前行程数据' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: '文件过大（上限 12MB）' }, { status: 413 })

  const kind = detectKind(file.name, file.type)
  if (!kind) {
    return NextResponse.json(
      { error: '只支持 Word（.docx）、PDF 和纯文本。老式 .doc 请先另存为 .docx 或 PDF。' },
      { status: 400 },
    )
  }

  try {
    const buf = await file.arrayBuffer()
    let text: string
    if (kind === 'docx') text = await docxToText(buf)
    else if (kind === 'pdf') text = await pdfToText(Buffer.from(buf).toString('base64'), file.name)
    else text = await plainToText(buf)

    if (text.length > 80_000) text = text.slice(0, 80_000)

    const result = await extractItinerary({ message: text, current })
    const payload = applyPatch(current, result.patch)

    // 封面按目的地自动选；顾问没手动指定过才覆盖
    // 自动选一定有猜错的时候（「重庆+张家界」哪个当主打？）。所以把选中的
    // 名字一并回传，界面上明说「系统选了 X」并给换的入口 —— 静默选错的话
    // 顾问未必注意到，直到客人收到才发现。
    let heroName: string | null = null
    if (!payload.trip.heroImage) {
      const hero = await heroForTrip(payload.trip)
      if (hero) {
        payload.trip.heroImage = hero
        heroName = pickHeroName(payload.trip)
      }
    }

    return NextResponse.json({
      payload,
      review: result.review,
      reply: result.reply,
      heroName,
      sourceKind: kind,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : '解析失败'
    console.error('[tailor-made/import]', msg)
    return NextResponse.json({ error: `行程文件解析失败：${msg}` }, { status: 502 })
  }
}
