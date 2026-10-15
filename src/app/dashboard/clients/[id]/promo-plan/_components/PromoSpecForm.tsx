'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { MarketingPlan } from '@/lib/marketing-plan/types'
import type { PromoOptions } from '@/lib/marketing-plan/promo/options'
import { readPromoSpec, type PromoPhase, type PromoSpec, type PromoStep } from '@/lib/marketing-plan/promo/spec'
import { buildPromoTemplate } from '@/lib/marketing-plan/promo/template'
import {
  STEP_KIND_LABEL, addPhase, addStep, removePhase, removeStep, setGoal, updatePhase, updateStep, type StepKind,
} from '@/lib/marketing-plan/promo/form'
import { Field, inputCls } from './Field'
import { AdsFields, BlogFields, NewsletterFields, SocialFields } from './StepFields'
import { AdsDraftPanel } from './AdsDraftPanel'

interface Props { clientId: string; plan: MarketingPlan; options: PromoOptions | null; onSaved: () => void }
interface ApiError { success: boolean; error?: string; issues?: { path: string; message: string }[]; problems?: string[] }

const KINDS = Object.keys(STEP_KIND_LABEL) as StepKind[]

/** 同一阶段里、id 不是当前步骤的其它广告步骤（预算按阶段、按账户核对，和保存时的检查同口径） */
function otherAdsStepsInPhase(phase: PromoPhase, step: PromoStep): { ad_account_id: string; daily_budget_cents: number }[] {
  if (step.kind !== 'ads_campaign') return []
  return phase.steps.flatMap(s => (s.kind === 'ads_campaign' && s.id !== step.id
    ? [{ ad_account_id: s.settings.ad_account_id, daily_budget_cents: s.settings.daily_budget_cents }]
    : []))
}

function StepCard({ step, options, clientId, planId, otherSteps, onChange, onRemove }: {
  step: PromoStep; options: PromoOptions | null; clientId: string; planId: string; otherSteps: { ad_account_id: string; daily_budget_cents: number }[]
  onChange: (s: PromoStep) => void; onRemove: () => void
}) {
  return (
    <li className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
      <div className="flex items-center">
        <p className="text-sm font-semibold text-gray-900">{STEP_KIND_LABEL[step.kind]}</p>
        <button type="button" onClick={onRemove} className="ml-auto text-xs text-red-700 underline">删除这一项</button>
      </div>
      {step.kind === 'ads_campaign' && <AdsFields step={step} accounts={options?.accounts ?? null} onChange={onChange} />}
      {step.kind === 'ads_campaign' && (
        <AdsDraftPanel clientId={clientId} planId={planId} adAccountId={step.settings.ad_account_id}
          otherSteps={otherSteps}
          onAdopt={patch => onChange({ ...step, settings: { ...step.settings, ...patch } })} />
      )}
      {step.kind === 'social_cadence' && <SocialFields step={step} onChange={onChange} />}
      {step.kind === 'blog_article' && <BlogFields step={step} onChange={onChange} />}
      {step.kind === 'newsletter_email' && <NewsletterFields step={step} onChange={onChange} />}
    </li>
  )
}

