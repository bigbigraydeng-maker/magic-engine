'use client'

import { useEffect, useState } from 'react'
import type { CatalogItineraryDayView, CatalogTourView } from './types'
import type { TourSavedResponse } from '@/lib/tour-catalog/api-contract'
import { savedAsDraftText } from './catalog-format'
import { BRAND_BUTTON_CLASS } from './catalog-brand'
import { useChannelsConnected } from './catalog-context'

/** Asked before the "manages departures" switch is saved. Unconnected: promise nothing about channels. */
function managesChangeText(turningOn: boolean, connected: boolean): string {
  if (connected) {
    return turningOn
      ? '打开后，如果这个团没有可订的未来班期，它会被当成不可售，网站和广告都不再推。确定吗？'
      : '关闭后，这个团不再按班期判断是否可售，即使全部满团也会继续对外显示。确定吗？'
  }
  return turningOn
    ? '打开后，如果这个团没有可订的未来班期，它在上架后的目录里会标为不可售。确定吗？'
    : '关闭后，这个团不再按班期判断是否可售，即使全部满团，在上架后的目录里也仍算可售。确定吗？'
}

const DANGER = '#C2453A'
const SUCCESS = '#5C8A4A'
const AMBER = '#B7791F'

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

const PRICE_ERROR_MESSAGE =
  '价格写法不对，要写成 From NZD $4,999 per person 这样，或写 TBC 表示待定'

function fieldErrorMessage(code: string): string {
  if (code.startsWith('invalid_price')) return PRICE_ERROR_MESSAGE
  return FIELD_ERROR_MESSAGES[code] ?? code
}

function serverErrorMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? code
}

interface DayDraft {
  title: string
  description: string
  meals: string
  mealsTouched: boolean
  originalMeals: string[]
}

interface FormState {
  name: string
  title: string
  durationText: string
  displayPriceText: string
  singleSupplement: string
  maxGroupSize: string
  shortDescription: string
  highlights: string
  inclusions: string
  exclusions: string
  tourCities: string
  isActive: boolean
  managesDepartures: boolean
  days: DayDraft[]
}

function linesToText(items?: string[]): string {
  return (items ?? []).join('\n')
}

function mealsToText(meals?: string[]): string {
  return (meals ?? []).join(', ')
}

function daysFromTour(tour: CatalogTourView): DayDraft[] {
  return (tour.itinerary ?? []).map((d) => ({
    title: d.title ?? '',
    description: d.description ?? '',
    meals: mealsToText(d.meals),
    mealsTouched: false,
    originalMeals: d.meals ?? [],
  }))
}

function initialForm(tour: CatalogTourView): FormState {
  return {
    name: tour.name ?? '',
    title: tour.title ?? '',
    durationText: tour.durationText ?? '',
    displayPriceText: tour.displayPriceText ?? '',
    singleSupplement: tour.singleSupplement ?? '',
    maxGroupSize: tour.maxGroupSize == null ? '' : String(tour.maxGroupSize),
    shortDescription: tour.shortDescription ?? '',
    highlights: linesToText(tour.highlights),
    inclusions: linesToText(tour.inclusions),
    exclusions: linesToText(tour.exclusions),
    tourCities: linesToText(tour.tourCities),
    isActive: tour.isActive,
    managesDepartures: tour.managesDepartures,
    days: daysFromTour(tour),
  }
}

