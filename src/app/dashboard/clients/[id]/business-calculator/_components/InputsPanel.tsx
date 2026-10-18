'use client'

import type {
  CalculatorInputs,
  ClampNote,
} from '@/lib/crm/industry/travel-business-calculator'
import {
  INPUT_FIELDS,
  type InputField,
  type InputGroup,
} from './format'

const GROUP_ORDER: readonly InputGroup[] = ['finance', 'growth', 'product']

const GROUP_TITLES: Record<InputGroup, string> = {
  finance: '财务假设',
  growth: '广告转化假设',
  product: '产品结构与单位经济',
}

function noteFor(
  notes: ClampNote[],
  key: keyof CalculatorInputs,
): ClampNote | undefined {
  return notes.find((note) => note.field === key)
}

function FieldRow({
  field,
  value,
  note,
  onChange,
}: {
  field: InputField
  value: number
  note: ClampNote | undefined
  onChange: (key: keyof CalculatorInputs, value: number) => void
}): JSX.Element {
  return (
    <div className="space-y-1">
      <label
        htmlFor={`input-${field.key}`}
        className="block text-sm font-medium text-me-charcoal"
      >
        {field.label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={`input-${field.key}`}
          data-testid={`input-${field.key}`}
          type="number"
          inputMode="decimal"
          step={field.step}
          min={0}
          value={value}
          onChange={(e) => {
            const raw = e.target.value
            if (raw === '') {
              onChange(field.key, 0)
              return
            }
            const n = Number(raw)
            if (Number.isFinite(n)) {
              onChange(field.key, n)
            }
          }}
          className="w-40 rounded-lg border border-me-charcoal/20 bg-white px-3 py-1.5 text-sm text-me-charcoal focus:border-me-charcoal/40 focus:outline-none"
        />
        <span className="text-xs text-me-charcoal/70">{field.unit}</span>
      </div>
      {field.hint !== undefined ? (
        <p className="text-xs text-me-charcoal/70">{field.hint}</p>
      ) : null}
      {note !== undefined ? (
        <p className="text-xs text-amber-700">
          已按 {note.used} 计算（你填的是 {note.entered}）
        </p>
      ) : null}
    </div>
  )
}

export function InputsPanel(props: {
  inputs: CalculatorInputs
  onChange: (key: keyof CalculatorInputs, value: number) => void
  notes: ClampNote[]
}): JSX.Element {
  const { inputs, onChange, notes } = props

  return (
    <div className="rounded-xl border border-black/10 bg-white p-6 shadow-sm">
      <div className="space-y-6">
        {GROUP_ORDER.map((group) => {
          const fields = INPUT_FIELDS.filter((field) => field.group === group)
          if (fields.length === 0) return null
          return (
            <section key={group} className="space-y-4">
              <h2 className="text-sm font-semibold text-me-charcoal">
                {GROUP_TITLES[group]}
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {fields.map((field) => (
                  <FieldRow
                    key={field.key}
                    field={field}
                    value={inputs[field.key]}
                    note={noteFor(notes, field.key)}
                    onChange={onChange}
                  />
                ))}
              </div>
              {group === 'finance' ? (
                <p className="text-xs text-me-charcoal/70">
                  默认值是公开计算器的初始值，不代表 CTS 实测。毛利率请按成交方式自己填：公司直接成交与 Agent / Sales 成交的比例不同。
                </p>
              ) : null}
            </section>
          )
        })}
      </div>
      <p className="mt-6 text-xs text-me-charcoal/70">
        计算器预设：每个 Sales 每年处理 6,000 条线索（25 条/天 × 240 天），来源未证实。
      </p>
    </div>
  )
}
