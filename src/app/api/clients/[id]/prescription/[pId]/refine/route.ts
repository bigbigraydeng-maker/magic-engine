/**
 * POST /api/clients/[id]/prescription/[pId]/refine
 *
 * 让华佗对已生成处方做精修 — **流式响应模式**（与 /generate 一致）。
 *
 * 同样原因：Render 会回收 fire-and-forget 进程。这里保持 HTTP 连接活的整个
 * 精修执行期间，进程不会被杀。
 *
 * 响应：text/event-stream，事件类型与 /generate 相同（started / progress / done / error）。
 *
 * 校验：必须是草稿状态 + 华佗生成 + 有 discovery + 有 weaknesses。
 *
 * Security: Bearer token (INTERNAL_API_KEY)
 * Reference: ROADMAP.md P8.10.S3
 */

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requirePaidClientAccess } from '@/lib/auth/client-access'
import { refineHuatuoPrescription, coerceWeaknesses } from '@/lib/huatuo/agent'
import type { PrescriptionIntake, PrescriptionContent } from '@/types/diagnostic'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import type { SelfGrade, SelfGradeWeakness } from '@/lib/huatuo/types'
import { loadMemoryForClient } from '@/lib/memory'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 300

const HEARTBEAT_INTERVAL_MS = 8_000

interface PrescriptionRow {
  id: string
  client_id: string
  discovery_id: string | null
  status: string
  agent_name: string | null
  intake: PrescriptionIntake | null
  content: PrescriptionContent | null
  self_grade: SelfGrade | null
  generation_meta: { passes?: number } | null
}

interface DiscoveryRow {
  id: string
  payload: DiscoveryReport
  confirmed_at: string | null
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; pId: string } },
): Promise<Response> {
  const { id: clientId } = params
  const access = await requirePaidClientAccess(clientId)
  if (!access.ok) {
    return errorResponse(access.status, access.error)
  }

  const { pId } = params

  // 读 body（可选 human_comments）
  let humanComments: string | undefined
  try {
    const body = await req.json() as { human_comments?: string }
    if (body?.human_comments && typeof body.human_comments === 'string') {
      humanComments = body.human_comments.trim() || undefined
    }
  } catch {
    // body 不是 JSON 或为空都可以接受
  }

  // 加载 + 校验（同步部分）
  const { data: presc, error: pErr } = await supabaseAdmin
    .from('prescriptions')
    .select('id, client_id, discovery_id, status, agent_name, intake, content, self_grade, generation_meta')
    .eq('id', pId)
    .eq('client_id', clientId)
    .single<PrescriptionRow>()

  if (pErr || !presc) return errorResponse(404, '处方不存在')
  if (presc.status === 'approved') return errorResponse(409, '处方已批准，无法再次精修')
  if (presc.status === 'generating') return errorResponse(409, '处方正在生成中，请稍后再试')
  if (presc.agent_name !== 'huatuo') return errorResponse(422, '只有华佗生成的处方支持精修')
  if (!presc.discovery_id || !presc.intake || !presc.content) {
    return errorResponse(422, '处方数据不完整（缺 discovery / intake / content）')
  }

  // coerceWeaknesses 兼容 DB 里旧 prescription 的 string[] 格式
  const previousWeaknesses = coerceWeaknesses(presc.self_grade?.weaknesses)
  if (previousWeaknesses.length === 0) {
    return errorResponse(422, '上一轮无明确薄弱点，无需精修')
  }

  // 加载源 discovery
  const { data: disc, error: dErr } = await supabaseAdmin
    .from('client_discovery')
    .select('id, payload, confirmed_at')
    .eq('id', presc.discovery_id)
    .eq('client_id', clientId)
    .single<DiscoveryRow>()

  if (dErr || !disc) return errorResponse(404, '源发现报告不存在')

  // 标记 generating（同步快速更新）
  await supabaseAdmin
    .from('prescriptions')
    .update({ status: 'generating', progress_note: '排队精修中…', error_message: null })
    .eq('id', pId)
    .eq('client_id', clientId)

  const previousPasses = presc.generation_meta?.passes ?? 1

  return new Response(
    makeRefineStream(
      pId, clientId, disc.payload, presc.intake, presc.content,
      previousWeaknesses, humanComments, previousPasses, presc.self_grade,
    ),
    { headers: streamHeaders() },
  )
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function streamHeaders(): HeadersInit {
  return {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  }
}

function errorResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeRefineStream(
  prescriptionId: string,
  clientId: string,
  discovery: DiscoveryReport,
  intake: PrescriptionIntake,
  previousContent: PrescriptionContent,
  previousWeaknesses: SelfGradeWeakness[],
  humanComments: string | undefined,
  previousPasses: number,
  previousSelfGrade: SelfGrade | null,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(': heartbeat\n\n')) } catch {/* */}
      }, HEARTBEAT_INTERVAL_MS)

      const sendEvent = (data: object) => {
        try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)) }
        catch {/* */}
      }

      sendEvent({ type: 'started', prescription_id: prescriptionId })

      // Phase 23.D.2: Non-blocking memory load
      const memoryContext = await loadMemoryForClient(supabaseAdmin, clientId, {
        maxRecentDecisions: 5,
      })

      try {
        const result = await refineHuatuoPrescription(
          supabaseAdmin, discovery, intake, previousContent, previousWeaknesses,
          {
            humanComments,
            previousPasses,
            previousSelfGrade,
            memoryContext,
            onProgress: async (note) => {
              sendEvent({ type: 'progress', note })
              await supabaseAdmin
                .from('prescriptions')
                .update({ progress_note: note })
                .eq('id', prescriptionId)
                .eq('client_id', clientId)
            },
          },
        )

        await supabaseAdmin
          .from('prescriptions')
          .update({
            status:          'draft',
            content:         result.content,
            self_grade:      result.self_grade,
            generation_meta: { ...result.meta, trend_summary: result.trend_summary },
            progress_note:   null,
            error_message:   null,
          })
          .eq('id', prescriptionId)
          .eq('client_id', clientId)

        sendEvent({
          type: 'done',
          prescription_id: prescriptionId,
          content: result.content,
          self_grade: result.self_grade,
          meta: result.meta,
          trend_summary: result.trend_summary,
        })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        console.error('[huatuo/refine-stream] failed', { prescriptionId, message })

        // 精修失败：原 content/self_grade 仍然是好的，把状态回滚到 draft，
        // 只记录 error_message。用户可以继续看原处方、重试精修或直接批准。
        await supabaseAdmin
          .from('prescriptions')
          .update({
            status:        'draft',           // ← 回滚到草稿（不是 failed）
            error_message: message,
            progress_note: null,
          })
          .eq('id', prescriptionId)
          .eq('client_id', clientId)

        sendEvent({ type: 'error', error: message })
      } finally {
        clearInterval(heartbeat)
        controller.close()
      }
    },
  })
}
