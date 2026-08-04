import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { callClaudeWithDocs } from '@/lib/anthropic/client'
import { extractItinerary, applyPatch } from '@/lib/tailor-made/extract'
import { detectKind, docxToText, plainToText } from '@/lib/tailor-made/read-source'
import { heroForTrip, pickHeroName } from '@/lib/tailor-made/hero'
import { parseFlightPdf } from '@/lib/tailor-made/flights'
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

/**
 * 这份文件是出票单还是行程？
 *
 * 甲方两个框都传了，但导出的行程里航段是 0 —— 两个上传框长得一样、
 * 都收 PDF，传错框太容易，而传错之后系统还一声不吭当成行程去解析。
 *
 * 与其让人分辨，不如系统自己认：出票单和行程 Word 的特征差得很远。
 * 三个条件同时满足才算出票单，宁可漏判（当行程解析，顾问看得出来），
 * 也不要误判（把真行程当出票单，整份行程就没了）。
 */
function looksLikeTicket(text: string): boolean {
  const t = text.slice(0, 4000)
  const hasFlightNo = /\b[A-Z]{2}\s?\d{2,4}\b/.test(t)
  const hasLeg = /(departure|arrival|出发|到达)/i.test(t)
  const hasTicketMarker = /(booking\s*ref|\bPNR\b|e-?ticket|check-?in|操作航班|电子客票)/i.test(t)
  return hasFlightNo && hasLeg && hasTicketMarker
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

    // 传错框也能救回来：认出是出票单就走航班解析，不当行程糟蹋掉
    if (kind === 'pdf' && looksLikeTicket(text)) {
      const flights = await parseFlightPdf(Buffer.from(buf).toString('base64'), file.name)
      return NextResponse.json({
        payload: { ...current, flights: flights.flights, bookingRef: flights.bookingRef || current.bookingRef },
        review: [],
        reply: `这份是出票单，不是行程 —— 已按航班读取。${flights.note}`,
        detectedAs: 'ticket',
      })
    }

    const result = await extractItinerary({ message: text, current })
    const payload = applyPatch(current, result.patch)

    // 航班不能被行程导入冲掉。
    //
    // extractItinerary 压根不把 flights 传给模型（也不该传 —— 那是另一份
    // 文件的事），所以 patch 里永远没有 flights。但只要客户端传来的 current
    // 是旧的（先传航班、再传行程，两次点击之间 state 没跟上），航段就没了。
    // 甲方实测就是「第一版有航班，重新生成后没了」。
    if (!('flights' in (result.patch as Record<string, unknown>))) {
      payload.flights = current.flights ?? payload.flights
      payload.bookingRef = current.bookingRef || payload.bookingRef
    }

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
