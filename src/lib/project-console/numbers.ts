import { formatAdMoney } from '@/lib/ads/spend-figures'
import type { ProjectFigures, ProjectNumber } from './types'

function countText(value: number): string {
  if (Number.isInteger(value)) return String(value)
  return String(Math.round(value * 100) / 100)
}

function pushNumber(out: ProjectNumber[], label: string, value: number | null, text: (value: number) => string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) return
  out.push({ label, value: text(value) })
}

/** Omit anything that was not actually read. Never fills a zero in for a missing field. */
export function projectNumbers(figures: ProjectFigures | 'unread'): { numbers: ProjectNumber[]; note: string | null } {
  if (figures === 'unread') return { numbers: [], note: '关键数字这次没读到。' }
  const numbers: ProjectNumber[] = []
  pushNumber(numbers, '每月预算', figures.monthlyBudget, (value) => formatAdMoney(value, figures.budgetCurrency))
  const targetLabel = figures.metricLabel ? `目标（${figures.metricLabel}）` : '目标'
  pushNumber(numbers, targetLabel, figures.targetValue, countText)
  pushNumber(numbers, '目前', figures.currentValue, countText)
  pushNumber(numbers, '每天预算上限', figures.dailyCapCents, (cents) => formatAdMoney(cents / 100, figures.budgetCurrency))
  return { numbers, note: figures.partial ? '有的数字这次没读到。' : null }
}
