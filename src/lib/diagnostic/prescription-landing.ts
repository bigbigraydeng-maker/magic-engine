/**
 * 处方「落地」—— 把一份方案变成执行看板上的动作。
 *
 * 这段逻辑原本只长在 PATCH /api/clients/[id]/prescription/[pId] 里（人工点批准）。
 * 现在周更也要落地处方（PM 2026-08-04 拍板：方案自动落地，只在待办里通知一声），
 * 所以抽出来给两边共用 —— 复制一份等于以后修 bug 要修两处，必漏一处。
 *
 * 顺序是有讲究的，别改：
 *   派生 Initiative → 生成执行项 → 归档上一版（含它没人动过的动作）→ 最后才标 approved
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

/**
 * 归档上一版时，哪些动作可以跟着一起作废。
 *
 * 🔴 只作废**没人动过的**。in_progress 是 FDE 已经开了工，completed 是已经做完的战果，
 *    把这两种抹成 superseded 等于抹掉别人的工作记录。skipped 是人主动跳过的，也不动。
 */
const SUPERSEDABLE_ITEM_STATUSES = ['pending'] as const

/**
 * 这条动作是不是 FDE 在看板上**手工加**的。
 *
 * 🔴 手工加的活也会落成 `source='diagnostic'` —— 那条路由（`execution/route.ts`
 *    里「手动新增执行项」那个 insert）没写 source 列，吃的是数据库默认值，
 *    真正的出处埋在 `steps_json` 里。库里现存 3 条，其中 1 条还是 pending。
 *    它三道保护一道都不占：状态是待办、没有生成失败、而那条路由补操作日志是
 *    「发了不管」（不 await），可能压根没写上。
 *
 * 🔴 **导出**给报数那侧共用，不许两边各写一遍。
 *    这个函数所在的这条链，三轮复审里有三次缺陷都出在「写侧改了读侧没跟上」：
 *    时间窗 → 诸葛亮的卡 → 手工加的活。判据必须是同一份代码，不是同一个意思。
 *
 * 🔴 也别想着在 SQL 里写 `.not('steps_json->>source', 'eq', 'fde_manual_add')`：
 *    库里 116 条 diagnostic 动作有 113 条根本没有 source 这个键，
 *    `NOT (NULL = 'x')` 是 NULL 不是 true —— 那样写会把 116 条全过滤掉、
 *    数字恒等于 0，且不报任何错。必须取回来在代码里判。
 */
export function isHandAddedItem(row: { steps_json: Record<string, unknown> | null }): boolean {
  return row.steps_json?.source === 'fde_manual_add'
}

/**
 * 作废上一版里**真的没人碰过**的动作。
 *
 * 🔴 光看 status='pending' 不够 —— pending 里混着已经被人动过的：
 *    内容生成失败时状态会**退回 pending**，同时留下 `generation_error`，
 *    卡片在界面上显示「失败 [重试]」，那是 FDE 等着重跑的活，不是没人要的活。
 *    留过操作日志（execution_logs）的同理。库里实测这两类都真实存在。
 *    抹掉它们 = 悄悄吃掉别人的在办事项，而且从界面上完全看不出来。
 */
async function supersedeUntouchedItems(
  supabase: SupabaseClient,
  priorPrescriptionId: string,
  clientId: string,
): Promise<{ count: number; kept: number; error?: string }> {
  const { data: rows, error } = await supabase
    .from('execution_items')
    .select('id, generation_error, steps_json')
    .eq('prescription_id', priorPrescriptionId)
    .eq('client_id', clientId)
    // 🔴 只碰**这份方案自己生成的**动作。
    //    诸葛亮的看板推荐卡也会写同一个 prescription_id，但那是**归属标记**
    //    （这批建议是在哪份方案的上下文下产生的），不是「属于这份方案的执行计划」。
    //    不加这一条的话，每周会把诸葛亮当天刚算出来、让 FDE 今天去做的事一起抹掉 ——
    //    库里实测 CTS 挂在方案下的 9 条待办**全是**诸葛亮昨天生成的。
    //    而且是循环的：诸葛亮每次把新卡挂到当前方案上，方案周更每周连卡一起清。
    .eq('source', 'diagnostic')
    .in('status', SUPERSEDABLE_ITEM_STATUSES as unknown as string[])
  if (error) return { count: 0, kept: 0, error: error.message }

  const all = (rows ?? []) as Array<{
    id: string
    generation_error: string | null
    steps_json: Record<string, unknown> | null
  }>
  if (all.length === 0) return { count: 0, kept: 0 }

  // 生成失败过的：有人在等着重试，留着。人手工加的：本来就不归这份方案管，留着
  const untouched = all.filter((r) => r.generation_error == null && !isHandAddedItem(r))
  let kept = all.length - untouched.length
  if (untouched.length === 0) return { count: 0, kept }

  // 留过操作日志的：有人在上面写过东西，留着。
  // 🔴 这一步查失败必须**整轮不删**（fail-closed）。原来没接 error：
  //    查询一挂 `logged` 就是 null、`hasLog` 是空集，于是"有人动过就留着"
  //    这道保护静默消失、全部照删 —— 保护性查询失败偏向"删"是反的。
  const { data: logged, error: logErr } = await supabase
    .from('execution_logs')
    .select('execution_item_id')
    .in('execution_item_id', untouched.map((r) => r.id))
  if (logErr) {
    return { count: 0, kept: all.length, error: `查不到操作记录，这轮不动任何旧动作：${logErr.message}` }
  }
  const hasLog = new Set(
    ((logged ?? []) as Array<{ execution_item_id: string }>).map((l) => l.execution_item_id),
  )
  const finalIds = untouched.filter((r) => !hasLog.has(r.id)).map((r) => r.id)
  kept += untouched.length - finalIds.length
  if (finalIds.length === 0) return { count: 0, kept }

  const { data: dropped, error: dropErr } = await supabase
    .from('execution_items')
    .update({ status: 'superseded' })
    .in('id', finalIds)
    .eq('client_id', clientId)
    // 🔴 状态条件必须**再查一遍**。上面 SELECT 到这里 UPDATE 之间隔了两个来回，
    //    FDE 点一下「生成内容」就会把某条从待办提到进行中 —— 不带这个条件
    //    就会把他刚开工的活盖成作废。原来是单条 UPDATE 内联的，拆成三步才漏出这个窗口。
    .in('status', SUPERSEDABLE_ITEM_STATUSES as unknown as string[])
    .select('id')
  if (dropErr) return { count: 0, kept, error: dropErr.message }
  return { count: dropped?.length ?? 0, kept }
}

