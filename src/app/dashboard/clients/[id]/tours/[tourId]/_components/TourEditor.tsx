'use client'

import { useState } from 'react'
import type { GroupTourRecord } from '@/lib/group-tours/store'
import type { GroupTourPayload, GroupTourDay, GroupTourDeparture } from '@/lib/group-tours/types'
import UploadPanel from './UploadPanel'
import ReviewChecklist from './ReviewChecklist'
import PublishPanel from './PublishPanel'

const inputCls =
  'w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:border-me-ochre focus:outline-none'
const labelCls = 'mb-1 block text-xs font-black uppercase tracking-wide text-me-charcoal/50'

function linesToArray(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean)
}
function arrayToLines(arr: string[]): string {
  return arr.join('\n')
}

export default function TourEditor({ clientId, initialTour }: { clientId: string; initialTour: GroupTourRecord }) {
  const [tour, setTour] = useState(initialTour)
  const [payload, setPayload] = useState<GroupTourPayload>(initialTour.payload)
  const [title, setTitle] = useState(initialTour.title)
  const [slug, setSlug] = useState(initialTour.slug)
  const [confirmed, setConfirmed] = useState(initialTour.required_fields_confirmed)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveOk, setSaveOk] = useState(false)

  const set = <K extends keyof GroupTourPayload>(key: K, value: GroupTourPayload[K]) => {
    setPayload((p) => ({ ...p, [key]: value }))
    setConfirmed(false)
  }

  const save = async (opts?: { confirm?: boolean }) => {
    setSaving(true)
    setSaveError(null)
    setSaveOk(false)
    try {
      const res = await fetch(`/api/clients/${clientId}/group-tours/${tour.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title,
          slug,
          payload,
          required_fields_confirmed: opts?.confirm ?? confirmed,
        }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || '保存失败')
      const { tour: updated } = await res.json()
      setTour(updated)
      setConfirmed(updated.required_fields_confirmed)
      setSaveOk(true)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-4 space-y-6 pb-24">
      <div>
        <h1 className="font-display text-2xl font-black text-me-charcoal">{title || '未命名团'}</h1>
        <p className="mt-1 text-sm font-semibold text-me-charcoal/55">
          上传团资料 → AI 解析 → 逐项核对 → 提交发布申请到官网
        </p>
      </div>

      <UploadPanel
        clientId={clientId}
        tourId={tour.id}
        onParsed={(updated) => {
          setTour(updated)
          setPayload(updated.payload)
          setTitle(updated.title)
          setSlug(updated.slug)
          setConfirmed(false)
        }}
      />

      <ReviewChecklist
        missingFields={tour.missing_fields}
        clientClaimsToVerify={tour.client_claims_to_verify}
        confidenceNotes={tour.confidence_notes}
      />

      <section className="rounded-xl border border-black/10 bg-white p-5">
        <h2 className="mb-4 font-black text-me-charcoal">基本信息</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="团名（标题）">
            <input
              className={inputCls}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setConfirmed(false)
              }}
            />
          </Field>
          <Field label="Slug（发布用网址片段）">
            <input
              className={inputCls}
              value={slug}
              onChange={(e) => {
                setSlug(e.target.value)
                setConfirmed(false)
              }}
            />
          </Field>
          <Field label="目的地">
            <select
              className={inputCls}
              value={payload.destination ?? ''}
              onChange={(e) => set('destination', (e.target.value || null) as GroupTourPayload['destination'])}
            >
              <option value="">未选择</option>
              <option value="china">中国 China</option>
              <option value="japan">日本 Japan</option>
              <option value="vietnam">越南 Vietnam</option>
            </select>
          </Field>
          <Field label="团型">
            <select
              className={inputCls}
              value={payload.suggestedTier ?? ''}
              onChange={(e) => set('suggestedTier', (e.target.value || null) as GroupTourPayload['suggestedTier'])}
            >
              <option value="">未选择</option>
              <option value="stopover">Stopover（短线）</option>
              <option value="discovery">Discovery（常规）</option>
              <option value="signature">Signature（高端长线）</option>
            </select>
          </Field>
          <Field label="天数">
            <input className={inputCls} value={payload.duration} onChange={(e) => set('duration', e.target.value)} />
          </Field>
          <Field label="起价（Lead-in price）">
            <input className={inputCls} value={payload.price ?? ''} onChange={(e) => set('price', e.target.value || null)} />
          </Field>
          <Field label="单房差">
            <input
              className={inputCls}
              value={payload.singleSupplement ?? ''}
              onChange={(e) => set('singleSupplement', e.target.value || null)}
            />
          </Field>
        </div>
        <Field label="简介" className="mt-4">
          <textarea
            className={inputCls}
            rows={2}
            value={payload.shortDescription}
            onChange={(e) => set('shortDescription', e.target.value)}
          />
        </Field>
      </section>

      <DeparturesEditor departures={payload.departures} onChange={(v) => set('departures', v)} />
      <ItineraryEditor itinerary={payload.itinerary} onChange={(v) => set('itinerary', v)} />

      <section className="rounded-xl border border-black/10 bg-white p-5">
        <h2 className="mb-4 font-black text-me-charcoal">其他信息</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <ListField label="亮点（每行一条）" value={payload.highlights} onChange={(v) => set('highlights', v)} />
          <ListField label="卖点（每行一条）" value={payload.sellingPoints} onChange={(v) => set('sellingPoints', v)} />
          <ListField label="包含项（每行一条）" value={payload.inclusions} onChange={(v) => set('inclusions', v)} />
          <ListField label="不含项（每行一条）" value={payload.exclusions} onChange={(v) => set('exclusions', v)} />
          <ListField label="途经城市（每行一个，如 beijing）" value={payload.tourCities} onChange={(v) => set('tourCities', v)} />
          <ListField label="图集链接（每行一个 URL）" value={payload.gallery} onChange={(v) => set('gallery', v)} />
        </div>
        <Field label="封面图链接" className="mt-4">
          <input className={inputCls} value={payload.heroImage ?? ''} onChange={(e) => set('heroImage', e.target.value || null)} />
        </Field>
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="SEO 标题">
            <input className={inputCls} value={payload.metaTitle} onChange={(e) => set('metaTitle', e.target.value)} />
          </Field>
          <Field label="SEO 描述">
            <input className={inputCls} value={payload.metaDescription} onChange={(e) => set('metaDescription', e.target.value)} />
          </Field>
        </div>
      </section>

      <section className="sticky bottom-4 rounded-xl border border-black/10 bg-white p-4 shadow-lg">
        <label className="flex items-center gap-2 text-sm font-bold text-me-charcoal">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="h-4 w-4" />
          我已核对以上信息（尤其价格、日期、行程），确认无误
        </label>
        <p className="mt-1 text-xs font-semibold text-me-charcoal/45">
          改动任何内容后这个勾会自动清空，需要重新确认才能提交发布——防止改完没重新看一眼。
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={saving}
            onClick={() => save({ confirm: confirmed })}
            className="rounded-lg bg-me-charcoal px-4 py-2 text-sm font-black text-white transition-colors hover:bg-me-ochre disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存草稿'}
          </button>
          {saveOk && <span className="text-xs font-bold text-[#5C8A4A]">已保存</span>}
          {saveError && <span className="text-xs font-bold text-[#C2453A]">{saveError}</span>}
        </div>
      </section>

      <PublishPanel clientId={clientId} tour={tour} onUpdated={setTour} />
    </div>
  )
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <span className={labelCls}>{label}</span>
      {children}
    </div>
  )
}

function ListField({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <Field label={label}>
      <textarea
        className={inputCls}
        rows={3}
        value={arrayToLines(value)}
        onChange={(e) => onChange(linesToArray(e.target.value))}
      />
    </Field>
  )
}

function DeparturesEditor({
  departures,
  onChange,
}: {
  departures: GroupTourDeparture[]
  onChange: (v: GroupTourDeparture[]) => void
}) {
  const update = (i: number, patch: Partial<GroupTourDeparture>) =>
    onChange(departures.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))
  const remove = (i: number) => onChange(departures.filter((_, idx) => idx !== i))
  const add = () => onChange([...departures, { date: '', price: null }])

  return (
    <section className="rounded-xl border border-black/10 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-black text-me-charcoal">团期</h2>
        <button type="button" onClick={add} className="text-xs font-bold text-me-ochre hover:underline">
          + 加一个团期
        </button>
      </div>
      {departures.length === 0 && <p className="text-sm font-semibold text-me-charcoal/45">还没有团期，点右上角添加。</p>}
      <div className="space-y-2">
        {departures.map((d, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              className={inputCls}
              placeholder="出发日期，如 16 November 2026"
              value={d.date}
              onChange={(e) => update(i, { date: e.target.value })}
            />
            <input
              className={inputCls}
              placeholder="该团期专属价格（留空=用起价）"
              value={d.price ?? ''}
              onChange={(e) => update(i, { price: e.target.value || null })}
            />
            <button type="button" onClick={() => remove(i)} className="shrink-0 text-xs font-bold text-[#C2453A] hover:underline">
              删除
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

const MEAL_OPTIONS: Array<'Breakfast' | 'Lunch' | 'Dinner'> = ['Breakfast', 'Lunch', 'Dinner']

function ItineraryEditor({ itinerary, onChange }: { itinerary: GroupTourDay[]; onChange: (v: GroupTourDay[]) => void }) {
  const update = (i: number, patch: Partial<GroupTourDay>) =>
    onChange(itinerary.map((d, idx) => (idx === i ? { ...d, ...patch } : d)))
  const remove = (i: number) =>
    onChange(itinerary.filter((_, idx) => idx !== i).map((d, idx) => ({ ...d, day: idx + 1 })))
  const add = () =>
    onChange([...itinerary, { day: itinerary.length + 1, title: '', description: '', meals: [], accommodation: null }])
  const toggleMeal = (i: number, meal: 'Breakfast' | 'Lunch' | 'Dinner') => {
    const cur = itinerary[i].meals
    update(i, { meals: cur.includes(meal) ? cur.filter((m) => m !== meal) : [...cur, meal] })
  }

  return (
    <section className="rounded-xl border border-black/10 bg-white p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-black text-me-charcoal">逐日行程（共 {itinerary.length} 天）</h2>
        <button type="button" onClick={add} className="text-xs font-bold text-me-ochre hover:underline">
          + 加一天
        </button>
      </div>
      <div className="space-y-3">
        {itinerary.map((d, i) => (
          <div key={i} className="rounded-lg border border-black/10 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="shrink-0 rounded-full bg-me-ivory px-2 py-1 text-xs font-black text-me-charcoal">Day {d.day}</span>
              <input
                className={inputCls}
                placeholder="标题，如 Beijing — Xi'an"
                value={d.title}
                onChange={(e) => update(i, { title: e.target.value })}
              />
              <button type="button" onClick={() => remove(i)} className="shrink-0 text-xs font-bold text-[#C2453A] hover:underline">
                删除
              </button>
            </div>
            <textarea
              className={`${inputCls} mb-2`}
              rows={2}
              placeholder="当天行程内容"
              value={d.description}
              onChange={(e) => update(i, { description: e.target.value })}
            />
            <div className="flex flex-wrap items-center gap-3">
              {MEAL_OPTIONS.map((m) => (
                <label key={m} className="flex items-center gap-1 text-xs font-bold text-me-charcoal/70">
                  <input type="checkbox" checked={d.meals.includes(m)} onChange={() => toggleMeal(i, m)} />
                  {m}
                </label>
              ))}
              <input
                className={`${inputCls} max-w-xs`}
                placeholder="住宿"
                value={d.accommodation ?? ''}
                onChange={(e) => update(i, { accommodation: e.target.value || null })}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
