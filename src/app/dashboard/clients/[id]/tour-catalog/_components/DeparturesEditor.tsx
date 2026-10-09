'use client'

import { useState } from 'react'
import type { CatalogDepartureView } from './types'

const STATUS_LABELS: Record<CatalogDepartureView['status'], string> = {
  open: '可订',
  limited: '少量余位',
  sold_out: '已满团',
  closed: '已关闭',
  cancelled: '已取消',
}

const STATUS_OPTIONS: CatalogDepartureView['status'][] = [
  'open',
  'limited',
  'sold_out',
  'closed',
  'cancelled',
]

const ERROR_MESSAGES: Record<string, string> = {
  conflict: '这个团刚被别人改过，请刷新页面后再改',
  not_found: '找不到这条记录，可能已被删除，请刷新',
  invalid_fields: '有几项填得不对，请看红字提示',
  save_failed: '保存失败，请稍后重试',
  duplicate_departure: '这一天已经有班期了',
}

const FIELD_ERROR_MESSAGES: Record<string, string> = {
  required: '必填',
  too_long: '太长了',
  invalid_type: '格式不对',
  item_too_long: '某一条太长了',
  too_many_items: '条数太多',
  invalid_number: '要填 1 到 500 的整数',
  invalid_date: '日期要写成 2027-05-13 这样',
  return_before_depart: '返程不能早于出团',
  duplicate_day: '行程天数有重复',
  non_consecutive_days: '行程天数要从第 1 天开始连续',
  invalid_status: '状态不对',
}

function fieldErrorMessage(code: string): string {
  if (code.startsWith('invalid_price')) {
    return '价格写法不对，要写成 From NZD $4,999 per person 这样，或写 TBC 表示待定'
  }
  return FIELD_ERROR_MESSAGES[code] ?? code
}

interface FieldError {
  field: string
  code: string
}

