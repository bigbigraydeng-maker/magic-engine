/**
 * 处方「落地」—— 把一份方案变成执行看板上的动作。
 *
 * 这段逻辑原本只长在 PATCH /api/clients/[id]/prescription/[pId] 里（人工点批准）。
 * 现在周更也要落地处方（PM 2026-08-04 拍板：方案自动落地，只在待办里通知一声），
 * 所以抽出来给两边共用 —— 复制一份等于以后修 bug 要修两处，必漏一处。
 *
 * 顺序是有讲究的，别改：
 *   派生 Initiative → 生成执行项 → 归档被修订的旧处方 → 最后才标 approved
 * 执行项生成失败时处方保持 draft —— 宁可"没批准"，也不能"已批准但看板上没动作"，
 * 后者从界面上完全看不出来，等于把问题藏起来。
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Prescription } from '@/types/diagnostic'
import { deriveInitiativesFromPrescription } from './initiative-derive'
import { generateExecutionItems } from './execution-generator'

/** 落地一份处方需要的最小字段集 —— 调用方自己 select 这几列即可。 */
export type LandablePrescription = Pick<
  Prescription,
  'id' | 'client_id' | 'goal_id' | 'version' | 'content' | 'supersedes_id'
>

export interface LandPrescriptionResult {
  /** 派生出的 Initiative 数 */
  initiativesInserted: number
  /** 生成的执行项数 —— 这是「方案有没有真的变成活儿」的唯一硬指标 */
  executionItems: number
  /** 人话日志，给 cron summary / console 用 */
  notes: string[]
}

/**
 * 落地。失败会 throw —— 调用方负责决定怎么呈现（路由返 500 / cron 记 error）。
 *
 * @param approvedBy 谁批的。写进日志备查；**不写进表**（prescriptions 没有这一列，
 *                   写了整条 UPDATE 会失败）。
 */
export async function landPrescription(
  supabase: SupabaseClient,
  prescription: LandablePrescription,
  approvedBy?: string,
): Promise<LandPrescriptionResult> {
  const notes: string[] = []
  let initiativesInserted = 0
  let initiativeIdsByPhase: Record<number, string> = {}

  // Initiative 派生失败**不阻塞**落地 —— 沿用原路由的既定行为：
  // 派生只是把方案的阶段挂到目标下，挂不上不代表动作做不了。
  try {
    const r = await deriveInitiativesFromPrescription(supabase, prescription)
    initiativeIdsByPhase = r.initiativeIdsByPhase
    initiativesInserted = r.inserted
    notes.push(`派生 Initiative ${r.inserted} 个（跳过 ${r.skipped} 个）`)
    notes.push(...r.notes)
  } catch (e) {
    // 不 rethrow：这是刻意的，原因见上
    notes.push(`Initiative 派生失败（不阻塞）：${e instanceof Error ? e.message : String(e)}`)
  }

  // 执行项生成失败**必须**阻塞 —— 没有执行项的"已批准处方"是幽灵
  const items = await generateExecutionItems(supabase, prescription.id, prescription.client_id, {
    initiativeIdsByPhase,
  })
  notes.push(`生成执行项 ${items.length} 条`)

  // 修订版落地 → 把被它替代的那一份归档，否则看板上会同时挂着两版方案
  if (prescription.supersedes_id) {
    const { error } = await supabase
      .from('prescriptions')
      .update({ status: 'superseded' })
      .eq('id', prescription.supersedes_id)
      .eq('client_id', prescription.client_id)
    if (error) {
      // 非致命：新方案已经落地了，旧的没归档只是界面上多一份
      notes.push(`旧处方归档失败（非致命）：${error.message}`)
    } else {
      notes.push('已归档被替代的上一版处方')
    }
  }

  const { error: updErr } = await supabase
    .from('prescriptions')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('id', prescription.id)
    .eq('client_id', prescription.client_id)
  if (updErr) throw new Error(`标记处方已批准失败：${updErr.message}`)

  if (approvedBy) notes.push(`批准人：${approvedBy}`)

  return { initiativesInserted, executionItems: items.length, notes }
}
