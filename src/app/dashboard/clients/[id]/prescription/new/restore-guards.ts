/**
 * /prescription/new 自动恢复处方的判断逻辑（纯函数，可单测）
 *
 * 抽出原因（2026-06-08 BUG-FMT-W4-1 修复）:
 *   /api/clients/[id]/prescriptions/latest-draft 会返回 draft/generating/failed/approved
 *   四种状态的最新处方（因为客户详情页 dashboard/clients/[id]/page.tsx 也要消费这个
 *   endpoint 判断 prescriptionStatus，所以 API 不能去掉 approved）。
 *
 *   但 /prescription/new 页 mount 时若拿到 approved，自动 setStep(3) 跳到审阅页就把
 *   W4 新加的 Step 1 Goal selector 卡死了。用户根本进不去新建流程。
 *
 *   修法：在前端 useEffect 里加一道 guard——approved 不自动恢复，让用户停留在 Step 1。
 *   想看 approved 应去 /dashboard/clients/[id]/execution（执行看板）。
 *
 * 注意:
 *  - draft / generating / failed → 应自动恢复 (用户工作中断后回来继续审阅)
 *  - approved → 不自动恢复 (已锁定，不该卡新建流程)
 *  - rejected / superseded → API 不返回（在 SELECT WHERE in 列表外）
 *  - 其它未知状态 → 保守按"不恢复"处理
 */

import type { Prescription, PrescriptionStatus } from '@/types/diagnostic'

/**
 * Statuses that should auto-restore Step 3 review on mount.
 * 与 API /prescriptions/latest-draft 的返回集合（draft/generating/failed/approved）配合：
 * 所有 in-progress 的状态都恢复，approved 单独排除。
 */
const RESTORABLE_STATUSES: ReadonlySet<PrescriptionStatus> = new Set<PrescriptionStatus>([
  'draft',
  'generating',
  'failed',
])

export interface RestoreContext {
  /** 当前 Step (1=intake / 2=generating / 3=review) */
  step: 1 | 2 | 3
  /** 是否正在主动生成（mount 时通常 false） */
  isGenerating: boolean
  /** API 拿到的处方（可能不存在 / content 缺失） */
  prescription: Pick<Prescription, 'id' | 'status' | 'content'> | null | undefined
}

/**
 * 是否应该把 API 拿到的 latest 处方自动恢复成 Step 3 审阅态。
 *
 * 返回 true 仅当 **所有** 条件满足：
 *  1. prescription 存在且有 content (生成中的处方 content 可能为 null)
 *  2. 当前在 Step 1 且不在生成中 (避免覆盖用户正在做的事)
 *  3. status 在 RESTORABLE_STATUSES 内 (排除 approved — BUG-FMT-W4-1)
 */
export function shouldAutoRestoreLatestDraft(ctx: RestoreContext): boolean {
  const { step, isGenerating, prescription } = ctx
  if (!prescription) return false
  if (!prescription.content) return false
  if (step !== 1 || isGenerating) return false
  return RESTORABLE_STATUSES.has(prescription.status)
}
