/**
 * 「这条动作现在还被谁认着」—— 把库里的行推导成一个背书结论。
 *
 * 纯函数，不查库：调用方把方案行 / 营销计划行读回来喂进来。
 * 这样这段判断能被单测钉死 —— 它是整套自动执行的主安全闸，
 * 推错一格的后果是「机器照着三个月前作废的判断替客户干活」。
 *
 * 🔴 必须 join `prescriptions.status`，不能只看 `prescription_id` 有没有值。
 *    只看有没有值的话，`stale_prescription` 这条分支**永远不会触发** ——
 *    主安全闸变成一段死代码，而库里恰恰有整批挂在已作废方案下的动作。
 *
 * 🔴 `marketing_plan_id` 是第二个有效锚点。
 *    表约束（20260628000001）规定 `source='marketing_plan'` 的行
 *    `prescription_id` **必为 NULL** —— 只认方案的话，营销计划派下来的动作
 *    会被整批判成「没人认领」（库里 33 件，6-08 那批）。它们不是没人认领，
 *    是挂在另一根锚上，而那根锚有自己的有效期。
 *
 * 🔴 join 回来的锚点行必须核对 `client_id` 是不是这条动作自己的客户。
 *    DB 层没有约束保证 `execution_items.prescription_id` 只能指向同客户的方案 ——
 *    脏数据或未来 bug 一旦让它指错，不查的话就会拿别的客户的方案背书这条动作。
 *    这正是本仓库反复出现过的「跨客户错配」事故的同一类洞，主安全闸不能留这个口子。
 */

import type { Endorsement } from './auto-run-policy'

/** execution_items.source 的 7 个取值 —— 每个都必须有明确归宿，认不出的走保守分支。 */
export type ExecutionItemSourceValue =
  | 'diagnostic'
  | 'marketing_plan'
  | 'fde_manual'
  | 'proactive_signal'
  | 'zhuge'
  | 'luban'
  | 'fde'

/**
 * 这些来源在**没有任何锚点**时算「近期分析产物」——
 * 诸葛亮当天/本周的卡、鲁班工具产出、主动信号，都是某一轮分析刚刚吐出来的判断。
 * 新鲜期由 judgeAutoRun 的 ENDORSEMENT_FRESH_DAYS 管，这里只负责定性。
 *
 * 🔴 `fde` / `fde_manual` **不在这里**：人手加到看板上的卡没有「生成时刻」的含义，
 *    它可能是三个月前顺手记的一笔。人加的东西要机器去跑，得走方案那根锚。
 */
const ANALYSIS_SOURCES: ReadonlySet<string> = new Set([
  'zhuge',
  'proactive_signal',
  'luban',
])

export interface PrescriptionAnchor {
  client_id: string
  status: string
  approved_at: string | null
  generated_at: string | null
}

export interface MarketingPlanAnchor {
  client_id: string
  status: string
  approved_at: string | null
  end_date: string | null
}

export interface EndorsementInput {
  source: string
  /** 这条动作属于哪个客户 —— 用来核对锚点行是不是这个客户自己的 */
  clientId: string
  /** 这条动作是什么时候进的看板 */
  createdAt: string | null
  prescriptionId: string | null
  /** join 回来的方案行；null = 这条方案已经不在了 */
  prescription: PrescriptionAnchor | null
  marketingPlanId: string | null
  /** join 回来的营销计划行；null = 计划已经不在了 */
  marketingPlan: MarketingPlanAnchor | null
}

export function ageInDays(iso: string | null | undefined, now: Date): number {
  if (!iso) return Infinity
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return Infinity
  return Math.max(0, (now.getTime() - t) / 86_400_000)
}

/**
 * 推导背书。顺序有讲究：先看有没有锚点，再看锚点还有没有效，最后才看来源。
 *
 * 拿不准的一律往保守那边落（unendorsed），因为放行的代价是替客户做错事，
 * 拦下的代价只是这件事今天没自动做。
 */
export function deriveEndorsement(input: EndorsementInput, now: Date): Endorsement {
  const itemAge = ageInDays(input.createdAt, now)

  // ── 锚点一：处方 ──────────────────────────────────────────────────────────
  if (input.prescriptionId) {
    const p = input.prescription
    // 方案行查不回来（被删了 / join 没命中）→ 当成没有背书。
    // 🔴 不能当成「有 prescription_id 就算数」：那正是让 stale 分支变死代码的写法。
    if (!p) return { kind: 'unendorsed', ageDays: itemAge }
    // 🔴 查回来的方案必须是这个客户自己的。没有 DB 层约束保证
    //    execution_items.prescription_id 只能指向同客户的方案，脏数据/未来 bug
    //    一旦让它指错，这里不查就会拿别的客户的方案背书这条动作 —— 跟"没有背书"
    //    一样处理，而不是相信一个查回来但对不上客户的行。
    if (p.client_id !== input.clientId) return { kind: 'unendorsed', ageDays: itemAge }

    if (p.status === 'approved') {
      // 年龄从批准时刻算；没有批准时刻就退回生成时刻，两个都没有就当无穷老。
      return {
        kind: 'current_prescription',
        ageDays: ageInDays(p.approved_at ?? p.generated_at, now),
      }
    }
    // draft / superseded / rejected / generating / failed —— 都不是「现在生效的判断」。
    // 🔴 draft 也算 stale：还没批的方案不能当授权用，否则草稿一写出来就等于放行。
    return { kind: 'stale_prescription' }
  }

  // ── 锚点二：营销计划 ──────────────────────────────────────────────────────
  if (input.marketingPlanId) {
    const m = input.marketingPlan
    if (!m) return { kind: 'unendorsed', ageDays: itemAge }
    // 同上：查回来的计划也必须是这个客户自己的
    if (m.client_id !== input.clientId) return { kind: 'unendorsed', ageDays: itemAge }

    if (m.status !== 'approved') {
      // draft / completed / archived —— 计划没在跑，它派下来的活也不该自动跑
      return { kind: 'stale_marketing_plan' }
    }
    // 计划有结束日期且已经过了 → 这一期做完了，别再补作业
    if (m.end_date && Date.parse(m.end_date) < now.getTime()) {
      return { kind: 'stale_marketing_plan' }
    }
    return {
      kind: 'current_marketing_plan',
      ageDays: ageInDays(m.approved_at, now),
    }
  }

  // ── 没有锚点：只有「刚分析出来的」还算数 ──────────────────────────────────
  if (ANALYSIS_SOURCES.has(input.source)) {
    return { kind: 'recent_analysis', ageDays: itemAge }
  }

  // diagnostic 走到这里说明 prescription_id 是空的（表约束本不允许，但库里有历史行）；
  // fde / fde_manual 是人手加的；认不出的来源也落这里。三种都没有任何一轮判断在背书。
  return { kind: 'unendorsed', ageDays: itemAge }
}
