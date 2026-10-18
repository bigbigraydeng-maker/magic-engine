/**
 * 给 FDE 的空白模板：只有一个覆盖整个计划期的阶段、没有步骤、目标编号留空。
 * 故意不含任何示例金额 / 账户 / 素材——填之前保存会因为"目标不存在"被拒绝，不会把示例当真数据存进去。
 */

import type { PromoSpec } from './spec'

export function buildPromoTemplate(plan: { start_date: string | null; end_date: string | null }): PromoSpec {
  const start = plan.start_date ?? ''
  const end = plan.end_date ?? ''
  return {
    schema: 'promo_v1',
    goal_id: '',
    phases: [{ id: 'phase-1', name: '阶段 1', start_date: start, end_date: end, steps: [] }],
    checks: [],
  }
}
