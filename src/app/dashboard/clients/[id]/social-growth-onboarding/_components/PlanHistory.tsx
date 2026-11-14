'use client'

import { INDUSTRY_PROFILES } from '@/lib/social-onboarding/industry-profiles'
import type { Plan } from './types'

export function PlanHistory({ plans, selectedId, onSelect }: { plans: Plan[]; selectedId: string | null; onSelect: (plan: Plan) => void }) {
  return (
    <aside className="rounded-2xl border border-me-stone bg-white p-4">
      <h2 className="font-display font-bold">方案记录</h2>
      <div className="mt-3 space-y-2">
        {plans.map((plan) => <button key={plan.id} type="button" onClick={() => onSelect(plan)} className={`w-full rounded-lg border p-3 text-left ${selectedId === plan.id ? 'border-me-ochre bg-amber-50' : 'border-me-stone hover:bg-stone-50'}`}>
          <span className="block text-sm font-semibold">{INDUSTRY_PROFILES[plan.inputs.industryProfile].label}</span>
          <span className="mt-1 block text-xs text-me-charcoal/55">{new Date(plan.created_at).toLocaleString('zh-CN')} · {plan.status === 'reviewed' ? '已审核' : '待审核'}</span>
        </button>)}
        {plans.length === 0 && <p className="text-sm text-me-charcoal/55">还没有生成方案。</p>}
      </div>
    </aside>
  )
}
