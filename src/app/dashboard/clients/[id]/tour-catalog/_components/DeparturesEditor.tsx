'use client'

import { useEffect, useState } from 'react'
import type { CatalogDepartureView } from './types'
import { PRICE_HINT_TEXT, departureAddedText } from './catalog-format'
import { useChannelsConnected } from './catalog-context'
import { BRAND_BUTTON_CLASS } from './catalog-brand'
import { errorSummaryText, useJumpToFirstError } from './useErrorJump'

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
  conflict: '这个班期刚被别人改过，请刷新页面后再改',
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
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
}

function isPast(departOn: string): boolean {
  return departOn < todayIso()
}

function errorFor(fieldErrors: FieldError[], field: string): string | null {
  const found = fieldErrors.find((e) => e.field === field)
  return found ? fieldErrorMessage(found.code) : null
}

/** Next to the save button: the field-error summary (announced), else the last result line. */
function FormMessage(props: {
  errorCount: number
  message: string | null
  /** The one message that is good news; everything else is shown in red. */
  okText: string
  className: string
}) {
  const { errorCount, message, okText, className } = props
  if (errorCount > 0) {
    return (
      <p role="alert" className={className} style={{ color: '#C2453A' }}>
        {errorSummaryText(errorCount)}
      </p>
    )
  }
  if (!message) return null
  return (
    <p className={className} style={{ color: message === okText ? '#456F35' : '#C2453A' }}>
      {message}
    </p>
  )
}

interface EditRowProps {
  clientId: string
  tourId: string
  departure: CatalogDepartureView
  onCancel: () => void
  onSaved: () => void
  onDirtyChange?: (dirty: boolean) => void
}

/** Report unsaved input upwards; always reports clean again when the form goes away. */
function useDirtyReport(dirty: boolean, onDirtyChange?: (dirty: boolean) => void) {
  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])
}

function EditRow({ clientId, tourId, departure, onCancel, onSaved, onDirtyChange }: EditRowProps) {
  const [returnOn, setReturnOn] = useState(departure.returnOn ?? '')
  const [status, setStatus] = useState<CatalogDepartureView['status']>(departure.status)
  const [priceText, setPriceText] = useState(departure.priceTextOverride ?? '')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])
  const [errorTick, setErrorTick] = useState(0)
  const formRef = useJumpToFirstError<HTMLDivElement>(errorTick)

  const patch: Record<string, unknown> = {}
  const nextReturnOn = returnOn === '' ? null : returnOn
  if (nextReturnOn !== (departure.returnOn ?? null)) patch.returnOn = nextReturnOn
  if (status !== departure.status) patch.status = status
  const nextPrice = priceText.trim() === '' ? null : priceText
  if (nextPrice !== (departure.priceTextOverride ?? null)) patch.priceTextOverride = nextPrice
  useDirtyReport(Object.keys(patch).length > 0, onDirtyChange)

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
        const fields = data.fields ?? []
        if (fields.length > 0) {
          setFieldErrors(fields)
          setErrorTick((n) => n + 1)
        } else {
          setMessage(errorMessageFor(data.error ?? 'save_failed'))
        }
        return
      }
      onSaved()
    } catch {
      setMessage(errorMessageFor('save_failed'))
    } finally {
      setSaving(false)
    }
  }

  const returnOnError = errorFor(fieldErrors, 'returnOn')
  const statusError = errorFor(fieldErrors, 'status')
  const priceError = errorFor(fieldErrors, 'priceTextOverride')

  return (
    <tr className="block border-t border-black/10 sm:table-row">
      <td colSpan={5} className="block px-3 py-3 sm:table-cell">
        <div ref={formRef} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 text-sm text-me-charcoal">
            <span className="font-semibold">出团日</span>
            <div className="text-me-charcoal">{departure.departOn}</div>
            <div className="text-xs text-me-charcoal/60">
              出团日不能改；日期错了请把这班改成「已取消」，再新增正确日期
            </div>
          </div>
          <label className="flex w-full flex-col gap-1 text-sm text-me-charcoal">
            <span className="font-semibold">返程日</span>
            <input
              type="date"
              value={returnOn}
              onChange={(e) => setReturnOn(e.target.value)}
              className="w-full rounded-lg border border-black/10 bg-me-ivory px-2 py-1 text-sm text-me-charcoal"
            />
            {returnOnError && (
              <span data-field-error className="text-xs" style={{ color: '#C2453A' }}>
                {returnOnError}
              </span>
            )}
          </label>
          <label className="flex w-full flex-col gap-1 text-sm text-me-charcoal">
            <span className="font-semibold">状态</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as CatalogDepartureView['status'])}
              className="w-full rounded-lg border border-black/10 bg-me-ivory px-2 py-1 text-sm text-me-charcoal"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </select>
            {statusError && (
              <span data-field-error className="text-xs" style={{ color: '#C2453A' }}>
                {statusError}
              </span>
            )}
          </label>
          <label className="flex w-full flex-col gap-1 text-sm text-me-charcoal">
            <span className="font-semibold">该班展示价</span>
            <input
              type="text"
              value={priceText}
              onChange={(e) => setPriceText(e.target.value)}
              className="w-full rounded-lg border border-black/10 bg-me-ivory px-2 py-1 text-sm text-me-charcoal"
            />
            <span className="text-xs text-me-charcoal/60">{PRICE_HINT_TEXT}</span>
            {priceError && (
              <span data-field-error className="text-xs" style={{ color: '#C2453A' }}>
                {priceError}
              </span>
            )}
          </label>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className={`rounded-lg px-3 py-1 text-sm font-semibold disabled:opacity-50 ${BRAND_BUTTON_CLASS}`}
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
            </div>
            <FormMessage
              errorCount={fieldErrors.length}
              message={message}
              okText="没有改动"
              className="text-xs"
            />
          </div>
        </div>
      </td>
    </tr>
  )
}

