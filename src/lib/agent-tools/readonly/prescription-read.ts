/**
 * 诸葛抽屉的三个只读工具（刀 15 只读部分）：
 *   read_prescription_progress —— 处方 + 走到哪一步（复用 prescription-chain 的取数与判定）
 *   read_plan_seed             —— 计划种子（复用 readPlanSeedForClient，现算不落库）
 *   read_spend_and_leads       —— 线索与花费（复用开投前检查最近一份回执，不打 Meta）
 *
 * 🔴 权限：每个工具在 handler 里重跑对应接口现有的权限检查，不新增、不放宽、不自建：
 *    chain / 回执 = requirePaidClientAccess；plan-seed = requirePlanApproverAccess（需内部账号）。
 *    没过 = 返回「读不到」，不降级、不填默认值。
 * 🔴 只读：不起草、不出确认卡、不写 Meta、不读诊断表、不写 action_runs。
 * 🔴 clientId 来自服务端 ctx；prescription_id 只在本客户范围内查。
 *    模型没拿到编号时，用这个客户最新一份已批准或草稿处方（与 assembleZhugeInput 同一范围）。
 */

import { requirePaidClientAccess, requirePlanApproverAccess } from '@/lib/auth/client-access'
import { deriveChainStatus } from '@/lib/prescription-chain/derive'
import { loadChainFacts, serviceReader } from '@/lib/prescription-chain/load'
import { readPlanSeedForClient } from '@/lib/ads-strategy/plan-seed/read-for-client'
import { loadTrackingGateFacts } from '@/lib/ads-tracking-preflight/load-receipt'
import { logDialogRead, type DialogReadOutcome } from './call-record'
import {
  type ReadonlyToolContext,
  type ReadonlyToolModule,
  truncateToolOutput,
  warnOnResourceIds,
  optString,
} from './types'

const UNREAD = '读不到'
const NO_PRESCRIPTION = '这个客户还没有可读的处方'

interface ReadResult {
  outcome: DialogReadOutcome
  body: Record<string, unknown>
}

const unread = (reason: string): ReadResult => ({ outcome: 'unread', body: { read: UNREAD, reason } })
const denied = (reason: string): ReadResult => ({ outcome: 'denied', body: { read: UNREAD, reason } })

/** 跑一次读取：异常一律当「读不到」。只打日志，不写库。 */
async function runRead(
  toolName: string,
  ctx: ReadonlyToolContext,
  read: () => Promise<ReadResult>,
): Promise<string> {
  let result: ReadResult
  try {
    result = await read()
  } catch {
    result = unread('读取出错')
  }
  logDialogRead({ clientId: ctx.clientId, toolName, outcome: result.outcome })
  return truncateToolOutput(JSON.stringify(result.body))
}

function prescriptionIdOf(input: unknown): string | undefined {
  return optString((input as Record<string, unknown> | null)?.prescription_id)
}

/** 与 assembleZhugeInput 相同：本客户最新一份已批准或草稿处方。 */
async function latestPrescriptionId(ctx: ReadonlyToolContext): Promise<string | null> {
  const { data, error } = await ctx.supabase
    .from('prescriptions')
    .select('id')
    .eq('client_id', ctx.clientId)
    .in('status', ['approved', 'draft'])
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : null
  const id = row && typeof row === 'object' && 'id' in row ? (row as { id: unknown }).id : null
  return typeof id === 'string' && id.length > 0 ? id : null
}

async function prescriptionIdFor(ctx: ReadonlyToolContext, input: unknown): Promise<string | null> {
  return prescriptionIdOf(input) ?? await latestPrescriptionId(ctx)
}

const PRESCRIPTION_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    prescription_id: {
      type: 'string',
      description:
        "Optional. Omit it to read THIS client's latest approved or draft prescription. " +
        'Do not invent an id, and do not pass another client\'s id.',
    },
  },
}

