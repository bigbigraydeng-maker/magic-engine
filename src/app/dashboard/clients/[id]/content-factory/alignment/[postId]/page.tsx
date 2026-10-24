'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import type { AlignmentState, SearchEvidence, TopicAlignment } from '@/lib/factory/topic-alignment'

type Form = Omit<TopicAlignment, 'contentTitleSnapshot' | 'websiteCheck' | 'promotionCheck' | 'campaignSourceHash' | 'socialSourceHash'>
type Context = {
  post: { id: string; title: string; status: string; platforms: string[]; ratio: string | null }
  websiteHosts: string[]
  primaryKeywords: string[]
  campaigns: Array<{ id: string; title: string; description: string | null; sourceUrls: string[] }>
  socialPlans: Array<{ id: string; campaignId: string | null; theme: string }>
}

const emptyEvidence = (): SearchEvidence => ({ status: 'not_collected' })
const emptyForm: Form = {
  videoFormat: 'long', primaryKeyword: '', searchIntent: '', audienceMarket: 'New Zealand',
  googleEvidence: emptyEvidence(), youtubeEvidence: emptyEvidence(),
  websiteUrl: '', websiteTheme: '', promotionUrl: null, promotionAlignment: 'unknown', promotionNote: '',
  campaignBriefId: null, adsAlignment: 'unknown', adsNote: '',
  socialPlanId: null, socialAlignment: 'unknown', socialNote: '', contentPromise: '',
}

const inputClass = 'w-full rounded-lg border border-me-stone bg-white px-3 py-2 text-sm'
const labelClass = 'block text-xs font-semibold text-me-charcoal mb-1'

function publicSourceUrl(value: string): boolean {
  try { return new URL(value).protocol === 'https:' } catch { return false }
}

function SearchEvidenceFields({ title, value, onChange, requireMetric }: {
  title: string
  value: SearchEvidence
  onChange: (value: SearchEvidence) => void
  requireMetric: boolean
}) {
  const set = (patch: Partial<SearchEvidence>) => onChange({ ...value, ...patch })
  return (
    <fieldset className="rounded-xl border border-me-stone p-4 space-y-3">
      <legend className="px-1 font-semibold">{title}</legend>
      <p className="text-xs text-me-taupe">记录近 90 天内核对的来源和时间范围；看不到的数据保留“未采集”。</p>
      <label className={labelClass}>证据状态</label>
      <select className={inputClass} value={value.status} onChange={(e) => set({ status: e.target.value as SearchEvidence['status'] })}>
        <option value="not_collected">未采集</option><option value="observed">已核对来源</option>
      </select>
      {value.status === 'observed' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs">来源链接或记录路径<input className={inputClass} value={value.source ?? ''} onChange={(e) => set({ source: e.target.value })} /></label>
          <label className="text-xs">核对时间<input className={inputClass} type="datetime-local" value={value.observedAt?.slice(0, 16) ?? ''} onChange={(e) => set({ observedAt: e.target.value ? new Date(e.target.value).toISOString() : '' })} /></label>
          <label className="text-xs">数据时间范围<input className={inputClass} placeholder="2026-02-27 至 2026-10-14" value={value.dateRange ?? ''} onChange={(e) => set({ dateRange: e.target.value })} /></label>
          <label className="text-xs">市场 / 地区<input className={inputClass} placeholder="NZ / 未筛选" value={value.market ?? ''} onChange={(e) => set({ market: e.target.value })} /></label>
          {requireMetric && <>
            <label className="text-xs">指标名称<input className={inputClass} placeholder="GSC impressions" value={value.metricName ?? ''} onChange={(e) => set({ metricName: e.target.value })} /></label>
            <label className="text-xs">实际数值<input className={inputClass} type="number" min="0" value={value.value ?? ''} onChange={(e) => set({ value: e.target.value === '' ? null : Number(e.target.value) })} /></label>
          </>}
          <label className="text-xs sm:col-span-2">证据说明<textarea className={inputClass} value={value.finding ?? ''} onChange={(e) => set({ finding: e.target.value })} rows={2} /></label>
        </div>
      )}
    </fieldset>
  )
}

