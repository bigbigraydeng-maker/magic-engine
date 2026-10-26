'use client'

import {
  BUSINESS_CALCULATOR_FORMULA_VERSION,
  DEFAULT_INPUTS,
  calculate,
  clampNotes,
  type CalculatorInputs,
} from '@/lib/crm/industry/travel-business-calculator'
import { diffMetrics, fieldLabel, formatMetric } from './format'

export interface ScenarioRow {
  id: string
  name: string
  inputs: CalculatorInputs
  formula_version: number
  created_by: string
  created_at: string
  updated_at: string
}

function formatDiff(diff: number | null, kind: Parameters<typeof formatMetric>[1]): string {
  if (diff === null) {
    return '—'
  }
  if (diff === 0) {
    return formatMetric(0, kind)
  }
  const sign = diff > 0 ? '+' : '-'
  return `${sign}${formatMetric(Math.abs(diff), kind)}`
}

export function ComparePanel(props: { a: ScenarioRow; b: ScenarioRow }): JSX.Element {
  const { a, b } = props

  const resultA = calculate({ ...DEFAULT_INPUTS, ...a.inputs })
  const resultB = calculate({ ...DEFAULT_INPUTS, ...b.inputs })
  const rows = diffMetrics(resultA, resultB)

  const staleScenarios: ScenarioRow[] = []
  if (a.formula_version !== BUSINESS_CALCULATOR_FORMULA_VERSION) {
    staleScenarios.push(a)
  }
  if (b.formula_version !== BUSINESS_CALCULATOR_FORMULA_VERSION) {
    staleScenarios.push(b)
  }

  // 对比表按夹逼后的值算；场景里如果有数被夹逼，要说出来，不能让人以为按填的数算
  const clampLines = [a, b].flatMap((scenario) =>
    clampNotes({ ...DEFAULT_INPUTS, ...scenario.inputs }).map(
      (note) => `「${scenario.name}」的「${fieldLabel(note.field)}」填的是 ${note.entered}，已按 ${note.used} 计算`,
    ),
  )

  return (
    <div className="rounded-xl border border-black/10 bg-white p-6 shadow-sm">
      {clampLines.length > 0 ? (
        <ul className="mb-3 space-y-1 text-xs text-amber-700" data-testid="compare-clamp-notes">
          {clampLines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      <table data-testid="compare-table" className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-me-charcoal/20 text-left text-me-charcoal/70">
            <th className="py-2 pr-3 font-medium">指标</th>
            <th className="py-2 pr-3 font-medium">A（{a.name}）</th>
            <th className="py-2 pr-3 font-medium">B（{b.name}）</th>
            <th className="py-2 font-medium">差值</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-me-charcoal/10">
              <td className="py-1 pr-3 text-me-charcoal/70">{row.label}</td>
              <td className="py-1 pr-3 text-me-charcoal">
                {formatMetric(row.a, row.kind)}
              </td>
              <td className="py-1 pr-3 text-me-charcoal">
                {formatMetric(row.b, row.kind)}
              </td>
              <td className="py-1 text-me-charcoal">{formatDiff(row.diff, row.kind)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="mt-3 text-xs text-me-charcoal/70">
        内部模拟 · 不构成预算依据；差值先取整再相减。
      </p>

      {staleScenarios.length > 0 ? (
        <div className="mt-2 space-y-1">
          {staleScenarios.map((scenario) => (
            <p key={scenario.id} className="text-xs text-amber-800">
              「{scenario.name}」按 v{scenario.formula_version} 公式保存
            </p>
          ))}
        </div>
      ) : null}
    </div>
  )
}
