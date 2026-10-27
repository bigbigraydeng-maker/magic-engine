/**
 * 对话框只读工具调用的 Kernel 动作记录。
 *
 * 每次调用在 action_runs 里落一行（复用现有表，不加表、不迁移），方式与
 * marketing-plan/promo/plan-draft-kernel.ts 一致：直接 insertRun。
 * 🔴 只记「调了什么、读没读到」；不记返回内容。记录失败绝不影响工具本身的返回。
 * triggered_by 用 'agent'（Kernel 的 TriggeredBy 没有「对话框」取值，不为此改共享类型），
 * 用 triggered_by_ref = 'zhuge_dialog' 标明来源是诸葛抽屉对话框。
 */

import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { insertRun } from '@/lib/kernel/store'

export const DIALOG_TRIGGER_REF = 'zhuge_dialog'

export type DialogReadOutcome = 'read' | 'unread' | 'denied'

export async function recordDialogRead(
  sb: SupabaseClient,
  call: { clientId: string; toolName: string; input: Record<string, unknown>; outcome: DialogReadOutcome },
): Promise<void> {
  const actionKey = `zhuge.${call.toolName}`
  try {
    await insertRun(sb, {
      client_id: call.clientId,
      purpose: 'maintenance',
      goal_id: null,
      triggered_by: 'agent',
      triggered_by_ref: DIALOG_TRIGGER_REF,
      action_key: actionKey,
      action_version: 1,
      input: call.input,
      rationale: null,
      evidence: { read_only: true, outcome: call.outcome },
      idempotency_key: `${actionKey}:${randomUUID()}`,
      status: call.outcome === 'read' ? 'succeeded' : 'failed',
      cost_cap_usd: 0,
      cost_estimate_usd: 0,
      needs_human: false,
      last_error: call.outcome === 'read' ? null : `read_${call.outcome}`,
      correlation_id: randomUUID(),
      finished_at: new Date().toISOString(),
    })
  } catch (err) {
    console.warn('[zhuge dialog read] record failed', err instanceof Error ? err.message : '未知错误')
  }
}
