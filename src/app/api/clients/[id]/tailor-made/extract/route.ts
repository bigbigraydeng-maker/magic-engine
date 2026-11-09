import { NextRequest, NextResponse } from 'next/server'
import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { extractItinerary, applyPatch, type ChatTurn } from '@/lib/tailor-made/extract'
import { createOrReuseJob, fingerprintInput, markRunning, markCompleted, markFailed } from '@/lib/tailor-made/jobs'
import { getItinerary, saveItinerary } from '@/lib/tailor-made/store'
import type { TailorMadeItinerary } from '@/lib/tailor-made/types'

/**
 * POST /api/clients/[id]/tailor-made/extract
 * 自然语言 → 行程数据。返回合并后的完整行程 + 待确认清单。
 *
 * 不扣 MTC：CTS 是 FDE 轨付费客户，MTC 主要面向 self-serve 消费；
 * 且单次成本极低（一次 Sonnet 调用）。试点期间不想让「余额不足」
 * 变成顾问出单路上的失败点。要开计费的话，照 blog/route.ts 的
 * precheckCharge / commitCharge 包一层即可。
 *
 * ⚠️ 只建任务、立刻回 202，真正跑 AI 放进 fire-and-forget 的后台函数——
 * 原因同 import/route.ts：ME 后台正式域名走 Cloudflare 代理，长行程一次性
 * 粘贴（20 天以上）生成耗时会撞上 CF 约 100 秒的代理等待上限。
 */

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  let body: { message?: string; current?: TailorMadeItinerary; history?: ChatTurn[]; itineraryId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '请求格式错误' }, { status: 400 })
  }

  const message = typeof body.message === 'string' ? body.message.trim() : ''
  if (!message) return NextResponse.json({ error: '请先输入内容' }, { status: 400 })
  if (!body.current) return NextResponse.json({ error: '缺少当前行程数据' }, { status: 400 })
  if (!body.itineraryId) return NextResponse.json({ error: '缺少行程 ID' }, { status: 400 })

  // 一次粘贴 20 天行程约 8–10k 字符；给足余量但挡住误传整本文档
  if (message.length > 60_000) {
    return NextResponse.json({ error: '内容过长，请分次粘贴（上限约 6 万字符）' }, { status: 400 })
  }

  const current = body.current
  const itineraryId = body.itineraryId
  const history = Array.isArray(body.history) ? body.history : []

  // 建任务前先查草稿现在的 updated_at（同样的乐观锁道理，见 import/route.ts）——
  // 这一步和下面建任务都可能因为 DB 抖动失败，必须在同一个 try/catch 里，
  // 不能让异常漏到 Next.js 默认错误页，那正是这次要修的原始故障。
  let jobId: string, reused: boolean, baselineUpdatedAt: string
  try {
    const baselineRecord = await getItinerary(params.id, itineraryId)
    baselineUpdatedAt = baselineRecord?.updated_at ?? ''
    ;({ jobId, reused } = await createOrReuseJob({
      clientId: params.id,
      itineraryId,
      kind: 'extract_text',
      // 指纹要盖住整段会影响结果的输入，不能只按 message——两个标签页对同一份
      // 行程分别改动、恰好敲出同一句指令文字（比如都写"改一下价格"）但 current/
      // history 不同，只按 message 算指纹会把两次完全不同的提交错当成同一次
      // （Codex 复审点出来的场景）。
      inputFingerprint: fingerprintInput(JSON.stringify({ message, current, history })),
      input: { messageLength: message.length },
    }))
  } catch (error) {
    const msg = error instanceof Error ? error.message : '建任务失败'
    console.error('[tailor-made/extract] createOrReuseJob failed', msg)
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  if (!reused) {
    void runExtractJob({
      jobId, clientId: params.id, itineraryId, baselineUpdatedAt, message, current, history,
    }).catch((err) => {
      console.error('[tailor-made/extract] background job crashed', err)
    })
  }

  return NextResponse.json({ job_id: jobId }, { status: 202 })
}

/**
 * 生成结束后顺手把结果存回行程草稿本身，跟 import/route.ts 的 persistIfUnchanged
 * 是同一套道理：顾问在等待期间关掉标签页，任务表里有结果但草稿页上看不到，
 * 只能重新点一次、重新花一次钱。乐观锁同款：updated_at 变过就不覆盖。
 *
 * 条件写在 saveItinerary() 里用一条 `.eq('updated_at', ...)` 的 UPDATE 完成，
 * 不是先读一次判断再写一次——见 import/route.ts 同名函数的注释（#1234）。
 */
async function persistIfUnchanged(
  clientId: string, itineraryId: string, baselineUpdatedAt: string, payload: TailorMadeItinerary
): Promise<void> {
  try {
    const applied = await saveItinerary(clientId, itineraryId, payload, undefined, {
      expectedUpdatedAt: baselineUpdatedAt,
    })
    if (!applied) {
      console.warn('[tailor-made/extract] 草稿在生成期间被改过，跳过自动回存，避免覆盖更新的内容', { itineraryId })
    }
  } catch (err) {
    console.error('[tailor-made/extract] 自动回存草稿失败（任务表里的结果还在，不算彻底丢失）', err)
  }
}

async function runExtractJob(params: {
  jobId: string
  clientId: string
  itineraryId: string
  baselineUpdatedAt: string
  message: string
  current: TailorMadeItinerary
  history: ChatTurn[]
}): Promise<void> {
  const { jobId, clientId, itineraryId, baselineUpdatedAt, message, current, history } = params
  await markRunning(jobId)

  try {
    const result = await extractItinerary({ message, current, history })
    const payload = applyPatch(current, result.patch)
    await markCompleted(jobId, { payload, review: result.review, reply: result.reply })
    await persistIfUnchanged(clientId, itineraryId, baselineUpdatedAt, payload)
  } catch (error) {
    const msg = error instanceof Error ? error.message : '解析失败'
    console.error('[tailor-made/extract]', msg)
    await markFailed(jobId, `AI 解析失败：${msg}`)
  }
}