async function progressBody(ctx: ReadonlyToolContext, input: unknown): Promise<ReadResult> {
  const access = await requirePaidClientAccess(ctx.clientId)
  if (!access.ok) return denied('没有权限读取这份处方')
  const prescriptionId = await prescriptionIdFor(ctx, input)
  if (!prescriptionId) return unread(NO_PRESCRIPTION)
  const facts = await loadChainFacts(serviceReader(ctx.supabase), {
    clientId: ctx.clientId,
    prescriptionId,
    nowIso: new Date().toISOString(),
  })
  if (facts.prescription.read === 'ok' && facts.prescription.value === null) return unread('处方不存在')
  const { data, error } = await ctx.supabase
    .from('prescriptions')
    .select('id, status, version, goal_id, generated_at, approved_at, error_message')
    .eq('id', prescriptionId)
    .eq('client_id', ctx.clientId)
    .maybeSingle()
  return {
    outcome: 'read',
    body: { read: 'ok', prescription: error || !data ? UNREAD : data, chain: deriveChainStatus(facts) },
  }
}

export const readPrescriptionProgress: ReadonlyToolModule = {
  tool: {
    name: 'read_prescription_progress',
    description:
      'Read-only: one prescription of THIS client (status, version, timestamps) and how far it has got along the ' +
      'chain (inspect, measure, confirm, prescribe, consent, plan, creative, draft, launch). ' +
      "Omit prescription_id to use this client's latest approved or draft prescription. " +
      'Anything that cannot be read says 读不到; never assume a default.',
    input_schema: PRESCRIPTION_INPUT_SCHEMA,
  },

  handler(input, ctx) {
    warnOnResourceIds(input, 'read_prescription_progress')
    return runRead('read_prescription_progress', ctx, () => progressBody(ctx, input))
  },
}

async function planSeedBody(ctx: ReadonlyToolContext, input: unknown): Promise<ReadResult> {
  const access = await requirePlanApproverAccess(ctx.clientId)
  if (!access.ok) return denied('读计划种子需要 Magic Lab 内部账号')
  const prescriptionId = await prescriptionIdFor(ctx, input)
  if (!prescriptionId) return unread(NO_PRESCRIPTION)
  const result = await readPlanSeedForClient(ctx.clientId, prescriptionId)
  if (result.status !== 200 || !result.body.success) return unread(result.body.error ?? '算不出计划种子')
  return { outcome: 'read', body: { read: 'ok', ...result.body } }
}

export const readPlanSeed: ReadonlyToolModule = {
  tool: {
    name: 'read_plan_seed',
    description:
      'Read-only: the suggested plan seed computed live from one prescription of THIS client. Nothing is saved, ' +
      'no draft is created, no money is committed. Requires an internal Magic Lab account; otherwise 读不到. ' +
      "Omit prescription_id to use this client's latest approved or draft prescription.",
    input_schema: PRESCRIPTION_INPUT_SCHEMA,
  },

  handler(input, ctx) {
    warnOnResourceIds(input, 'read_plan_seed')
    return runRead('read_plan_seed', ctx, () => planSeedBody(ctx, input))
  },
}

/** 线索与花费看这两道门：线索进 CRM、广告账户与付款（回执里的花费说明）。 */
const SPEND_LEAD_GATE_KEYS: readonly string[] = ['tracking.lead_reaches_crm', 'env.account_billing']

async function spendBody(ctx: ReadonlyToolContext): Promise<ReadResult> {
  const access = await requirePaidClientAccess(ctx.clientId)
  if (!access.ok) return denied('没有权限读取线索与花费')
  const facts = await loadTrackingGateFacts(ctx.supabase, ctx.clientId)
  if (facts === undefined) return unread('这个客户没有配置开投前追踪检查')
  if (facts.receipt === null) return unread('没有读到最近的检查回执')
  const gates = facts.receipt.gates
    .filter(g => SPEND_LEAD_GATE_KEYS.includes(g.key))
    .map(g => ({ key: g.key, status: g.status, reason: g.reason, as_of: g.as_of }))
  return { outcome: 'read', body: { read: 'ok', checked_at: facts.receipt.checked_at, gates } }
}

export const readSpendAndLeads: ReadonlyToolModule = {
  tool: {
    name: 'read_spend_and_leads',
    description:
      'Read-only: the latest stored pre-launch tracking receipt for THIS client: whether website leads reach the CRM ' +
      '(tracking.lead_reaches_crm) and the ad-account spend/billing gate, with the checked-at time. ' +
      'Does not call Meta. No receipt, or no tracking check configured for the client, means 读不到.',
    input_schema: { type: 'object', properties: {} },
  },

  handler(input, ctx) {
    warnOnResourceIds(input, 'read_spend_and_leads')
    return runRead('read_spend_and_leads', ctx, () => spendBody(ctx))
  },
}
