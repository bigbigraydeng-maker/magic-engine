'use client'

import { useMemo, useState } from 'react'

import {
  BUSINESS_CALCULATOR_FORMULA_VERSION,
  DEFAULT_INPUTS,
  calculate,
  clampNotes,
  unrealisticWarnings,
  validateInputs,
  type CalculatorInputs,
} from '@/lib/crm/industry/travel-business-calculator'

import { INPUT_FIELDS } from './format'
import { InputsPanel } from './InputsPanel'
import { ResultPanel } from './ResultPanel'
import { ScenarioBar } from './ScenarioBar'
import type { ScenarioRow } from './ComparePanel'

/** 校验器的原话里带英文字段名，换成页面上的中文名再给 PM 看。 */
function explainValidationError(error: string): string {
  const field = INPUT_FIELDS.find((item) => error.includes(item.key))
  return field ? `「${field.label}」必须是 0 到 10 亿之间的数字` : error
}

export function BusinessCalculatorClient(props: { clientId: string }): JSX.Element {
  const { clientId } = props

  const [inputs, setInputs] = useState<CalculatorInputs>(DEFAULT_INPUTS)
  const [baseline, setBaseline] = useState<CalculatorInputs>(DEFAULT_INPUTS)
  const [loaded, setLoaded] = useState<ScenarioRow | null>(null)

  const dirty = JSON.stringify(inputs) !== JSON.stringify(baseline)

  const result = useMemo(() => calculate(inputs), [inputs])
  const notes = useMemo(() => clampNotes(inputs), [inputs])
  const warnings = unrealisticWarnings(inputs, result)
  // 有数字超出可保存范围（负数、超过 10 亿）时仍然照算给你看，但不允许保存，并说清原因
  const validity = useMemo(() => validateInputs(inputs), [inputs])
  const saveBlockedReason = validity.ok ? undefined : `${explainValidationError(validity.error)}——这组数字暂时不能保存`

  const handleChange = (key: keyof CalculatorInputs, value: number): void => {
    setInputs((prev) => ({ ...prev, [key]: value }))
  }

  const handleLoad = (scenario: ScenarioRow): void => {
    const next: CalculatorInputs = { ...DEFAULT_INPUTS, ...scenario.inputs }
    setInputs(next)
    setBaseline(next)
    setLoaded(scenario)
  }

  const handleSaved = (scenario: ScenarioRow): void => {
    setLoaded(scenario)
    setBaseline(inputs)
  }

  const handleReset = (): void => {
    if (dirty) {
      const confirmed = window.confirm('有未保存的修改，恢复默认值会丢掉，继续吗？')
      if (!confirmed) {
        return
      }
    }
    setInputs(DEFAULT_INPUTS)
    setBaseline(DEFAULT_INPUTS)
    setLoaded(null)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold text-me-charcoal">经营测算</h1>
          <p className="text-xs text-me-charcoal/70">
            手填参数，立刻算出年度利润；可保存多个场景并对比。内部模拟：不读真实数据，不构成预算依据。
          </p>
        </div>
        <button
          type="button"
          onClick={handleReset}
          className="rounded-lg border border-me-charcoal/20 bg-white px-3 py-1.5 text-sm text-me-charcoal hover:border-me-charcoal/40"
        >
          恢复默认值
        </button>
      </div>

      {saveBlockedReason ? (
        <p className="text-xs text-red-700" data-testid="save-blocked">{saveBlockedReason}</p>
      ) : null}

      {loaded !== null ? (
        <p className="text-xs text-me-charcoal/70">
          当前场景：{loaded.name}
          {dirty ? '（有未保存的修改）' : ''}
          {loaded.formula_version !== BUSINESS_CALCULATOR_FORMULA_VERSION
            ? `（这个场景按 v${loaded.formula_version} 公式保存，当前是 v${BUSINESS_CALCULATOR_FORMULA_VERSION}，数字可能不同）`
            : ''}
        </p>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <InputsPanel inputs={inputs} onChange={handleChange} notes={notes} />
        <ResultPanel result={result} warnings={warnings} />
      </div>

      <ScenarioBar
        clientId={clientId}
        currentInputs={inputs}
        dirty={dirty}
        loaded={loaded}
        onLoad={handleLoad}
        onSaved={handleSaved}
        onDeleted={(id) => setLoaded((prev) => (prev?.id === id ? null : prev))}
        onRenamed={(renamed) => setLoaded((prev) => (prev?.id === renamed.id ? renamed : prev))}
        saveBlockedReason={saveBlockedReason}
      />
    </div>
  )
}
