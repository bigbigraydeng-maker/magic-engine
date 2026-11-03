'use client'

import type { ReactNode } from 'react'
import { AMBER, FieldError, HelpText, Label, inputClass, type FieldErrors } from './editor-parts'
import { PRICE_HINT_TEXT } from './catalog-format'
import { durationDays, type FormState } from './tour-editor-form'

export const SOLD_OUT_HELP = '打开后，这个团在上架后的目录里标为售罄，页面还在但不再销售'
export const SOLD_OUT_CONFIRM_TEXT = `${SOLD_OUT_HELP}。确定吗？`

export type UpdateField = <K extends keyof FormState>(key: K, value: FormState[K]) => void

export interface FieldsProps {
  form: FormState
  errors: FieldErrors
  update: UpdateField
}

type TextKey =
  | 'name'
  | 'title'
  | 'durationText'
  | 'displayPriceText'
  | 'singleSupplement'
  | 'singleSupplementNote'
  | 'maxGroupSize'
  | 'shortDescription'
  | 'highlights'
  | 'inclusions'
  | 'exclusions'
  | 'tourCities'


interface TextFieldProps extends FieldsProps {
  field: TextKey
  label: ReactNode
  /** Rows of a multi-line box; leave out for a single line. */
  rows?: number
  placeholder?: string
  type?: 'number'
  /** Shown right under the box, above the red message. */
  children?: ReactNode
}

/** Label + box + optional hint + red message, in the order the "jump to first error" lookup expects. */
export function TextField(props: TextFieldProps) {
  const { form, errors, update, field, label, rows, placeholder, type, children } = props
  return (
    <div>
      <Label>{label}</Label>
      {rows ? (
        <textarea
          className={inputClass}
          rows={rows}
          value={form[field]}
          onChange={(e) => update(field, e.target.value)}
        />
      ) : (
        <input
          type={type}
          className={inputClass}
          placeholder={placeholder}
          value={form[field]}
          onChange={(e) => update(field, e.target.value)}
        />
      )}
      {children}
      <FieldError message={errors[field]} />
    </div>
  )
}

function DurationHint({ form }: { form: FormState }) {
  const written = durationDays(form.durationText)
  if (written === null || form.days.length === 0 || written === form.days.length) return null
  return (
    <p className="mt-1 text-xs" style={{ color: AMBER }}>
      天数写的是 {written} 天，行程里有 {form.days.length} 天，请确认
    </p>
  )
}

function Switches({ form, errors, update }: FieldsProps) {
  const toggleSoldOut = (next: boolean) => {
    if (next && !window.confirm(SOLD_OUT_CONFIRM_TEXT)) return
    update('soldOut', next)
  }
  const boxClass = 'flex items-center gap-2 text-sm text-me-charcoal'
  return (
    <div>
      <div className="flex flex-wrap items-center gap-4">
        <label className={boxClass}>
          <input type="checkbox" checked={form.isActive} onChange={(e) => update('isActive', e.target.checked)} />
          在售
        </label>
        <label className={boxClass}>
          <input type="checkbox" checked={form.soldOut} onChange={(e) => toggleSoldOut(e.target.checked)} />
          整团售罄
        </label>
        <label className={boxClass}>
          <input
            type="checkbox"
            checked={form.managesDepartures}
            onChange={(e) => update('managesDepartures', e.target.checked)}
          />
          管理班期
        </label>
      </div>
      <HelpText>整团售罄：{SOLD_OUT_HELP}</HelpText>
      <FieldError message={errors.isActive} />
      <FieldError message={errors.soldOut} />
      <FieldError message={errors.managesDepartures} />
    </div>
  )
}

function PriceFields(props: FieldsProps) {
  return (
    <>
      <TextField
        {...props}
        field="displayPriceText"
        label="展示价"
        placeholder="例如 From NZD $4,999 per person；未定价可写 TBC"
      >
        <HelpText>{PRICE_HINT_TEXT}</HelpText>
      </TextField>
      <TextField {...props} field="singleSupplement" label="单人房差">
        <HelpText>{PRICE_HINT_TEXT}</HelpText>
      </TextField>
      <TextField {...props} field="singleSupplementNote" label="单房差说明">
        <HelpText>选填，一句话，例如什么情况下可以免单房差</HelpText>
      </TextField>
    </>
  )
}

export function TourBasicsFields(props: FieldsProps & { connected: boolean }): JSX.Element {
  const { connected, ...fields } = props
  const titleLabel = (text: string) => (
    <>
      {text}
    </>
  )
  return (
    <>
      <TextField {...fields} field="name" label="团名" />
      <TextField {...fields} field="title" label="对外标题">
        <HelpText>
          {connected ? '网站上显示的是这个标题；留空则显示团名' : '上架后的目录里用这个标题；留空则用团名'}
        </HelpText>
      </TextField>
      <TextField {...fields} field="shortDescription" label={titleLabel('简介')} rows={3} />
      <TextField {...fields} field="highlights" label={titleLabel('亮点（一行一条）')} rows={3} />
      <TextField {...fields} field="durationText" label="天数" placeholder="例如 12 Days">
        <DurationHint form={fields.form} />
      </TextField>
      <PriceFields {...fields} />
      <TextField {...fields} field="maxGroupSize" label="最多人数" type="number" placeholder="留空表示不限" />
      <TextField {...fields} field="tourCities" label="途经城市（一行一条）" rows={3} />
      <Switches {...fields} />
    </>
  )
}

export function TourInclusionsFields(props: FieldsProps): JSX.Element {
  return (
    <>
      <TextField {...props} field="inclusions" label="包含（一行一条）" rows={3} />
      <TextField {...props} field="exclusions" label="不包含（一行一条）" rows={3} />
    </>
  )
}
