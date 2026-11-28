'use client'

import { INDUSTRY_PROFILES } from '@/lib/social-onboarding/industry-profiles'
import type { FormState } from './types'

const INPUT = 'mt-1.5 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm text-me-charcoal focus:border-me-ochre focus:outline-none'
type Props = { value: FormState; onChange: (patch: Partial<FormState>) => void; onGenerate: () => void; loading: boolean; ready: boolean }

function TextArea({ label, value, placeholder, onChange }: { label: string; value: string; placeholder: string; onChange: (value: string) => void }) {
  return <label className="text-sm font-medium">{label}<textarea className={INPUT} rows={2} maxLength={3000} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /></label>
}

function NumberInput({ label, value, max, step, onChange }: { label: string; value: number | null; max?: number; step?: string; onChange: (value: string) => void }) {
  return <label className="text-sm font-medium">{label}<input className={INPUT} type="number" min={0} max={max} step={step} value={value ?? ''} onChange={(event) => onChange(event.target.value)} placeholder="未知" /></label>
}

export function OnboardingForm({ value, onChange, onGenerate, loading, ready }: Props) {
  const set = <K extends keyof FormState>(key: K, next: FormState[K]) => onChange({ [key]: next } as Pick<FormState, K>)
  const setNumber = (key: 'currentFollowers' | 'organicPostsPerWeek' | 'monthlyAdBudgetCap' | 'leadResponseMinutes', raw: string) => {
    const parsed = raw === '' ? null : Number(raw)
    set(key, parsed !== null && Number.isFinite(parsed) ? parsed : null)
  }
  return (
    <section className="rounded-2xl border border-me-stone bg-white p-5">
      <h2 className="font-display text-lg font-bold">客户目标与执行条件</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">行业流程<select className={INPUT} value={value.industryProfile} onChange={(event) => set('industryProfile', event.target.value as FormState['industryProfile'])}>{Object.entries(INDUSTRY_PROFILES).map(([key, profile]) => <option key={key} value={key}>{profile.label}</option>)}</select></label>
        <label className="text-sm font-medium">首要目标<select className={INPUT} value={value.primaryGoal} onChange={(event) => set('primaryGoal', event.target.value as FormState['primaryGoal'])}><option value="grow_audience">扩大有效受众</option><option value="build_trust">建立信任与互动</option><option value="generate_leads">获取咨询 / 线索</option><option value="mixed">分阶段组合</option></select></label>
        <TextArea label="目标客户 / 受众" value={value.audience} placeholder="地区、客户类型、购买需求" onChange={(next) => set('audience', next)} />
        <TextArea label="不能做或需要先确认的事" value={value.constraints} placeholder="预算上限、合规要求、品牌禁区、季节限制" onChange={(next) => set('constraints', next)} />
        <NumberInput label="当前粉丝数（可留空）" value={value.currentFollowers} onChange={(raw) => setNumber('currentFollowers', raw)} />
        <NumberInput label="每周可稳定发布几条动态" value={value.organicPostsPerWeek} max={21} onChange={(raw) => setNumber('organicPostsPerWeek', raw)} />
        <NumberInput label="月广告预算上限（按客户账户币种）" value={value.monthlyAdBudgetCap} step="0.01" onChange={(raw) => setNumber('monthlyAdBudgetCap', raw)} />
        <NumberInput label="收到咨询后多久能回复（分钟）" value={value.leadResponseMinutes} onChange={(raw) => setNumber('leadResponseMinutes', raw)} />
      </div>
      <button type="button" onClick={onGenerate} disabled={loading || !ready} className="mt-5 rounded-lg bg-me-ochre px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{loading ? '正在读取资料并生成…' : '生成起号方案'}</button>
      <p className="mt-2 text-xs text-me-charcoal/55">读取 ME 已保存的简报、社媒诊断和广告快照；不会新拉数据、发布内容、创建广告或花预算。</p>
    </section>
  )
}
