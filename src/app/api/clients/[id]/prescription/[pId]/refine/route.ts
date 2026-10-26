/**
 * POST /api/clients/[id]/prescription/[pId]/refine
 *
 * 让华佗对已生成处方做精修。先把这一行标成生成中，立刻回 202。
 * 模型调用在进程里后台跑，结果写回同一行。不能在这条 HTTP 里干等：
 * 正式域名的代理大约 100 秒就掐断，而精修本身又是一轮大约 2 分钟的模型调用。
 * 精修失败会把状态退回草稿，原内容还在。
 *
 * 校验：必须是草稿状态 + 华佗生成 + 有 discovery + 有 weaknesses。
 *
 * Security: logged-in session. OPC or this client's own FDE (requireOperatorAccess).
 * Reference: ROADMAP.md P8.10.S3
 */

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireOperatorAccess } from '@/lib/auth/client-access'
import { refineHuatuoPrescription, coerceWeaknesses } from '@/lib/huatuo/agent'
import type { PrescriptionIntake, PrescriptionContent } from '@/types/diagnostic'
import type { DiscoveryReport } from '@/lib/zhangqian/types'
import type { SelfGrade } from '@/lib/huatuo/types'
import { getGoalById } from '@/lib/strategy/goals'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 300

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
  /** DAPE W4: 一对一关联 Goal (refine 时复用) */
  goal_id: string | null
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
  // Drafting stays open to this client's FDE. requireGlobalAdmin would lock them out.
  const access = await requireOperatorAccess(clientId)
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
    .select('id, client_id, discovery_id, status, agent_name, intake, content, self_grade, generation_meta, goal_id')
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

  // 标记 generating（同步快速更新）。generated_at 重置为本轮开始时间：
  // 10 分钟中断判断（failIfStaleGenerating）按它计时，不重置的话旧草稿一精修就被判中断。
  await supabaseAdmin
    .from('prescriptions')
    .update({
      status: 'generating',
      progress_note: '排队精修中…',
      error_message: null,
      generated_at: new Date().toISOString(),
    })
    .eq('id', pId)
    .eq('client_id', clientId)

  const previousPasses = presc.generation_meta?.passes ?? 1
  const goal = presc.goal_id ? await getGoalById(supabaseAdmin, presc.goal_id) : null

  schedulePrescriptionRefine({
    clientId,
    prescriptionId: pId,
    discovery: disc.payload,
    intake: presc.intake,
    previousContent: presc.content,
    previousWeaknesses,
    humanComments,
    previousPasses,
    previousSelfGrade: presc.self_grade,
    goal,
  })

  return new Response(JSON.stringify({
    success: true,
    prescription_id: pId,
    status: 'generating',
  }), {
    status: 202,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

function errorResponse(status: number, error: string): Response {
  return new Response(JSON.stringify({ success: false, error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}