export interface LandPrescriptionResult {
  /** 派生出的 Initiative 数。**0 表示这批动作没挂到任何目标下** —— 调用方要照实说 */
  initiativesInserted: number
  /** 生成的执行项数 —— 这是「方案有没有真的变成活儿」的唯一硬指标 */
  executionItems: number
  /** 归档上一版时顺带作废的旧动作数 */
  supersededItems: number
  /** 人话日志，给 cron summary / console 用 */
  notes: string[]
}

/** 只写一行、且必须命中一行的 update。命中 0 行时 PostgREST 不报错，得自己发现。 */
async function updateOneRow(
  supabase: SupabaseClient,
  patch: Record<string, unknown>,
  where: { id: string; clientId: string },
): Promise<{ ok: true } | { ok: false; why: string }> {
  const { data, error } = await supabase
    .from('prescriptions')
    .update(patch)
    .eq('id', where.id)
    .eq('client_id', where.clientId)
    .select('id')
  if (error) return { ok: false, why: error.message }
  // 🔴 命中 0 行也是 error:null —— 不显式检查的话，"什么都没写进去"会被当成成功。
  //    团队记忆里那条「PATCH 匹配 0 行前后都 204，探针分辨不出两种结果」就是这个形状。
  if (!data || data.length === 0) return { ok: false, why: '没有匹配到这条处方（id 或客户对不上）' }
  return { ok: true }
}

/**
 * 落地。失败会 throw —— 调用方负责决定怎么呈现（路由返 500 / cron 记 error 并把处方标 failed）。
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
  let supersededItems = 0
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

  // 归档上一版。不做的话看板会一周一层往上堆，且新旧动作长得一模一样、分不出哪条还算数。
  if (prescription.supersedes_id) {
    const archived = await updateOneRow(
      supabase,
      { status: 'superseded' },
      { id: prescription.supersedes_id, clientId: prescription.client_id },
    )
    if (!archived.ok) {
      // 非致命：新方案已经落地了，旧的没归档只是界面上多一份
      notes.push(`上一版处方归档失败（非致命）：${archived.why}`)
    } else {
      // 光归档处方不够 —— 看板查执行项时只按客户过滤，不看处方状态。
      // 旧方案里没人动过的动作必须一起作废，否则堆积的是动作不是处方。
      const dropResult = await supersedeUntouchedItems(
        supabase,
        prescription.supersedes_id,
        prescription.client_id,
      )
      if (dropResult.error) {
        notes.push(`旧动作作废失败（非致命）：${dropResult.error}`)
      } else {
        supersededItems = dropResult.count
        notes.push(
          `归档上一版，作废没人碰过的旧动作 ${supersededItems} 条` +
            (dropResult.kept > 0 ? `；另有 ${dropResult.kept} 条有人动过，原样留着` : ''),
        )
      }
    }
  }

  const marked = await updateOneRow(
    supabase,
    { status: 'approved', approved_at: new Date().toISOString() },
    { id: prescription.id, clientId: prescription.client_id },
  )
  if (!marked.ok) throw new Error(`标记处方已批准失败：${marked.why}`)

  if (approvedBy) notes.push(`批准人：${approvedBy}`)

  return { initiativesInserted, executionItems: items.length, supersededItems, notes }
}
