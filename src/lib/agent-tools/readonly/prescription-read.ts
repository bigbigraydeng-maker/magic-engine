/**
 * 诸葛抽屉的三个只读工具（刀 15 只读部分）：
 *   read_prescription_progress —— 处方 + 走到哪一步（复用 prescription-chain 的取数与判定）
 *   read_plan_seed             —— 计划种子（复用 readPlanSeedForClient，现算不落库）
 *   read_spend_and_leads       —— 线索与花费（复用开投前检查最近一份回执，不打 Meta）
 *
 * 🔴 权限：每个工具在 handler 里重跑对应接口现有的权限检查，不新增、不放宽、不自建：
 *    chain / 回执 = requirePaidClientAccess；plan-seed = requirePlanApproverAccess（需内部账号）。
 *    没过 = 返回「读不到」，不降级、不填默认值。
 * 🔴 只读：不起草、不出确认卡、不写 Meta、不读诊断表。
 * 🔴 clientId 来自服务端 ctx；prescription_id 只在本客户范围内查。
 * 🔴 每次调用记一条 Kernel 动作记录（见 call-record.ts）。
 */

import { requirePaidClientAccess, requirePlanApproverAccess } from '@/lib/auth/client-access'
import { deriveChainStatus } from '@/lib/prescription-chain/derive'
import { loadChainFacts, serviceReader } from '@/lib/prescription-chain/load'
import { readPlanSeedForClient } from '@/lib/ads-strategy/plan-seed/read-for-client'
import { loadTrackingGateFacts } from '@/lib/ads-tracking-preflight/load-receipt'
import { recordDialogRead, type DialogReadOutcome } from './call-record'
import {
  type ReadonlyToolContext,
  type ReadonlyToolModule,
  truncateToolOutput,
  warnOnResourceIds,
  optString,
} from './types'

const UNREAD = '读不到'

interface ReadResult {
  outcome: DialogReadOutcome
  body: Record<string, unknown>
}

const unread = (reason: string): ReadResult => ({ outcome: 'unread', body: { read: UNREAD, reason } })
const denied = (reason: string): ReadResult => ({ outcome: 'denied', body: { read: UNREAD, reason } })

/** 跑一次读取：异常一律当「读不到」，并记一条动作记录。 */
async function runRead(
  toolName: string,
  ctx: ReadonlyToolContext,
  input: Record<string, unknown>,
  read: () => Promise<ReadResult>,
): Promise<string> {
  let result: ReadResult
  try {
    result = await read()
  } catch {
    result = unread('读取出错')
  }
  await recordDialogRead(ctx.supabase, { clientId: ctx.clientId, toolName, input, outcome: result.outcome })
  return truncateToolOutput(JSON.stringify(result.body))
}

function prescriptionIdOf(input: unknown): string | undefined {
  return optString((input as Record<string, unknown> | null)?.prescription_id)
}

const PRESCRIPTION_INPUT_SCHEMA = {
  type: 'object' as const,
  properties: {
    prescription_id: { type: 'string', description: "The prescription id (from this client's prescription list)." },
  },
  required: ['prescription_id'],
}

export const readPrescriptionProgress: ReadonlyToolModule = {
  tool: {
    name: 'read_prescription_progress',
    description:
      'Read-only: one prescription of THIS client (status, version, timestamps) and how far it has got along the ' +
      'chain (inspect, measure, confirm, prescribe, consent, plan, creative, draft, launch). ' +
      'Anything that cannot be read says 读不到; never assume a default.',
    input_schema: PRESCRIPTION_INPUT_SCHEMA,
  },

  async handler(input, ctx) {
    warnOnResourceIds(input, 'read_prescription_progress')
    const prescriptionId = prescriptionIdOf(input)
    if (!prescriptionId) return JSON.stringify({ read: UNREAD, reason: '缺少 prescription_id' })
    return runRead('read_prescription_progress', ctx, { prescription_id: prescriptionId }, async () => {
      const access = await requirePaidClientAccess(ctx.clientId)
      if (!access.ok) return denied('没有权限读取这份处方')
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
    })
  },
}

export const readPlanSeed: ReadonlyToolModule = {
  tool: {
    name: 'read_plan_seed',
    description:
      'Read-only: the suggested plan seed computed live from one prescription of THIS client. Nothing is saved, ' +
      'no draft is created, no money is committed. Requires an internal Magic Lab account; otherwise 读不到.',
    input_schema: PRESCRIPTION_INPUT_SCHEMA,
  },

  async handler(input, ctx) {
    warnOnResourceIds(input, 'read_plan_seed')
    const prescriptionId = prescriptionIdOf(input)
    if (!prescriptionId) return JSON.stringify({ read: UNREAD, reason: '缺少 prescription_id' })
    return runRead('read_plan_seed', ctx, { prescription_id: prescriptionId }, async () => {
      const access = await requirePlanApproverAccess(ctx.clientId)
      if (!access.ok) return denied('读计划种子需要 Magic Lab 内部账号')
      const result = await readPlanSeedForClient(ctx.clientId, prescriptionId)
      if (result.status !== 200 || !result.body.success) return unread(result.body.error ?? '算不出计划种子')
      return { outcome: 'read', body: { read: 'ok', ...result.body } }
    })
  },
}

/** 线索与花费看这两道门：线索进 CRM、广告账户与付款（回执里的花费说明）。 */
const SPEND_LEAD_GATE_KEYS: readonly string[] = ['tracking.lead_reaches_crm', 'env.account_billing']

export const readSpendAndLeads: ReadonlyToolModule = {
  tool: {
    name: 'read_spend_and_leads',
    description:
      'Read-only: the latest stored pre-launch tracking receipt for THIS client: whether website leads reach the CRM ' +
      '(tracking.lead_reaches_crm) and the ad-account spend/billing gate, with the checked-at time. ' +
      'Does not call Meta. No receipt, or no tracking check configured for the client, means 读不到.',
    input_schema: { type: 'object', properties: {} },
  },

  async handler(input, ctx) {
    warnOnResourceIds(input, 'read_spend_and_leads')
    return runRead('read_spend_and_leads', ctx, {}, async () => {
      const access = await requirePaidClientAccess(ctx.clientId)
      if (!access.ok) return denied('没有权限读取线索与花费')
      const facts = await loadTrackingGateFacts(ctx.supabase, ctx.clientId)
      if (facts === undefined) return unread('这个客户没有配置开投前追踪检查')
      if (facts.receipt === null) return unread('没有读到最近的检查回执')
      const gates = facts.receipt.gates
        .filter(g => SPEND_LEAD_GATE_KEYS.includes(g.key))
        .map(g => ({ key: g.key, status: g.status, reason: g.reason, as_of: g.as_of }))
      return { outcome: 'read', body: { read: 'ok', checked_at: facts.receipt.checked_at, gates } }
    })
  },
}
