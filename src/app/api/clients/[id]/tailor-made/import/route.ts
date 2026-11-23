import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { callClaudeWithDocs } from '@/lib/anthropic/client'
import { extractItinerary, applyPatch } from '@/lib/tailor-made/extract'
import { detectKind, docxToText, plainToText, type SourceKind } from '@/lib/tailor-made/read-source'
import { heroForTrip, pickHeroName } from '@/lib/tailor-made/hero'
import { parseFlightPdf } from '@/lib/tailor-made/flights'
import { createOrReuseJob, fingerprintInput, markRunning, markCompleted, markFailed } from '@/lib/tailor-made/jobs'
import { getItinerary, saveItinerary } from '@/lib/tailor-made/store'
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
 * ⚠️ 这个 POST 只建任务、立刻回 202——真正跑 AI 的活儿在 runImportJob() 里，
 * fire-and-forget，不占这次 HTTP 连接。原因：ME 后台正式域名走 Cloudflare
 * 代理，CF 对被代理的请求有约 100 秒等待上限；27 天以上的团光生成就要
 * 100-180 秒，同步等一个 HTTP 响应必然被 CF 掐断，浏览器只会收到一个
 * HTML 错误页，报 "Unexpected token '<'"（CTS 2027 China Panorama 实测）。
 * 前端改成轮询 /tailor-made/jobs/[jobId] 拿结果，见 TailorMadeEditor.tsx。
 *
 * Body: multipart { file, current, itineraryId }
 * Responses: 202 { job_id } / 400 / 401 / 403 / 413
 */

export const dynamic = 'force-dynamic'

const MAX_BYTES = 12 * 1024 * 1024

/**
 * PDF 走文档通道：先让 Claude 转成保结构的纯文本，再进抽取链。
 *
 * 这一步的截断和 extractItinerary() 的截断是两个独立的坑：这里如果被
 * max_tokens 切断，转录出来的文本本身就是残的，后面 extractItinerary()
 * 再准也没用——喂给它的原料已经少了几天。所以要单独加 bypassGateway
 * （长文档转录同样可能撞上 CF 网关超时）和 stop_reason 检查。
 */