function AlignmentFields({ title, state, onState, note, onNote, children }: {
  title: string; state: AlignmentState; onState: (s: AlignmentState) => void
  note: string; onNote: (s: string) => void; children?: ReactNode
}) {
  return <fieldset className="rounded-xl border border-me-stone p-4 space-y-3">
    <legend className="px-1 font-semibold">{title}</legend>
    <select className={inputClass} value={state} onChange={(e) => onState(e.target.value as AlignmentState)}>
      <option value="unknown">未核</option><option value="aligned">主题一致</option>
      <option value="not_applicable">当前不适用，说明原因</option><option value="conflict">主题冲突</option>
    </select>
    {children}
    <label className="text-xs block">对应关系 / 不适用原因<textarea className={inputClass} value={note} onChange={(e) => onNote(e.target.value)} rows={2} /></label>
  </fieldset>
}

export default function TopicAlignmentPage() {
  const params = useParams<{ id: string; postId: string }>()
  const clientId = params?.id
  const postId = params?.postId
  const [context, setContext] = useState<Context | null>(null)
  const [form, setForm] = useState<Form>(emptyForm)
  const [gaps, setGaps] = useState<string[]>([])
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const set = (patch: Partial<Form>) => {
    setForm((current) => ({
      ...current,
      ...(patch.primaryKeyword !== undefined || patch.websiteUrl !== undefined
        ? { googleEvidence: emptyEvidence() } : {}),
      ...patch,
    }))
    setSaved(false)
    setReady(false)
    setGaps(['表单已修改，请重新核对并保存'])
  }

  const load = useCallback(async () => {
    if (!clientId || !postId) return
    try {
      const response = await fetch(`/api/clients/${clientId}/content-factory/${postId}/alignment`)
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
      setContext(data.context)
      if (data.alignment) setForm(data.alignment)
      setGaps(data.gaps ?? [])
      setReady(Boolean(data.ready))
      setError(null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '读取失败') }
  }, [clientId, postId])
  useEffect(() => { void load() }, [load])

  async function save() {
    if (!clientId || !postId) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/clients/${clientId}/content-factory/${postId}/alignment`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`)
      setGaps(data.gaps ?? [])
      setReady(Boolean(data.ready))
      setForm(data.alignment)
      setSaved(true)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存失败') }
    finally { setBusy(false) }
  }

  return <main className="mx-auto max-w-3xl p-6 text-me-charcoal space-y-5">
    <Link className="text-sm text-me-ochre underline" href={`/dashboard/clients/${clientId}/content-factory`}>← 返回内容工厂</Link>
    <div><h1 className="font-display text-xl font-bold">YouTube 主题对齐卡</h1>
      <p className="text-sm text-me-taupe">{context?.post.title ?? '读取中…'}</p></div>
    <div className={`rounded-xl border p-3 text-sm ${ready ? 'border-green-400' : 'border-me-stone'}`}>
      {ready ? '主题证据齐全，可以进入下一步制作审核' : `仍缺 ${gaps.length} 项：${gaps.join('；') || '请填写并保存'}`}
    </div>
    {error && <div className="rounded-xl border border-red-400 p-3 text-sm text-red-700">{error}</div>}
    {context && <div className="space-y-5">
      <section className="rounded-xl border border-me-stone p-4 space-y-3">
        <h2 className="font-semibold">视频定位与关键词</h2>
        <p className="text-xs text-me-taupe">长片和 Short 独立选题；关键词从该客户的 SEO 清单选择。</p>
        <label className={labelClass}>视频类型</label><select className={inputClass} value={form.videoFormat} onChange={(e) => set({ videoFormat: e.target.value as Form['videoFormat'] })}><option value="long">横屏信息片</option><option value="short">Short</option></select>
        <label className={labelClass}>主关键词</label><select className={inputClass} value={form.primaryKeyword} onChange={(e) => set({ primaryKeyword: e.target.value })}>
          <option value="">选择已确认的 SEO 关键词</option>{context.primaryKeywords.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <label className={labelClass}>搜索意图 / 观众问题</label><input className={inputClass} value={form.searchIntent} onChange={(e) => set({ searchIntent: e.target.value })} />
        <label className={labelClass}>目标市场</label><input className={inputClass} value={form.audienceMarket} onChange={(e) => set({ audienceMarket: e.target.value })} />
        <label className={labelClass}>视频承诺</label><input className={inputClass} value={form.contentPromise} onChange={(e) => set({ contentPromise: e.target.value })} />
      </section>

      <section className="rounded-xl border border-me-stone p-4 space-y-2">
        <h2 className="font-semibold">Google 网站搜索证据</h2>
        <p className="text-xs text-me-taupe">保存时自动从 ME 已存储的 GSC 搜索词＋承接页数据读取；没有完整近期数据就保持未采集。网站曝光不是 YouTube 搜索量。</p>
        <p className="text-sm">{form.googleEvidence.status === 'observed'
          ? `${form.googleEvidence.metricName}: ${form.googleEvidence.value} · ${form.googleEvidence.dateRange}`
          : `未采集：${form.googleEvidence.finding || '等待保存后读取'}`}</p>
        {form.googleEvidence.status === 'observed' && <p className="text-xs text-me-taupe">{form.googleEvidence.finding}</p>}
      </section>
      <SearchEvidenceFields title="YouTube 选题证据" value={form.youtubeEvidence} onChange={(youtubeEvidence) => set({ youtubeEvidence })} requireMetric={false} />

      <section className="rounded-xl border border-me-stone p-4 space-y-3">
        <h2 className="font-semibold">官网承接</h2>
        <p className="text-xs text-me-taupe">已配置官网：{context.websiteHosts.join('、') || '未配置'}。保存时系统会读取页面并记录核对时间。</p>
        <label className={labelClass}>承接页 URL</label><input className={inputClass} type="url" value={form.websiteUrl} onChange={(e) => set({ websiteUrl: e.target.value })} />
        <label className={labelClass}>这条视频对应官网什么主题</label><textarea className={inputClass} value={form.websiteTheme} onChange={(e) => set({ websiteTheme: e.target.value })} rows={2} />
      </section>

      <AlignmentFields title="官网当前推广内容" state={form.promotionAlignment} onState={(promotionAlignment) => set({ promotionAlignment })} note={form.promotionNote} onNote={(promotionNote) => set({ promotionNote })}>
        {form.promotionAlignment === 'aligned' && <input className={inputClass} type="url" placeholder="官网推广页 URL" value={form.promotionUrl ?? ''} onChange={(e) => set({ promotionUrl: e.target.value || null })} />}
      </AlignmentFields>
      <AlignmentFields title="广告活动方向" state={form.adsAlignment} onState={(adsAlignment) => set({ adsAlignment })} note={form.adsNote} onNote={(adsNote) => set({ adsNote })}>
        <p className="text-xs text-me-taupe">这里关联广告活动 brief；上线中的具体广告文案仍需按来源核对。</p>
        {form.adsAlignment === 'aligned' && <select className={inputClass} value={form.campaignBriefId ?? ''} onChange={(e) => set({ campaignBriefId: e.target.value || null })}>
          <option value="">选择广告活动 brief</option>{context.campaigns.map((c) => <option key={c.id} value={c.id}>{c.title}{c.description ? ` — ${c.description.slice(0, 70)}` : ''}</option>)}
        </select>}
        {context.campaigns.find((c) => c.id === form.campaignBriefId)?.sourceUrls.filter(publicSourceUrl).map((url) =>
          <a key={url} className="block truncate text-xs text-me-ochre underline" href={url} target="_blank" rel="noreferrer">活动来源：{url}</a>)}
      </AlignmentFields>
      <AlignmentFields title="社媒推广方向" state={form.socialAlignment} onState={(socialAlignment) => set({ socialAlignment })} note={form.socialNote} onNote={(socialNote) => set({ socialNote })}>
        {form.socialAlignment === 'aligned' && <select className={inputClass} value={form.socialPlanId ?? ''} onChange={(e) => set({ socialPlanId: e.target.value || null })}>
          <option value="">选择社媒计划</option>{context.socialPlans.map((p) => <option key={p.id} value={p.id}>{p.theme || p.id}</option>)}
        </select>}
      </AlignmentFields>
      <button className="rounded-xl bg-status-track px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => void save()}>{busy ? '核对并保存中…' : '核对官网并保存'}</button>
      {saved && <p className="text-sm">已保存。{ready ? '主题对齐检查通过。' : '按上方缺口继续补证据。'}</p>}
    </div>}
  </main>
}
