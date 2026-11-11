/**
 * Ask for one approval of this week's plan, then stamp the plan.
 * Agreeing does not publish.
 */
import { NextResponse } from 'next/server'

import { requireDashboardClientAccess } from '@/lib/auth/client-access'
import { clickerFromSession, decideConfirmationCard, issueConfirmationCard } from '@/lib/confirmation-card'
import { ConfirmationCardError } from '@/lib/confirmation-card/errors'
import { publicError } from '@/lib/confirmation-card/http'
import { createKernel } from '@/lib/kernel'
import { targetWeek } from '@/lib/social/week-pack/cadence'
import { decideWeekPlanApproval, openWeekPlanApproval } from '@/lib/social/weekly-plan/approval'
import { readLatestWeeklyPlan, stampWeeklyPlan } from '@/lib/social/weekly-plan/db'
import { supabaseAdmin } from '@/lib/supabase'
import { isUuid } from '@/lib/validation-utils'

export const dynamic = 'force-dynamic'

const FINGERPRINT = /^[a-f0-9]{64}$/

function refused(status: number, error: string) {
  return NextResponse.json({ error }, { status })
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  if (!isUuid(params.id)) return refused(400, '这个地址不对。')
  const access = await requireDashboardClientAccess(params.id)
  if (!access.ok) return refused(access.status, access.status === 401 ? '请先登录。' : '你不能批这位客户的社媒方案。')
  try {
    return await handle(req, params.id, access)
  } catch (error) {
    const mapped = publicError(error)
    if (mapped.status === 500) return refused(500, '批准没有完成。')
    return refused(mapped.status, mapped.message)
  }
}

async function handle(
  req: Request,
  clientId: string,
  access: { user: { email?: string | null }; role: 'admin' | 'client-viewer'; allowedClientId: string | null },
) {
  const body = await readBody(req)
  const found = await readLatestWeeklyPlan(supabaseAdmin, clientId, targetWeek(new Date()).weekStart)
  if (found === 'unreadable') return refused(500, '方案读不到，没有当成这一周没有方案。')
  if (!found) return refused(404, '还没有这一周的方案，没有出批准卡。')
  const clicker = clickerFromSession({
    email: access.user.email ?? '',
    role: access.role,
    allowedClientId: access.allowedClientId,
    clientId,
    agentMarked: req.headers.get('x-me-actor') === 'agent',
  })
  const kernel = createKernel(supabaseAdmin)
  if (body.action === 'issue') {
    const card = await openWeekPlanApproval({
      issue: (facts, lifetime) => issueConfirmationCard(kernel, { clientId, clicker, facts, now: new Date(), lifetime }),
    }, found.plan, clientId, found.digest)
    return NextResponse.json({ card })
  }
  const result = await decideWeekPlanApproval({
    decide: (input) => decideConfirmationCard(kernel, { clientId, clicker, now: new Date(), ...input }),
    stamp: (approval) => stampWeeklyPlan(supabaseAdmin, found.id, clientId, approval),
  }, {
    plan: found.plan,
    clientId,
    digest: found.digest,
    now: new Date(),
    resolution: body.action,
    runId: body.runId,
    expectedDecisionId: body.expectedDecisionId,
    fingerprint: body.fingerprint,
  })
  if (!result.stamped) return refused(500, '卡已经点了，方案上的批准没有写上。')
  return NextResponse.json({ card: result.card, approval: result.approval })
}

async function readBody(req: Request): Promise<{
  action: 'issue' | 'confirm' | 'decline'
  runId: string
  expectedDecisionId: string
  fingerprint: string
}> {
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    throw coded('请求内容读不懂，没有收下。')
  }
  const body = asRecord(raw)
  const action = body?.action
  if (action !== 'issue' && action !== 'confirm' && action !== 'decline') throw coded('请选择出卡、同意或拒绝。')
  const allowed = action === 'issue' ? ['action'] : ['action', 'runId', 'expectedDecisionId', 'fingerprint']
  if (body && Object.keys(body).some((key) => !allowed.includes(key))) throw coded('请求里带了批准不认识的内容，没有收下。')
  if (action === 'issue') return { action, runId: '', expectedDecisionId: '', fingerprint: '' }
  const runId = body?.runId
  const expectedDecisionId = body?.expectedDecisionId
  const fingerprint = body?.fingerprint
  if (typeof runId !== 'string' || !isUuid(runId)) throw coded('缺少确认卡编号。')
  if (typeof expectedDecisionId !== 'string' || !isUuid(expectedDecisionId)) throw coded('缺少审批编号。')
  if (typeof fingerprint !== 'string' || !FINGERPRINT.test(fingerprint)) throw coded('缺少方案指纹。')
  return { action, runId, expectedDecisionId, fingerprint }
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : null
}

function coded(message: string): Error {
  return new ConfirmationCardError('invalid', message)
}
