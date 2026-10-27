'use client'

import { useId, useState } from 'react'
import type { TourSavedResponse } from '@/lib/tour-catalog/api-contract'
import { BRAND_BUTTON_CLASS } from './catalog-brand'
import { DialogShell } from './publish-parts'

export const NEW_TOUR_LABEL = '＋ 新建团'
export const NEW_TOUR_INTRO =
  '先建一个空壳（基本信息 + 出发日），只进草稿，不会上官网。行程、包含项等内容建好后在右边继续补，最后再点「上架」。'

const INPUT_CLASS =
  'mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-me-charcoal focus:outline-none focus:ring-2 focus:ring-me-ochre/40'
const SECONDARY_BUTTON_CLASS =
  'rounded-lg border border-black/10 bg-white px-3 py-1 text-sm font-semibold text-me-charcoal hover:bg-me-ivory'

interface DepartureRow {
  departOn: string
  returnOn: string
  priceTextOverride: string
}

const ERROR_TEXT: Record<string, string> = {
  duplicate_tour: '已经有同样「目的地 + 档次 + 短链」的团了，请换一个短链。',
  invalid_fields: '有的内容格式不对，请检查：短链只能小写字母、数字和短横线；日期要完整；返程不能早于出发。',
  Forbidden: '只有 Magic Engine 管理员可以新建团。',
}

/** Lower-case ascii words joined by dashes; empty when the name has none (the person then types one). */
export function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function buildNewTourBody(form: {
  destination: string
  tier: string
  slug: string
  name: string
  durationText: string
  displayPriceText: string
  singleSupplement: string
  departures: DepartureRow[]
}): Record<string, unknown> {
  const tour: Record<string, unknown> = { name: form.name.trim() }
  if (form.durationText.trim() !== '') tour.durationText = form.durationText.trim()
  if (form.displayPriceText.trim() !== '') tour.displayPriceText = form.displayPriceText.trim()
  if (form.singleSupplement.trim() !== '') tour.singleSupplement = form.singleSupplement.trim()
  return {
    destination: form.destination.trim(),
    tier: form.tier.trim(),
    slug: form.slug.trim(),
    tour,
    departures: form.departures
      .filter(d => d.departOn.trim() !== '' || d.returnOn.trim() !== '')
      .map(d => ({
        departOn: d.departOn.trim(),
        returnOn: d.returnOn.trim(),
        ...(d.priceTextOverride.trim() !== '' ? { priceTextOverride: d.priceTextOverride.trim() } : {}),
      })),
  }
}

function Field(props: {
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  list?: string
  placeholder?: string
}): JSX.Element {
  const id = useId()
  return (
    <div>
      <label htmlFor={id} className="text-sm font-black text-me-charcoal">
        {props.label}
      </label>
      <input
        id={id}
        list={props.list}
        value={props.value}
        placeholder={props.placeholder}
        onChange={e => props.onChange(e.target.value)}
        className={INPUT_CLASS}
      />
      {props.hint ? <p className="mt-1 text-xs font-semibold text-me-charcoal/55">{props.hint}</p> : null}
    </div>
  )
}

function DepartureInputs(props: {
  rows: DepartureRow[]
  onChange: (rows: DepartureRow[]) => void
}): JSX.Element {
  const { rows, onChange } = props
  const set = (i: number, patch: Partial<DepartureRow>) =>
    onChange(rows.map((row, idx) => (idx === i ? { ...row, ...patch } : row)))
  return (
    <div className="mt-4">
      <p className="text-sm font-black text-me-charcoal">出发日（选填，也可以建好后再加）</p>
      {rows.map((row, i) => (
        <div key={i} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <input type="date" aria-label={`第 ${i + 1} 个出发日`} value={row.departOn} onChange={e => set(i, { departOn: e.target.value })} className={INPUT_CLASS} />
          <input type="date" aria-label={`第 ${i + 1} 个返程日`} value={row.returnOn} onChange={e => set(i, { returnOn: e.target.value })} className={INPUT_CLASS} />
          <input aria-label={`第 ${i + 1} 个出发日的特殊价（选填）`} placeholder="特殊价（选填）" value={row.priceTextOverride} onChange={e => set(i, { priceTextOverride: e.target.value })} className={INPUT_CLASS} />
          <button type="button" onClick={() => onChange(rows.filter((_, idx) => idx !== i))} className={`${SECONDARY_BUTTON_CLASS} mt-1`}>
            删除
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, { departOn: '', returnOn: '', priceTextOverride: '' }])} className={`${SECONDARY_BUTTON_CLASS} mt-2`}>
        ＋ 再加一个出发日
      </button>
    </div>
  )
}