/**
 * Below 640px a table squeezes its cells until the text breaks letter by letter, so each
 * departure becomes a small stacked card instead: one line per value, label left, value right.
 * Same markup both ways; the label comes from `data-label`.
 */
const CARD_ROW_CLASS =
  'mb-2 block rounded-lg border border-black/10 px-1 py-1 sm:mb-0 sm:table-row sm:rounded-none sm:border-0 sm:border-t sm:p-0'
const CARD_CELL_CLASS =
  'flex items-center justify-between gap-4 px-2 py-1 text-right before:shrink-0 before:text-left before:text-xs before:font-semibold before:text-me-charcoal/60 before:content-[attr(data-label)] sm:table-cell sm:px-3 sm:py-2 sm:text-left sm:before:content-none'

interface DepartureRowProps {
  departure: CatalogDepartureView
  onEdit: () => void
}

function DepartureRow({ departure, onEdit }: DepartureRowProps) {
  const greyed = isPast(departure.departOn) || departure.status === 'cancelled'
  return (
    <tr className={`${CARD_ROW_CLASS} ${greyed ? 'text-me-charcoal/40' : 'text-me-charcoal'}`}>
      <td data-label="出团日" className={CARD_CELL_CLASS}>{departure.departOn}</td>
      <td data-label="返程日" className={CARD_CELL_CLASS}>{departure.returnOn ?? '—'}</td>
      <td data-label="状态" className={CARD_CELL_CLASS}>{STATUS_LABELS[departure.status]}</td>
      <td data-label="该班展示价" className={CARD_CELL_CLASS}>{departure.priceTextOverride ?? '—'}</td>
      <td data-label="操作" className={CARD_CELL_CLASS}>
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
  onDirtyChange?: (dirty: boolean) => void
}

function AddForm({ clientId, tourId, onAdded, onDirtyChange }: AddFormProps) {
  const [departOn, setDepartOn] = useState('')
  const [returnOn, setReturnOn] = useState('')
  const [status, setStatus] = useState<CatalogDepartureView['status']>('open')
  const [priceText, setPriceText] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])
  const connected = useChannelsConnected()
  const ADDED_TEXT = departureAddedText(connected)
  const [errorTick, setErrorTick] = useState(0)
  const formRef = useJumpToFirstError<HTMLFormElement>(errorTick)
  useDirtyReport(departOn !== '' || returnOn !== '' || priceText.trim() !== '', onDirtyChange)

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
        const fields = data.fields ?? []
        if (fields.length > 0) {
          setFieldErrors(fields)
          setErrorTick((n) => n + 1)
        } else {
          setMessage(errorMessageFor(data.error ?? 'save_failed'))
        }
        return
      }
      setDepartOn('')
      setReturnOn('')
      setStatus('open')
      setPriceText('')
      setMessage(ADDED_TEXT)
      onAdded()
    } catch {
      setMessage(errorMessageFor('save_failed'))
    } finally {
      setSaving(false)
    }
  }

  const departOnError = errorFor(fieldErrors, 'departOn')
  const returnOnError = errorFor(fieldErrors, 'returnOn')
  const statusError = errorFor(fieldErrors, 'status')
  const priceError = errorFor(fieldErrors, 'priceTextOverride')

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="mt-6 border-t border-black/10 pt-4">
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
          {departOnError && (
            <span data-field-error className="text-xs" style={{ color: '#C2453A' }}>
              {departOnError}
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
          {returnOnError && (
            <span data-field-error className="text-xs" style={{ color: '#C2453A' }}>
              {returnOnError}
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
          {statusError && (
            <span data-field-error className="text-xs" style={{ color: '#C2453A' }}>
              {statusError}
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
          <span className="text-xs text-me-charcoal/60">{PRICE_HINT_TEXT}</span>
          {priceError && (
            <span data-field-error className="text-xs" style={{ color: '#C2453A' }}>
              {priceError}
            </span>
          )}
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className={`rounded-lg px-4 py-1 text-sm font-semibold disabled:opacity-50 ${BRAND_BUTTON_CLASS}`}
        >
          添加这个班期
        </button>
        <FormMessage
          errorCount={fieldErrors.length}
          message={message}
          okText={ADDED_TEXT}
          className="text-sm"
        />
      </div>
    </form>
  )
}

export function DeparturesEditor({
  clientId,
  tourId,
  departures,
  onChanged,
  onDirtyChange,
}: {
  clientId: string
  tourId: string
  departures: CatalogDepartureView[]
  onChanged: () => void
  /** Told whenever a departure form starts / stops holding input that is not saved yet. */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDirty, setEditDirty] = useState(false)
  const [addDirty, setAddDirty] = useState(false)
  useDirtyReport(editDirty || addDirty, onDirtyChange)
  const connected = useChannelsConnected()
  const sorted = [...departures].sort((a, b) => a.departOn.localeCompare(b.departOn))

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="block w-full text-sm sm:table sm:min-w-full">
          <thead className="hidden sm:table-header-group">
            <tr className="text-left text-me-charcoal/70">
              <th className="px-3 py-2 font-semibold">出团日</th>
              <th className="px-3 py-2 font-semibold">返程日</th>
              <th className="px-3 py-2 font-semibold">状态</th>
              <th className="px-3 py-2 font-semibold">该班展示价</th>
              <th className="px-3 py-2 font-semibold">操作</th>
            </tr>
          </thead>
          <tbody className="block sm:table-row-group">
            {sorted.map((d) =>
              editingId === d.id ? (
                <EditRow
                  key={d.id}
                  clientId={clientId}
                  tourId={tourId}
                  departure={d}
                  onCancel={() => setEditingId(null)}
                  onDirtyChange={setEditDirty}
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
      </div>
      <p className="mt-2 text-xs text-me-charcoal/60">
        {connected
          ? '某个班期单独填了展示价时，网站上这个班期以它为准；没填就用团的展示价。'
          : '某个班期单独填了展示价时，上架后的目录里这个班期以它为准；没填就用团的展示价。'}
      </p>
      <AddForm clientId={clientId} tourId={tourId} onAdded={onChanged} onDirtyChange={setAddDirty} />
    </div>
  )
}
