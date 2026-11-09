'use client'

import type { CalculatorResult } from '@/lib/crm/industry/travel-business-calculator'
import {
  RESULT_METRICS,
  formatMetric,
  type MetricKind,
} from './format'

interface PerSalesRow {
  key: keyof CalculatorResult
  label: string
  kind: MetricKind
}

const PER_SALES_ROWS: readonly PerSalesRow[] = [
  { key: 'leadsPerSalesperson', label: '每位 Sales 的线索', kind: 'count' },
  { key: 'ordersPerSalesperson', label: '每位 Sales 的订单', kind: 'people' },
  { key: 'passengersPerSalesperson', label: '每位 Sales 的游客', kind: 'people' },
  { key: 'salesPerSalesperson', label: '每位 Sales 的销售额', kind: 'money' },
  { key: 'commissionPerSalesperson', label: '每位 Sales 的佣金', kind: 'money' },
  { key: 'salesCapacityUtilization', label: '产能利用率', kind: 'percent' },
]

export function ResultPanel(props: {
  result: CalculatorResult
  warnings: string[]
}): JSX.Element {
  const { result, warnings } = props
  const headline = RESULT_METRICS[0]
  const restMetrics = RESULT_METRICS.slice(1)

  return (
    <div
      data-testid="result-panel"
      className="rounded-xl border border-black/10 bg-white p-6 shadow-sm"
    >
      <p className="text-xs text-me-charcoal/70">内部模拟 · 不构成预算依据</p>

      <div className="mt-3">
        <p className="text-sm text-me-charcoal/70">{headline.label}</p>
        <p
          data-testid="result-profit"
          className="text-3xl font-semibold text-me-charcoal"
        >
          {formatMetric(result[headline.key], headline.kind)}
        </p>
      </div>

      {warnings.length > 0 ? (
        <div className="mt-4 space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3">
          {warnings.map((warning) => (
            <p key={warning} className="text-xs text-amber-800">
              {warning}
            </p>
          ))}
        </div>
      ) : null}

      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        {restMetrics.map((row) => (
          <div
            key={row.key}
            className="flex items-baseline justify-between gap-3 border-b border-me-charcoal/10 py-1"
          >
            <dt className="text-sm text-me-charcoal/70">{row.label}</dt>
            <dd className="text-sm text-me-charcoal">
              {formatMetric(result[row.key], row.kind)}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-6">
        <h2 className="text-sm font-semibold text-me-charcoal">
          按 Sales 人数看人均
        </h2>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
          {PER_SALES_ROWS.map((row) => (
            <div
              key={row.key}
              className="flex items-baseline justify-between gap-3 border-b border-me-charcoal/10 py-1"
            >
              <dt className="text-sm text-me-charcoal/70">{row.label}</dt>
              <dd className="text-sm text-me-charcoal">
                {formatMetric(result[row.key], row.kind)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-xs text-me-charcoal/70">
          「额外增加 Sales」只影响这里的人均指标，不加任何成本，也不进上面的利润。
        </p>
      </div>
    </div>
  )
}