function PhaseCard({ phase, index, options, spec, clientId, planId, setSpec }: {
  phase: PromoPhase; index: number; options: PromoOptions | null; spec: PromoSpec
  clientId: string; planId: string; setSpec: (s: PromoSpec) => void
}) {
  return (
    <li className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <div className="flex items-center">
        <h3 className="text-sm font-bold text-gray-900">第 {index + 1} 阶段</h3>
        {spec.phases.length > 1 && (
          <button type="button" onClick={() => setSpec(removePhase(spec, phase.id))} className="ml-auto text-xs text-red-700 underline">删除这个阶段</button>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="阶段名称"><input className={inputCls} value={phase.name} onChange={e => setSpec(updatePhase(spec, phase.id, { name: e.target.value }))} /></Field>
        <Field label="开始日期"><input type="date" className={inputCls} value={phase.start_date} onChange={e => setSpec(updatePhase(spec, phase.id, { start_date: e.target.value }))} /></Field>
        <Field label="结束日期"><input type="date" className={inputCls} value={phase.end_date} onChange={e => setSpec(updatePhase(spec, phase.id, { end_date: e.target.value }))} /></Field>
      </div>
      <ul className="space-y-3">
        {phase.steps.map(s => (
          <StepCard key={s.id} step={s} options={options} clientId={clientId} planId={planId}
            otherSteps={otherAdsStepsInPhase(phase, s)}
            onChange={next => setSpec(updateStep(spec, phase.id, next))}
            onRemove={() => setSpec(removeStep(spec, phase.id, s.id))} />
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {KINDS.map(k => (
          <button key={k} type="button" onClick={() => setSpec(addStep(spec, phase.id, k))}
            className="text-xs border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50">+ {STEP_KIND_LABEL[k]}</button>
        ))}
      </div>
    </li>
  )
}

function GoalPicker({ clientId, spec, options, setSpec }: { clientId: string; spec: PromoSpec; options: PromoOptions | null; setSpec: (s: PromoSpec) => void }) {
  const goals = options?.goals ?? []
  return (
    <div>
    <Field label="这份计划为哪个目标服务"
      hint={goals.length === 0 ? '没有读到进行中的目标：可能这个客户还没建，也可能读取失败，刷新页面再看' : undefined}>
      <select className={inputCls} value={spec.goal_id} onChange={e => setSpec(setGoal(spec, e.target.value))}>
        <option value="">请选择</option>
        {spec.goal_id !== '' && !goals.some(g => g.id === spec.goal_id) && (
          <option value={spec.goal_id}>{spec.goal_id}（不是进行中的目标，请重选）</option>
        )}
        {goals.map(g => <option key={g.id} value={g.id}>{g.title}（{g.period_start} 至 {g.period_end}）</option>)}
      </select>
    </Field>
    {goals.length === 0 && <Link href={`/dashboard/clients/${clientId}/goals`} className="text-xs text-indigo-600 underline">去目标页看看 →</Link>}
    </div>
  )
}

/** PM / FDE 用：用表格填推广计划（阶段 + 每步设定）。保存走原来的保存接口，服务端照旧校验。只有草稿能改。 */
export function PromoSpecForm({ clientId, plan, options, onSaved }: Props) {
  const [spec, setSpec] = useState<PromoSpec>(() => readPromoSpec(plan.plan_data) ?? buildPromoTemplate(plan))
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  const save = async () => {
    setSaving(true); setErrors([])
    try {
      const res = await fetch(`/api/clients/${clientId}/marketing-plan/${plan.id}/promo`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ promo: spec, expected_updated_at: plan.updated_at }),
      })
      const json = await res.json() as ApiError
      if (!json.success) {
        setErrors([json.error ?? '保存失败', ...(json.issues ?? []).map(i => `${i.path}：${i.message}`), ...(json.problems ?? [])])
        return
      }
      onSaved()
    } finally { setSaving(false) }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 space-y-4" aria-label="填写推广计划">
      <div>
        <h2 className="text-sm font-bold text-gray-900">填写推广计划</h2>
        <p className="text-xs text-gray-500 mt-0.5">分阶段写清楚：每个阶段投多少广告、发多少社媒、写什么博客和邮件。保存后上面的卡片会立刻更新；批准之前什么都不会发生。</p>
      </div>
      <GoalPicker clientId={clientId} spec={spec} options={options} setSpec={setSpec} />
      <ul className="space-y-4">
        {spec.phases.map((p, i) => (
          <PhaseCard key={p.id} phase={p} index={i} options={options} spec={spec}
            clientId={clientId} planId={plan.id} setSpec={setSpec} />
        ))}
      </ul>
      <button type="button" onClick={() => setSpec(addPhase(spec))} className="text-sm border border-dashed border-gray-400 rounded-lg px-4 py-2 hover:bg-gray-50">+ 加一个阶段</button>
      {errors.length > 0 && (
        <ul className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 space-y-1">
          {errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
      <button type="button" onClick={save} disabled={saving} className="text-sm bg-gray-900 text-white rounded-lg px-5 py-2.5 disabled:opacity-50">
        {saving ? '保存中…' : '保存推广计划'}
      </button>
    </section>
  )
}