function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function splitMeals(text: string): string[] {
  return text
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

function nullableText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

function buildItinerary(days: DayDraft[]): CatalogItineraryDayView[] {
  return days.map((d, i) => {
    const day: CatalogItineraryDayView = {
      day: i + 1,
      title: d.title.trim(),
      description: d.description.trim(),
    }
    const meals = d.mealsTouched ? splitMeals(d.meals) : d.originalMeals
    if (meals.length > 0) day.meals = meals
    return day
  })
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

function itineraryEqual(a: CatalogItineraryDayView[], b: CatalogItineraryDayView[]): boolean {
  if (a.length !== b.length) return false
  return a.every((day, i) => {
    const other = b[i]
    if (day.day !== other.day) return false
    if (day.title !== other.title) return false
    if (day.description !== other.description) return false
    return arraysEqual(day.meals ?? [], other.meals ?? [])
  })
}

function buildScalarPatch(
  form: FormState,
  tour: CatalogTourView,
  touched: Set<string>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (touched.has('name')) {
    const name = form.name.trim()
    if (name !== (tour.name ?? '')) patch.name = name
  }
  if (touched.has('title') && nullableText(form.title) !== (tour.title ?? null))
    patch.title = nullableText(form.title)
  if (touched.has('durationText') && nullableText(form.durationText) !== (tour.durationText ?? null))
    patch.durationText = nullableText(form.durationText)
  if (
    touched.has('displayPriceText') &&
    nullableText(form.displayPriceText) !== (tour.displayPriceText ?? null)
  )
    patch.displayPriceText = nullableText(form.displayPriceText)
  if (
    touched.has('singleSupplement') &&
    nullableText(form.singleSupplement) !== (tour.singleSupplement ?? null)
  )
    patch.singleSupplement = nullableText(form.singleSupplement)
  if (touched.has('maxGroupSize')) {
    const maxGroupSize = form.maxGroupSize.trim() === '' ? null : Number(form.maxGroupSize)
    if (maxGroupSize !== (tour.maxGroupSize ?? null)) patch.maxGroupSize = maxGroupSize
  }
  if (
    touched.has('shortDescription') &&
    nullableText(form.shortDescription) !== (tour.shortDescription ?? null)
  )
    patch.shortDescription = nullableText(form.shortDescription)
  return patch
}

function buildListPatch(
  form: FormState,
  tour: CatalogTourView,
  touched: Set<string>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (touched.has('highlights')) {
    const highlights = splitLines(form.highlights)
    if (!arraysEqual(highlights, tour.highlights ?? [])) patch.highlights = highlights
  }
  if (touched.has('inclusions')) {
    const inclusions = splitLines(form.inclusions)
    if (!arraysEqual(inclusions, tour.inclusions ?? [])) patch.inclusions = inclusions
  }
  if (touched.has('exclusions')) {
    const exclusions = splitLines(form.exclusions)
    if (!arraysEqual(exclusions, tour.exclusions ?? [])) patch.exclusions = exclusions
  }
  if (touched.has('tourCities')) {
    const tourCities = splitLines(form.tourCities)
    if (!arraysEqual(tourCities, tour.tourCities ?? [])) patch.tourCities = tourCities
  }
  if (touched.has('itinerary')) {
    const itinerary = buildItinerary(form.days)
    if (!itineraryEqual(itinerary, tour.itinerary ?? [])) patch.itinerary = itinerary
  }
  return patch
}

function buildPatch(
  form: FormState,
  tour: CatalogTourView,
  touched: Set<string>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {
    ...buildScalarPatch(form, tour, touched),
    ...buildListPatch(form, tour, touched),
  }
  if (touched.has('isActive') && form.isActive !== tour.isActive) patch.isActive = form.isActive
  if (touched.has('managesDepartures') && form.managesDepartures !== tour.managesDepartures)
    patch.managesDepartures = form.managesDepartures
  return patch
}

function durationDays(text: string): number | null {
  const match = text.match(/\d+/)
  if (!match) return null
  const n = Number(match[0])
  return Number.isFinite(n) ? n : null
}

interface FieldErrors {
  [field: string]: string
}

function parseFieldErrors(fields: unknown): FieldErrors {
  const result: FieldErrors = {}
  if (!Array.isArray(fields)) return result
  for (const entry of fields) {
    if (entry && typeof entry === 'object') {
      const f = entry as { field?: unknown; code?: unknown }
      if (typeof f.field === 'string' && typeof f.code === 'string') {
        result[f.field] = fieldErrorMessage(f.code)
      }
    }
  }
  return result
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="mt-1 text-xs" style={{ color: DANGER }}>
      {message}
    </p>
  )
}

function InternalTag() {
  return (
    <span className="ml-2 rounded bg-black/5 px-1.5 py-0.5 text-xs font-normal text-me-charcoal/60">
      仅内部参考，网站暂不读取
    </span>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-sm font-semibold text-me-charcoal">{children}</label>
}

const inputClass =
  'w-full rounded-xl border border-black/10 bg-me-ivory px-3 py-2 text-sm text-me-charcoal'

interface DayCardProps {
  index: number
  day: DayDraft
  errors: FieldErrors
  onChange: (index: number, next: DayDraft) => void
  onDelete: (index: number) => void
}

function DayCard({ index, day, errors, onChange, onDelete }: DayCardProps) {
  const dayNumber = index + 1
  return (
    <div className="rounded-xl border border-black/10 bg-me-ivory p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-me-charcoal">第 {dayNumber} 天</span>
        <button
          type="button"
          onClick={() => onDelete(index)}
          className="rounded-lg px-2 py-1 text-xs font-semibold"
          style={{ color: DANGER }}
        >
          删除这一天
        </button>
      </div>
      <div className="mb-2">
        <Label>标题</Label>
        <input
          className={inputClass}
          value={day.title}
          onChange={(e) => onChange(index, { ...day, title: e.target.value })}
        />
        <FieldError message={errors[`itinerary[${index}].title`]} />
      </div>
      <div className="mb-2">
        <Label>说明</Label>
        <textarea
          className={inputClass}
          rows={2}
          value={day.description}
          onChange={(e) => onChange(index, { ...day, description: e.target.value })}
        />
        <FieldError message={errors[`itinerary[${index}].description`]} />
      </div>
      <div>
        <Label>餐食（用逗号分开，例如 早餐, 晚餐）</Label>
        <input
          className={inputClass}
          value={day.meals}
          onChange={(e) => onChange(index, { ...day, meals: e.target.value, mealsTouched: true })}
        />
        <FieldError message={errors[`itinerary[${index}].meals`]} />
      </div>
    </div>
  )
}

export function TourEditor({
  clientId,
  tour,
  onSaved,
  onCancel,
  onDirtyChange,
}: {
  clientId: string
  tour: CatalogTourView
  onSaved: (tour: CatalogTourView) => void
  onCancel: () => void
  /** Told whenever the form starts / stops holding edits that are not saved yet. */
  onDirtyChange?: (dirty: boolean) => void
}) {
  const [form, setForm] = useState<FormState>(() => initialForm(tour))
  const [touched, setTouched] = useState<Set<string>>(() => new Set())
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [statusColor, setStatusColor] = useState<string>(SUCCESS)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})

  const dirty = Object.keys(buildPatch(form, tour, touched)).length > 0
  useEffect(() => {
    onDirtyChange?.(dirty)
    return () => onDirtyChange?.(false)
  }, [dirty, onDirtyChange])

  function markTouched(key: string) {
    setTouched((prev) => {
      if (prev.has(key)) return prev
      const next = new Set(prev)
      next.add(key)
      return next
    })
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    markTouched(key as string)
  }

  function updateDay(index: number, next: DayDraft) {
    setForm((prev) => {
      const days = prev.days.slice()
      days[index] = next
      return { ...prev, days }
    })
    markTouched('itinerary')
  }

  function addDay() {
    setForm((prev) => ({
      ...prev,
      days: [
        ...prev.days,
        { title: '', description: '', meals: '', mealsTouched: false, originalMeals: [] },
      ],
    }))
    markTouched('itinerary')
  }

  function deleteDay(index: number) {
    setForm((prev) => ({
      ...prev,
      days: prev.days.filter((_, i) => i !== index),
    }))
    markTouched('itinerary')
  }

  const connected = useChannelsConnected()

  function confirmManagesChange(): boolean {
    if (form.managesDepartures === tour.managesDepartures) return true
    return window.confirm(managesChangeText(form.managesDepartures, connected))
  }

  function handleCancel() {
    if (dirty && !window.confirm('放弃这次没保存的修改吗？')) return
    onCancel()
  }

  async function handleSave() {
    setStatus(null)
    setFieldErrors({})
    const patch = buildPatch(form, tour, touched)
    if (Object.keys(patch).length === 0) {
      setStatusColor(SUCCESS)
      setStatus('没有改动')
      return
    }
    if (!confirmManagesChange()) return

    setSaving(true)
    try {
      const res = await fetch(`/api/clients/${clientId}/tour-catalog/tours/${tour.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedUpdatedAt: tour.updatedAt, patch }),
      })
      if (res.ok) {
        const data = (await res.json()) as TourSavedResponse
        setStatusColor(SUCCESS)
        setStatus(savedAsDraftText(connected))
        onSaved(data.tour)
        return
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        fields?: unknown
      }
      const code = typeof body.error === 'string' ? body.error : 'save_failed'
      if (code === 'invalid_fields') {
        setFieldErrors(parseFieldErrors(body.fields))
      }
      setStatusColor(DANGER)
      setStatus(serverErrorMessage(code))
    } catch {
      setStatusColor(DANGER)
      setStatus(serverErrorMessage('save_failed'))
    } finally {
      setSaving(false)
    }
  }

  const durationN = durationDays(form.durationText)
  const showDurationHint =
    durationN !== null && form.days.length > 0 && durationN !== form.days.length

  return (
    <div className="space-y-4 rounded-xl border border-black/10 bg-white p-4">
      <div>
        <Label>团名</Label>
        <input
          className={inputClass}
          value={form.name}
          onChange={(e) => update('name', e.target.value)}
        />
        <FieldError message={fieldErrors.name} />
      </div>

      <div>
        <Label>对外标题</Label>
        <input
          className={inputClass}
          value={form.title}
          onChange={(e) => update('title', e.target.value)}
        />
        <p className="mt-1 text-xs text-me-charcoal/60">
          {connected
            ? '网站上显示的是这个标题；留空则显示团名'
            : '上架后的目录里用这个标题；留空则用团名'}
        </p>
        <FieldError message={fieldErrors.title} />
      </div>

      <div>
        <Label>天数</Label>
        <input
          className={inputClass}
          placeholder="例如 12 Days"
          value={form.durationText}
          onChange={(e) => update('durationText', e.target.value)}
        />
        {showDurationHint && (
          <p className="mt-1 text-xs" style={{ color: AMBER }}>
            天数写的是 {durationN} 天，行程里有 {form.days.length} 天，请确认
          </p>
        )}
        <FieldError message={fieldErrors.durationText} />
      </div>

      <div>
        <Label>展示价</Label>
        <input
          className={inputClass}
          placeholder="例如 From NZD $4,999 per person；未定价可写 TBC"
          value={form.displayPriceText}
          onChange={(e) => update('displayPriceText', e.target.value)}
        />
        <FieldError message={fieldErrors.displayPriceText} />
      </div>

      <div>
        <Label>单人房差</Label>
        <input
          className={inputClass}
          value={form.singleSupplement}
          onChange={(e) => update('singleSupplement', e.target.value)}
        />
        <FieldError message={fieldErrors.singleSupplement} />
      </div>

      <div>
        <Label>最多人数</Label>
        <input
          type="number"
          className={inputClass}
          placeholder="留空表示不限"
          value={form.maxGroupSize}
          onChange={(e) => update('maxGroupSize', e.target.value)}
        />
        <FieldError message={fieldErrors.maxGroupSize} />
      </div>

      <div>
        <Label>
          简介
          <InternalTag />
        </Label>
        <textarea
          className={inputClass}
          rows={3}
          value={form.shortDescription}
          onChange={(e) => update('shortDescription', e.target.value)}
        />
        <FieldError message={fieldErrors.shortDescription} />
      </div>

      <div>
        <Label>
          亮点（一行一条）
          <InternalTag />
        </Label>
        <textarea
          className={inputClass}
          rows={3}
          value={form.highlights}
          onChange={(e) => update('highlights', e.target.value)}
        />
        <FieldError message={fieldErrors.highlights} />
      </div>

      <div>
        <Label>包含（一行一条）</Label>
        <textarea
          className={inputClass}
          rows={3}
          value={form.inclusions}
          onChange={(e) => update('inclusions', e.target.value)}
        />
        <FieldError message={fieldErrors.inclusions} />
      </div>

      <div>
        <Label>不包含（一行一条）</Label>
        <textarea
          className={inputClass}
          rows={3}
          value={form.exclusions}
          onChange={(e) => update('exclusions', e.target.value)}
        />
        <FieldError message={fieldErrors.exclusions} />
      </div>

      <div>
        <Label>途经城市（一行一条）</Label>
        <textarea
          className={inputClass}
          rows={3}
          value={form.tourCities}
          onChange={(e) => update('tourCities', e.target.value)}
        />
        <FieldError message={fieldErrors.tourCities} />
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-semibold text-me-charcoal">行程</span>
          <button
            type="button"
            onClick={addDay}
            className="rounded-lg border border-black/10 px-3 py-1 text-xs font-semibold text-me-charcoal"
          >
            加一天
          </button>
        </div>
        <FieldError message={fieldErrors.itinerary} />
        <div className="space-y-3">
          {form.days.map((day, index) => (
            <DayCard
              key={index}
              index={index}
              day={day}
              errors={fieldErrors}
              onChange={updateDay}
              onDelete={deleteDay}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-me-charcoal">
          <input
            type="checkbox"
            checked={form.isActive}
            onChange={(e) => update('isActive', e.target.checked)}
          />
          在售
        </label>
        <label className="flex items-center gap-2 text-sm text-me-charcoal">
          <input
            type="checkbox"
            checked={form.managesDepartures}
            onChange={(e) => update('managesDepartures', e.target.checked)}
          />
          管理班期
        </label>
      </div>

      {status && (
        <p className="text-sm font-semibold" style={{ color: statusColor }}>
          {status}
        </p>
      )}

      {/* Sticks to the bottom of the screen: the form is long and 保存 must stay reachable. */}
      <div className="sticky bottom-0 z-10 -mx-2 flex items-center gap-3 border-t border-black/10 bg-white/90 px-2 py-3 backdrop-blur">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className={`rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60 ${BRAND_BUTTON_CLASS}`}
        >
          {saving ? '正在保存…' : '保存'}
        </button>
        <button
          type="button"
          onClick={handleCancel}
          className="rounded-lg border border-black/10 px-4 py-2 text-sm font-semibold text-me-charcoal"
        >
          取消
        </button>
      </div>
    </div>
  )
}