async function pdfToText(base64: string, filename: string): Promise<string> {
  const res = await callClaudeWithDocs({
    systemPrompt:
      'Transcribe this travel itinerary document to plain text. Preserve the day-by-day structure, ' +
      'each day on its own lines, keeping dates, routes, descriptions, hotels and any pricing/inclusion ' +
      'sections. Do not summarise, do not omit, do not add. Output text only.',
    userMessage: '把这份行程文件转成保留结构的纯文本。',
    docs: [{ type: 'pdf', content: base64, filename }],
    maxOutputTokens: 12000,
    bypassGateway: true,
  })
  if (res.stop_reason === 'max_tokens') {
    throw new Error('行程文件转录到一半就被截断了（文件内容特别多的团容易发生）。请重试一次；如果还是不行，请联系技术支持处理')
  }
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

/**
 * 生成结束后，除了写进任务表给轮询的人看，也顺手把结果存回行程草稿本身——
 * 不然顾问在生成期间关掉标签页（Codex 复审点出来的场景），任务表里趟着一份
 * 生成好的内容，草稿页上却永远看不到，用户只能重新点一次、重新花一次钱。
 *
 * 乐观锁：只有草稿的 updated_at 跟建任务时读到的一致，才落这次结果——如果
 * 顾问在等待期间自己手动改过草稿（正常的自动保存已经落库），updated_at 会
 * 变，这时候宁可不存，也不能拿一份基于旧草稿算出来的结果覆盖用户更新的内容。
 *
 * 条件写在 saveItinerary() 里用一条 `.eq('updated_at', ...)` 的 UPDATE 完成，
 * 不是这里「先读一次判断、再写一次」——那样两次查询之间还是有空隙能被插进来
 * 一次别的保存，版本检查保护不到它自己守着的这次写入（Codex round-2 复审点
 * 出来的问题，见 #1234）。
 */
async function persistIfUnchanged(
  clientId: string, itineraryId: string, baselineUpdatedAt: string, payload: TailorMadeItinerary
): Promise<void> {
  try {
    const applied = await saveItinerary(clientId, itineraryId, payload, undefined, {
      expectedUpdatedAt: baselineUpdatedAt,
    })
    if (!applied) {
      console.warn('[tailor-made/import] 草稿在生成期间被改过，跳过自动回存，避免覆盖更新的内容', { itineraryId })
    }
  } catch (err) {
    console.error('[tailor-made/import] 自动回存草稿失败（任务表里的结果还在，不算彻底丢失）', err)
  }
}

/** 后台真正干活的地方——不绑定任何 HTTP 连接，AI 想跑多久跑多久 */
async function runImportJob(params: {
  jobId: string
  clientId: string
  itineraryId: string
  baselineUpdatedAt: string
  kind: SourceKind
  base64: string
  filename: string
  current: TailorMadeItinerary
}): Promise<void> {
  const { jobId, clientId, itineraryId, baselineUpdatedAt, kind, base64, filename, current } = params
  await markRunning(jobId)

  try {
    const arrayBuffer = Uint8Array.from(Buffer.from(base64, 'base64')).buffer
    let text: string
    if (kind === 'docx') text = await docxToText(arrayBuffer)
    else if (kind === 'pdf') text = await pdfToText(base64, filename)
    else text = await plainToText(arrayBuffer)

    if (text.length > 80_000) text = text.slice(0, 80_000)

    // 传错框也能救回来：认出是出票单就走航班解析，不当行程糟蹋掉
    if (kind === 'pdf' && looksLikeTicket(text)) {
      const flights = await parseFlightPdf(base64, filename)
      const payload = { ...current, flights: flights.flights, bookingRef: flights.bookingRef || current.bookingRef }
      await markCompleted(jobId, {
        payload,
        review: [],
        reply: `这份是出票单，不是行程 —— 已按航班读取。${flights.note}`,
        detectedAs: 'ticket',
      })
      await persistIfUnchanged(clientId, itineraryId, baselineUpdatedAt, payload)
      return
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

    await markCompleted(jobId, { payload, review: result.review, reply: result.reply, heroName, sourceKind: kind })
    await persistIfUnchanged(clientId, itineraryId, baselineUpdatedAt, payload)
  } catch (error) {
    const msg = error instanceof Error ? error.message : '解析失败'
    console.error('[tailor-made/import]', msg)
    await markFailed(jobId, `行程文件解析失败：${msg}`)
  }
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let file: File | null = null
  let current: TailorMadeItinerary | null = null
  let itineraryId: string | null = null
  try {
    const form = await req.formData()
    const f = form.get('file')
    if (f instanceof File) file = f
    const cur = form.get('current')
    if (typeof cur === 'string' && cur) current = JSON.parse(cur) as TailorMadeItinerary
    const id = form.get('itineraryId')
    if (typeof id === 'string' && id) itineraryId = id
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  if (!file) return NextResponse.json({ error: '请选择行程文件' }, { status: 400 })
  if (!current) return NextResponse.json({ error: '缺少当前行程数据' }, { status: 400 })
  if (!itineraryId) return NextResponse.json({ error: '缺少行程 ID' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: '文件过大（上限 12MB）' }, { status: 413 })

  const kind = detectKind(file.name, file.type)
  if (!kind) {
    return NextResponse.json(
      { error: '只支持 Word（.docx）、PDF 和纯文本。老式 .doc 请先另存为 .docx 或 PDF。' },
      { status: 400 },
    )
  }

  const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

  // 建任务前先查草稿现在的 updated_at（生成完要靠它判断草稿有没有被同时改过，
  // 见 persistIfUnchanged() 的乐观锁注释）——这一步和下面建任务一样可能因为
  // DB 抖动失败，必须在同一个 try/catch 里，不能让异常漏到 Next.js 默认错误页，
  // 那正是这次要修的原始故障（HTML 错误页把 "Unexpected token '<'" 甩给浏览器）。
  let jobId: string, reused: boolean, baselineUpdatedAt: string
  try {
    const baselineRecord = await getItinerary(params.id, itineraryId)
    baselineUpdatedAt = baselineRecord?.updated_at ?? ''
    ;({ jobId, reused } = await createOrReuseJob({
      clientId: params.id,
      itineraryId,
      kind: 'import_file',
      inputFingerprint: fingerprintInput(base64),
      input: { filename: file.name, sourceKind: kind },
    }))
  } catch (error) {
    const msg = error instanceof Error ? error.message : '建任务失败'
    console.error('[tailor-made/import] createOrReuseJob failed', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  if (!reused) {
    void runImportJob({
      jobId, clientId: params.id, itineraryId, baselineUpdatedAt, kind, base64, filename: file.name, current,
    }).catch((err) => {
      console.error('[tailor-made/import] background job crashed', err)
    })
  }

  return NextResponse.json({ job_id: jobId }, { status: 202 })
}