export function NewTourDialog(props: {
  clientId: string
  knownDestinations: string[]
  knownTiers: string[]
  onClose: () => void
  onCreated: (tourId: string) => void
}): JSX.Element {
  const { clientId, onClose, onCreated } = props
  const listId = useId()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTouched, setSlugTouched] = useState(false)
  const [destination, setDestination] = useState('')
  const [tier, setTier] = useState('')
  const [durationText, setDurationText] = useState('')
  const [displayPriceText, setDisplayPriceText] = useState('')
  const [singleSupplement, setSingleSupplement] = useState('')
  const [departures, setDepartures] = useState<DepartureRow[]>([{ departOn: '', returnOn: '', priceTextOverride: '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = name.trim() !== '' && slug.trim() !== '' && destination.trim() !== '' && tier.trim() !== ''

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      const body = buildNewTourBody({ destination, tier, slug, name, durationText, displayPriceText, singleSupplement, departures })
      const res = await fetch(`/api/clients/${clientId}/tour-catalog/tours`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json: unknown = await res.json().catch(() => ({}))
      if (res.ok) {
        const created = (json as Partial<TourSavedResponse>).tour
        if (created && typeof created.id === 'string') {
          onCreated(created.id)
          return
        }
      }
      const code = typeof (json as { error?: unknown }).error === 'string' ? (json as { error: string }).error : ''
      setError(ERROR_TEXT[code] ?? '没有建成功，请稍后再试')
    } catch {
      setError('没有建成功，请稍后再试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogShell title="新建团" subtitle={NEW_TOUR_INTRO} onClose={onClose}>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="团名（英文，官网显示）" value={name} onChange={v => { setName(v); if (!slugTouched) setSlug(suggestSlug(v)) }} />
        <Field label="短链" value={slug} onChange={v => { setSlugTouched(true); setSlug(v) }} hint="官网网址里的一段，只能小写字母、数字、短横线" />
        <Field label="目的地" value={destination} onChange={setDestination} list={`${listId}-d`} hint="照已有团的写法，下拉里选" />
        <Field label="档次" value={tier} onChange={setTier} list={`${listId}-t`} hint="照已有团的写法，下拉里选" />
        <Field label="天数" value={durationText} onChange={setDurationText} placeholder="14 days" />
        <Field label="展示价" value={displayPriceText} onChange={setDisplayPriceText} placeholder="From NZD $4,999 per person" />
        <Field label="单房差" value={singleSupplement} onChange={setSingleSupplement} placeholder="NZD $950" />
      </div>
      <datalist id={`${listId}-d`}>{props.knownDestinations.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id={`${listId}-t`}>{props.knownTiers.map(v => <option key={v} value={v} />)}</datalist>
      <DepartureInputs rows={departures} onChange={setDepartures} />
      {error ? <p role="alert" className="mt-3 text-sm font-black text-[#C2453A]">{error}</p> : null}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>取消</button>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !canSubmit}
          className={`${BRAND_BUTTON_CLASS} rounded-lg px-4 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {busy ? '正在建…' : '建好，进草稿'}
        </button>
      </div>
    </DialogShell>
  )
}

/** The button under the tour list plus its dialog. Shown only to people who may import (global admins). */
export function NewTourEntry(props: {
  clientId: string
  tours: Array<{ destination: string; tier: string }>
  onCreated: (tourId: string) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const unique = (values: string[]) => [...new Set(values.filter(v => v !== ''))].sort()
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`${SECONDARY_BUTTON_CLASS} mt-2`}>
        {NEW_TOUR_LABEL}
      </button>
      {open ? (
        <NewTourDialog
          clientId={props.clientId}
          knownDestinations={unique(props.tours.map(t => t.destination))}
          knownTiers={unique(props.tours.map(t => t.tier))}
          onClose={() => setOpen(false)}
          onCreated={id => {
            setOpen(false)
            props.onCreated(id)
          }}
        />
      ) : null}
    </>
  )
}
