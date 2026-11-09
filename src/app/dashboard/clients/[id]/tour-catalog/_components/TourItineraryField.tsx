'use client'

import { DANGER, FieldError, FieldErrorList, HelpText, Label, inputClass, type FieldErrors } from './editor-parts'
import { emptyDay, type DayDraft } from './tour-editor-form'

export const FESTIVE_LABEL_HELP = '如 Christmas Day，会显示成一个小标签'

interface DayCardProps {
  index: number
  day: DayDraft
  errors: FieldErrors
  onChange: (index: number, next: DayDraft) => void
  onDelete: (index: number) => void
}

/** Stay and festive mark of one day. The operator mark is shown but cannot be edited here. */
function DayExtras({ index, day, errors, onChange }: Omit<DayCardProps, 'onDelete'>) {
  const n = index + 1
  return (
    <>
      <div className="mt-2">
        <Label>住宿</Label>
        <input
          aria-label={`第 ${n} 天住宿`}
          className={inputClass}
          value={day.accommodation}
          onChange={(e) => onChange(index, { ...day, accommodation: e.target.value })}
        />
        <FieldError message={errors[`itinerary[${index}].accommodation`]} />
      </div>
      <div className="mt-2">
        <Label>节日标记（选填）</Label>
        <input
          aria-label={`第 ${n} 天节日标记`}
          className={inputClass}
          placeholder="如 Christmas Day"
          value={day.festiveLabel}
          onChange={(e) => onChange(index, { ...day, festiveLabel: e.target.value })}
        />
        <FieldError message={errors[`itinerary[${index}].festiveLabel`]} />
      </div>
      {day.operatorLogo ? (
        <p data-testid="operator-logo-note" className="mt-2 break-words text-xs text-me-charcoal/60">
          这一天带航司标志：{day.operatorLogo.alt}
        </p>
      ) : null}
      <FieldErrorList errors={errors} prefix={`itinerary[${index}].operatorLogo`} />
    </>
  )
}

function DayCard({ index, day, errors, onChange, onDelete }: DayCardProps) {
  return (
    <div className="rounded-xl border border-black/10 bg-me-ivory p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-me-charcoal">第 {index + 1} 天</span>
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
      <DayExtras index={index} day={day} errors={errors} onChange={onChange} />
    </div>
  )
}

export function TourItineraryField(props: {
  days: DayDraft[]
  errors: FieldErrors
  onChange: (next: DayDraft[]) => void
}): JSX.Element {
  const { days, errors, onChange } = props
  const changeDay = (index: number, next: DayDraft) =>
    onChange(days.map((day, i) => (i === index ? next : day)))
  const deleteDay = (index: number) => onChange(days.filter((_, i) => i !== index))
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold text-me-charcoal">共 {days.length} 天</span>
        <button
          type="button"
          onClick={() => onChange([...days, emptyDay()])}
          className="rounded-lg border border-black/10 px-3 py-1 text-xs font-semibold text-me-charcoal"
        >
          加一天
        </button>
      </div>
      <HelpText>节日标记选填：{FESTIVE_LABEL_HELP}</HelpText>
      <FieldError message={errors.itinerary} />
      <div className="mt-2 space-y-3">
        {days.map((day, index) => (
          <DayCard
            key={index}
            index={index}
            day={day}
            errors={errors}
            onChange={changeDay}
            onDelete={deleteDay}
          />
        ))}
      </div>
    </div>
  )
}
