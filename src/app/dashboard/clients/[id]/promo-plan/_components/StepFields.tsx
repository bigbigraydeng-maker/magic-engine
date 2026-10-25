'use client'

import type { PromoStep } from '@/lib/marketing-plan/promo/spec'
import type { PromoAccountOption } from '@/lib/marketing-plan/promo/options'
import { centsToYuan, splitList, yuanToCents } from '@/lib/marketing-plan/promo/form'
import { publicAdAccountName } from '@/lib/ads/spend-figures'
import { Field, LocalInput, inputCls } from './Field'

type StepOf<K extends PromoStep['kind']> = Extract<PromoStep, { kind: K }>
interface Props<K extends PromoStep['kind']> { step: StepOf<K>; onChange: (s: StepOf<K>) => void }

export function AdsFields({ step, onChange, accounts }: Props<'ads_campaign'> & { accounts: PromoAccountOption[] | null }) {
  const s = step.settings
  const set = (patch: Partial<typeof s>) => onChange({ ...step, settings: { ...s, ...patch } })
  const cap = accounts?.find(a => a.id === s.ad_account_id)?.cap_cents ?? null
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <Field label="广告账户" hint={accounts === null ? '读取广告账户失败，稍后刷新再试' : accounts.length === 0 ? '这个客户还没有绑定广告账户' : undefined}>
        <select className={inputCls} value={s.ad_account_id} onChange={e => set({ ad_account_id: e.target.value })}>
          <option value="">请选择</option>
          {s.ad_account_id !== '' && !(accounts ?? []).some(a => a.id === s.ad_account_id) && (
            <option value={s.ad_account_id}>当前选中的账户不在这个客户名下，请重选</option>
          )}
          {(accounts ?? []).map(a => <option key={a.id} value={a.id}>{publicAdAccountName(a.label, a.id)}</option>)}
        </select>
      </Field>
      <Field label="每天预算（元，按账户币种）" hint={cap ? `这个账户每天最多 ${cap / 100} 元，超了保存不了` : undefined}>
        <LocalInput value={s.daily_budget_cents} format={centsToYuan} parse={yuanToCents} onValue={n => set({ daily_budget_cents: n })} />
      </Field>
      <Field label="受众" hint="填现有受众的名称或编号，不新建">
        <input className={inputCls} value={s.audience_ref} onChange={e => set({ audience_ref: e.target.value })} />
      </Field>
      <Field label="已批准的素材" hint="多个用逗号隔开；可以先空着，开投前的检查会提醒">
        <LocalInput value={s.creative_refs} format={l => l.join(', ')} parse={splitList} onValue={l => set({ creative_refs: l })} />
      </Field>
    </div>
  )
}

export function SocialFields({ step, onChange }: Props<'social_cadence'>) {
  const s = step.settings
  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0))
  const show = (n: number) => (n > 0 ? String(n) : '')
  const field = (label: string, key: 'posts_per_week' | 'stories_per_week' | 'reels_per_month') => (
    <Field label={label}><LocalInput value={s[key]} format={show} parse={num} onValue={n => set({ [key]: n })} /></Field>
  )
  const set = (patch: Partial<typeof s>) => onChange({ ...step, settings: { ...s, ...patch } })
  return (
    <div className="grid grid-cols-3 gap-3">
      {field('每周帖子（条）', 'posts_per_week')}
      {field('每周快拍（条）', 'stories_per_week')}
      {field('每月短视频（条）', 'reels_per_month')}
    </div>
  )
}

export function BlogFields({ step, onChange }: Props<'blog_article'>) {
  const s = step.settings
  const set = (patch: Partial<typeof s>) => onChange({ ...step, settings: { ...s, ...patch } })
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Field label="主题"><input className={inputCls} value={s.topic} onChange={e => set({ topic: e.target.value })} /></Field>
      <Field label="主要关键词（可空）" hint="关键词要有真实搜索数据再填">
        <input className={inputCls} value={s.primary_keyword ?? ''} onChange={e => set({ primary_keyword: e.target.value.trim() === '' ? null : e.target.value })} />
      </Field>
      <Field label="截止日期"><input type="date" className={inputCls} value={s.due_date} onChange={e => set({ due_date: e.target.value })} /></Field>
    </div>
  )
}

export function NewsletterFields({ step, onChange }: Props<'newsletter_email'>) {
  const s = step.settings
  const set = (patch: Partial<typeof s>) => onChange({ ...step, settings: { ...s, ...patch } })
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Field label="主题"><input className={inputCls} value={s.topic} onChange={e => set({ topic: e.target.value })} /></Field>
      <Field label="截止日期"><input type="date" className={inputCls} value={s.due_date} onChange={e => set({ due_date: e.target.value })} /></Field>
      <label className="flex items-center gap-2 text-sm text-gray-800 mt-5">
        <input type="checkbox" checked={s.requires_link} onChange={e => set({ requires_link: e.target.checked })} />
        信里提到具体产品，必须放真实链接
      </label>
    </div>
  )
}