function errorMessageFor(code: string): string {
  return ERROR_MESSAGES[code] ?? code
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function isPast(departOn: string): boolean {
  return departOn < todayIso()
}

interface EditRowProps {
  clientId: string
  tourId: string
  departure: CatalogDepartureView
  onCancel: () => void
  onSaved: () => void
}

function EditRow({ clientId, tourId, departure, onCancel, onSaved }: EditRowProps) {
  const [returnOn, setReturnOn] = useState(departure.returnOn ?? '')
  const [status, setStatus] = useState<CatalogDepartureView['status']>(departure.status)
  const [priceText, setPriceText] = useState(departure.priceTextOverride ?? '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])

  const patch: Record<string, unknown> = {}
  const nextReturnOn = returnOn === '' ? null : returnOn
  if (nextReturnOn !== (departure.returnOn ?? null)) patch.returnOn = nextReturnOn
  if (status !== departure.status) patch.status = status
  const nextPrice = priceText.trim() === '' ? null : priceText
  if (nextPrice !== (departure.priceTextOverride ?? null)) patch.priceTextOverride = nextPrice

  async function handleSave() {
    setMessage(null)
    setFieldErrors([])
    if (Object.keys(patch).length === 0) {
      setMessage('没有改动')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(
        `/api/clients/${clientId}/tour-catalog/departures/${departure.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tourId,
            expectedUpdatedAt: departure.updatedAt,
            patch,
          }),
        },
      )
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        fields?: FieldError[]
      }
      if (!res.ok) {
        if (data.fields && data.fields.length > 0) setFieldErrors(data.fields)
        setMessage(errorMessageFor(data.error ?? 'save_failed'))
        return
      }
      onSaved()
    } catch {
      setMessage(errorMessageFor('save_failed'))
    } finally {
      setSaving(false)
    }
  }

  function errorFor(field: string): string | null {
    const found = fieldErrors.find((e) => e.field === field)
    return found ? fieldErrorMessage(found.code) : null
  }

  return (
    <tr className="border-t border-black/10">
      <td className="px-3 py-2 align-top">
        <div className="text-me-charcoal">{departure.departOn}</div>
        <div className="mt-1 text-xs text-me-charcoal/60">
          出团日不能改；日期错了请把这班改成「已取消」，再新增正确日期
        </div>
      </td>
      <td className="px-3 py-2 align-top">
        <input
          type="date"
          value={returnOn}
          onChange={(e) => setReturnOn(e.target.value)}
          className="rounded-lg border border-black/10 bg-me-ivory px-2 py-1 text-sm text-me-charcoal"
        />
        {errorFor('returnOn') && (
          <div className="mt-1 text-xs" style={{ color: '#C2453A' }}>
            {errorFor('returnOn')}
          </div>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as CatalogDepartureView['status'])}
          className="rounded-lg border border-black/10 bg-me-ivory px-2 py-1 text-sm text-me-charcoal"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        {errorFor('status') && (
          <div className="mt-1 text-xs" style={{ color: '#C2453A' }}>
            {errorFor('status')}
          </div>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <input
          type="text"
          value={priceText}
          onChange={(e) => setPriceText(e.target.value)}
          className="w-full rounded-lg border border-black/10 bg-me-ivory px-2 py-1 text-sm text-me-charcoal"
        />
        {errorFor('priceTextOverride') && (
          <div className="mt-1 text-xs" style={{ color: '#C2453A' }}>
            {errorFor('priceTextOverride')}
          </div>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-me-ochre px-3 py-1 text-sm font-semibold text-me-ivory disabled:opacity-50"
          >
            保存
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-black/10 px-3 py-1 text-sm font-semibold text-me-charcoal"
          >
            取消
          </button>
          {message && (
            <div className="text-xs" style={{ color: message === '没有改动' ? '#5C8A4A' : '#C2453A' }}>
              {message}
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

interface DepartureRowProps {
  departure: CatalogDepartureView
  onEdit: () => void
}

function DepartureRow({ departure, onEdit }: DepartureRowProps) {
  const greyed = isPast(departure.departOn) || departure.status === 'cancelled'
  return (
    <tr
      className={`border-t border-black/10 ${greyed ? 'text-me-charcoal/40' : 'text-me-charcoal'}`}
    >
      <td className="px-3 py-2">{departure.departOn}</td>
      <td className="px-3 py-2">{departure.returnOn ?? '—'}</td>
      <td className="px-3 py-2">{STATUS_LABELS[departure.status]}</td>
      <td className="px-3 py-2">{departure.priceTextOverride ?? '—'}</td>
      <td className="px-3 py-2">
        <button
          type="button"
          onClick={onEdit}
          className="rounded-lg border border-black/10 px-3 py-1 text-sm font-semibold text-me-charcoal"
        >
          修改
        </button>
      </td>
    </tr>
  )
}

interface AddFormProps {
  clientId: string
  tourId: string
  onAdded: () => void
}

function AddForm({ clientId, tourId, onAdded }: AddFormProps) {
  const [departOn, setDepartOn] = useState('')
  const [returnOn, setReturnOn] = useState('')
  const [status, setStatus] = useState<CatalogDepartureView['status']>('open')
  const [priceText, setPriceText] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setMessage(null)
    setFieldErrors([])
    setSaving(true)
    try {
      const res = await fetch(
        `/api/clients/${clientId}/tour-catalog/tours/${tourId}/departures`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            departOn,
            returnOn: returnOn === '' ? null : returnOn,
            status,
            priceTextOverride: priceText.trim() === '' ? null : priceText,
          }),
        },
      )
      const data = (await res.json().catch(() => ({}))) as {
        error?: string
        fields?: FieldError[]
      }
      if (!res.ok) {
        if (data.fields && data.fields.length > 0) setFieldErrors(data.fields)
        setMessage(errorMessageFor(data.error ?? 'save_failed'))
        return
      }
      setDepartOn('')
      setReturnOn('')
      setStatus('open')
      setPriceText('')
      setMessage('已新增')
      onAdded()
    } catch {
      setMessage(errorMessageFor('save_failed'))
    } finally {
      setSaving(false)
    }
  }

  function errorFor(field: string): string | null {
    const found = fieldErrors.find((e) => e.field === field)
    return found ? fieldErrorMessage(found.code) : null
  }

  return (
    <form onSubmit={handleSubmit} className="mt-6 rounded-xl border border-black/10 p-4">
      <h3 className="mb-3 text-sm font-semibold text-me-charcoal">新增班期</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm text-me-charcoal">
          出团日
          <input
            type="date"
            value={departOn}
            onChange={(e) => setDepartOn(e.target.value)}
            className="rounded-lg border border-black/10 bg-me-ivory px-2 py-1 text-sm text-me-charcoal"
          />
          {errorFor('departOn') && (
            <span className="text-xs" style={{ color: '#C2453A' }}>
              {errorFor('departOn')}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm text-me-charcoal">
          返程日
          <input
            type="date"
            value={returnOn}
            onChange={(e) => setReturnOn(e.target.value)}
            className="rounded-lg border border-black/10 bg-me-ivory px-2 py-1 text-sm text-me-charcoal"
          />
          {errorFor('returnOn') && (
            <span className="text-xs" style={{ color: '#C2453A' }}>
              {errorFor('returnOn')}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm text-me-charcoal">
          状态
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as CatalogDepartureView['status'])}
            className="rounded-lg border border-black/10 bg-me-ivory px-2 py-1 text-sm text-me-charcoal"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {errorFor('status') && (
            <span className="text-xs" style={{ color: '#C2453A' }}>
              {errorFor('status')}
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm text-me-charcoal">
          该班展示价
          <input
            type="text"
            value={priceText}
            onChange={(e) => setPriceText(e.target.value)}
            className="rounded-lg border border-black/10 bg-me-ivory px-2 py-1 text-sm text-me-charcoal"
          />
          {errorFor('priceTextOverride') && (
            <span className="text-xs" style={{ color: '#C2453A' }}>
              {errorFor('priceTextOverride')}
            </span>
          )}
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-me-ochre px-4 py-1 text-sm font-semibold text-me-ivory disabled:opacity-50"
        >
          添加这个班期
        </button>
        {message && (
          <span
            className="text-sm"
            style={{ color: message === '已新增' ? '#5C8A4A' : '#C2453A' }}
          >
            {message}
          </span>
        )}
      </div>
    </form>
  )
}

export function DeparturesEditor({
  clientId,
  tourId,
  departures,
  onChanged,
}: {
  clientId: string
  tourId: string
  departures: CatalogDepartureView[]
  onChanged: () => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const sorted = [...departures].sort((a, b) => a.departOn.localeCompare(b.departOn))

  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-me-charcoal/70">
            <th className="px-3 py-2 font-semibold">出团日</th>
            <th className="px-3 py-2 font-semibold">返程日</th>
            <th className="px-3 py-2 font-semibold">状态</th>
            <th className="px-3 py-2 font-semibold">该班展示价</th>
            <th className="px-3 py-2 font-semibold">操作</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((d) =>
            editingId === d.id ? (
              <EditRow
                key={d.id}
                clientId={clientId}
                tourId={tourId}
                departure={d}
                onCancel={() => setEditingId(null)}
                onSaved={() => {
                  setEditingId(null)
                  onChanged()
                }}
              />
            ) : (
              <DepartureRow key={d.id} departure={d} onEdit={() => setEditingId(d.id)} />
            ),
          )}
        </tbody>
      </table>
      <AddForm clientId={clientId} tourId={tourId} onAdded={onChanged} />
    </div>
  )
}
