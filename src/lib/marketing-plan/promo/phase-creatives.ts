/**
 * 一个阶段里「广告」步骤引用的素材编号（去重，保持出现顺序）。
 * 和检查清单「投放素材已批准」那道门读的是同一份：phase.steps 里 ads_campaign 的 settings.creative_refs。
 * 读不到计划结构、或找不到这个阶段 → null（页面写「读不到素材清单」，门保持红，不猜）。
 */

import type { PromoSpec } from './spec'

export function creativeRefsOfPhase(spec: PromoSpec | null, phaseId: string): string[] | null {
  if (!spec) return null
  const phase = spec.phases.find(p => p.id === phaseId)
  if (!phase) return null
  const out: string[] = []
  for (const step of phase.steps) {
    if (step.kind !== 'ads_campaign') continue
    for (const ref of step.settings.creative_refs) {
      if (!out.includes(ref)) out.push(ref)
    }
  }
  return out
}
