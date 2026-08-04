/**
 * 处方审批（批准 / 拒绝）写库 payload 的构造 —— 带生产库列白名单。
 *
 * 背景（2026-08-04 事故）：PATCH 路由曾直接写 `rejection_note` / `approved_by`
 * 两个生产库根本不存在的列 → PostgREST 报 PGRST204 → 整个 UPDATE 失败 → 路由
 * 返回 500 `Failed to update prescription`，处方页「重新生成」全程不可用。
 * （生产库 14 份处方里 0 份 rejected，就是这条路径从没成功过的证据。）
 *
 * 这里把 payload 构造收成纯函数，并用 `PRESCRIPTION_COLUMNS` 把类型收窄到真实
 * 列上 —— 再往 patch 上写幻觉列，TypeScript 直接编译不过。
 */

/**
 * `prescriptions` 表的真实列（2026-08-04 直连生产库核实）。
 * 加列 / 改列后必须同步更新这里，否则新列写不进去。
 *
 * `rejection_note` / `approved_by` 由
 * `20260804020000_prescriptions_approval_audit.sql` 补上（生产库 2026-08-04 已生效）。
 */
export const PRESCRIPTION_COLUMNS = [
  'id',
  'client_id',
  'run_id',
  'discovery_id',
  'goal_id',
  'status',
  'version',
  'intake',
  'content',
  'self_grade',
  'benchmarks_used',
  'generation_meta',
  'agent_name',
  'agent_version',
  'progress_note',
  'error_message',
  'rejection_note',
  'approved_by',
  'supplements_id',
  'supersedes_id',
  'generated_at',
  'approved_at',
  'created_at',
  'updated_at',
] as const

export type PrescriptionColumn = (typeof PRESCRIPTION_COLUMNS)[number]

/** 只允许写真实存在的列 —— 幻觉列在编译期就被挡掉 */
export type PrescriptionPatch = Partial<Record<PrescriptionColumn, unknown>>

export interface PrescriptionDecision {
  status: 'approved' | 'rejected'
  /** 打回理由（可选） */
  rejection_note?: string
  /** 批准人邮箱 —— 服务端从登录会话取，不接受前端传值 */
  approved_by?: string
}

/**
 * 构造 approve / reject 的 UPDATE payload。
 *
 * - `approved` → approved_at 时间戳 + approved_by 批准人
 * - `rejected` + 有理由 → rejection_note 留痕
 */
export function buildPrescriptionDecisionPatch(
  decision: PrescriptionDecision,
  now: Date = new Date(),
): PrescriptionPatch {
  const patch: PrescriptionPatch = { status: decision.status }

  if (decision.status === 'approved') {
    patch.approved_at = now.toISOString()
    if (decision.approved_by) patch.approved_by = decision.approved_by
  }

  if (decision.status === 'rejected' && decision.rejection_note) {
    patch.rejection_note = decision.rejection_note
  }

  return patch
}
