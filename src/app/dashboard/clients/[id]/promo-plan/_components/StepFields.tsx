'use client'

import type { PromoStep } from '@/lib/marketing-plan/promo/spec'
import type { PromoAccountOption } from '@/lib/marketing-plan/promo/options'
import { ageOrUndefined, centsToYuan, newAdsTargeting, splitCountries, splitList, withAdsTargeting, withTargetingAge, yuanToCents } from '@/lib/marketing-plan/promo/form'
import { Field, LocalInput, inputCls } from './Field'

type StepOf<K extends PromoStep['kind']> = Extract<PromoStep, { kind: K }>
interface Props<K extends PromoStep['kind']> { step: StepOf<K>; onChange: (s: StepOf<K>) => void }

export function AdsFields({ step, onChange, accounts }: Props<'ads_campaign'> & { accounts: PromoAccountOption[] | null }) {
  const s = step.settings
  const set = (patch: Partial<typeof s>) => onChange({ ...step, settings: { ...s, ...patch } })
  const cap = accounts?.find(a => a.id === s.ad_account_id)?.cap_cents ?? null
  const t = s.targeting
  // 一律走 withAdsTargeting：它在删除时把键真删掉，不留 undefined（会污染内容指纹）。
  const setT = (patch: Partial<NonNullable<typeof t>>) =>
    onChange(withAdsTargeting(step, { ...(t ?? newAdsTargeting()), ...patch }))
  const setAge = (which: 'age_min' | 'age_max', value: number | undefined) =>
    onChange(withAdsTargeting(step, withTargetingAge(t ?? newAdsTargeting(), which, value)))
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="广告账户" hint={accounts === null ? '读取广告账户失败，稍后刷新再试' : accounts.length === 0 ? '这个客户还没有绑定广告账户' : undefined}>
          <select className={inputCls} value={s.ad_account_id} onChange={e => set({ ad_account_id: e.target.value })}>
            <option value="">请选择</option>
            {s.ad_account_id !== '' && !(accounts ?? []).some(a => a.id === s.ad_account_id) && (
              <option value={s.ad_account_id}>{s.ad_account_id}（不在这个客户名下，请重选）</option>
            )}
            {(accounts ?? []).map(a => <option key={a.id} value={a.id}>{a.id}</option>)}
          </select>
        </Field>
        <Field label="每天预算（元，按账户币种）" hint={cap ? `这个账户每天最多 ${cap / 100} 元，超了保存不了` : undefined}>
          <LocalInput value={s.daily_budget_cents} format={centsToYuan} parse={yuanToCents} onValue={n => set({ daily_budget_cents: n })} />
        </Field>
        <Field label="已保存的受众" hint="填现有受众的名称或编号，不新建。不用现成受众就留空，改填下面的投放范围">
          <input className={inputCls} value={s.audience_ref} onChange={e => set({ audience_ref: e.target.value })} />
        </Field>
        <Field label="已批准的素材" hint="多个用逗号隔开；可以先空着，开投前的检查会提醒">
          <LocalInput value={s.creative_refs} format={l => l.join(', ')} parse={splitList} onValue={l => set({ creative_refs: l })} />
        </Field>
      </div>

      <div className="rounded-lg border border-gray-200 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-gray-900">投放范围（不用现成受众时填这里）</p>
          {t === undefined
            ? <button type="button" onClick={() => onChange(withAdsTargeting(step, newAdsTargeting()))} className="ml-auto text-xs border border-gray-300 rounded-lg px-3 py-1.5 hover:bg-gray-50">+ 加上</button>
            : <button type="button" onClick={() => onChange(withAdsTargeting(step, undefined))} className="ml-auto text-xs text-red-700 underline">删掉投放范围</button>}
        </div>
        <p className="text-[11px] text-gray-500">
          填了这里就不必先去 Meta 后台存一个受众。<strong>注意：这里只管投给哪儿、多大年龄。</strong>
          Meta 还有一项「语言」定向，指的是「这个人手机界面设的什么语言」，跟广告文案用什么语言写是两回事，<strong>不在这里，也不会被这里覆盖</strong>。
        </p>
        {t !== undefined && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="投哪些国家" hint="两位国家码，多个用逗号隔开，例如 NZ, AU。填了国家就别填城市">
              <LocalInput value={t.countries} format={l => l.join(', ')} parse={splitCountries} onValue={l => setT({ countries: l })} />
            </Field>
            <Field label="投哪些城市（Meta 的城市编号）" hint="按城市投就只填城市、别填国家：Meta 会把两者合起来算，国家一填城市范围就失效了">
              <LocalInput value={t.city_keys} format={l => l.join(', ')} parse={splitList} onValue={l => setT({ city_keys: l })} />
            </Field>
            <Field label="年龄下限" hint="Meta 不许投给 18 岁以下；不限就留空">
              <LocalInput value={t.age_min} format={v => (v === undefined ? '' : String(v))} parse={ageOrUndefined} onValue={v => setAge('age_min', v)} />
            </Field>
            <Field label="年龄上限" hint="不限就留空">
              <LocalInput value={t.age_max} format={v => (v === undefined ? '' : String(v))} parse={ageOrUndefined} onValue={v => setAge('age_max', v)} />
            </Field>
            <Field label="要排除的受众" hint="多个用逗号隔开，例如已付定金的客人、标了「不再联系」的人">
              <LocalInput value={t.excluded_audience_refs} format={l => l.join(', ')} parse={splitList} onValue={l => setT({ excluded_audience_refs: l })} />
            </Field>
          </div>
        )}
      </div>
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
