import type {
  CalculatorInputs,
  CalculatorResult,
} from '@/lib/crm/industry/travel-business-calculator'

/** Grouping used to lay out the input fields in the UI. */
export type InputGroup = 'finance' | 'growth' | 'product'

/** A single editable input field. */
export interface InputField {
  key: keyof CalculatorInputs
  label: string
  unit: string
  step: number
  group: InputGroup
  hint?: string
}

/** The 13 input fields, in display order. */
export const INPUT_FIELDS: readonly InputField[] = [
  {
    key: 'adSpend',
    label: '年度广告投入',
    unit: 'NZD / 年',
    step: 5000,
    group: 'finance',
  },
  {
    key: 'salary',
    label: '年度人工成本',
    unit: 'NZD / 年',
    step: 5000,
    group: 'finance',
  },
  {
    key: 'serviceFeeCost',
    label: 'CTS 年度服务费成本',
    unit: 'NZD / 年',
    step: 5000,
    group: 'finance',
    hint: 'CTS 支付给服务方的费用，计入经营成本',
  },
  {
    key: 'grossMargin',
    label: '佣金前毛利率',
    unit: '% 销售额',
    step: 1,
    group: 'finance',
    hint: '直接成交与 Agent / Sales 成交的比例不同，请自己填',
  },
  {
    key: 'commissionRate',
    label: 'Sales 佣金率',
    unit: '% 销售额',
    step: 1,
    group: 'finance',
    hint: '按销售额支付；最高按毛利率计算（超出会被截到毛利率）',
  },
  {
    key: 'cpl',
    label: 'Facebook 每条线索成本',
    unit: 'NZD / 条',
    step: 0.5,
    group: 'growth',
  },
  {
    key: 'conversion',
    label: '线索到付款成团转化率',
    unit: '%',
    step: 0.1,
    group: 'growth',
    hint: '分母是线索条数，分子是付款成团的订单数',
  },
  {
    key: 'tourShare',
    label: 'Tour 订单占比',
    unit: '%',
    step: 5,
    group: 'product',
    hint: '其余是 Tailor-made',
  },
  {
    key: 'tourParty',
    label: 'Tour 平均每单人数',
    unit: '人 / 单',
    step: 0.1,
    group: 'product',
  },
  {
    key: 'tourPrice',
    label: 'Tour 人均价格',
    unit: 'NZD / 人',
    step: 100,
    group: 'product',
  },
  {
    key: 'tailorParty',
    label: 'Tailor-made 平均每单人数',
    unit: '人 / 单',
    step: 0.1,
    group: 'product',
  },
  {
    key: 'tailorPrice',
    label: 'Tailor-made 人均价格',
    unit: 'NZD / 人',
    step: 100,
    group: 'product',
  },
  {
    key: 'additionalSales',
    label: '额外增加 Sales 人数',
    unit: '人',
    step: 1,
    group: 'product',
    hint: '只影响人均指标，不加成本，不进利润',
  },
]

/** How a metric value should be formatted. */
export type MetricKind = 'money' | 'count' | 'people' | 'percent'

/** A single result metric row. */
export interface MetricRow {
  key: keyof CalculatorResult
  label: string
  kind: MetricKind
}

/** The result metrics, in display order. */
export const RESULT_METRICS: readonly MetricRow[] = [
  { key: 'profit', label: '按这组假设算出的年度利润', kind: 'money' },
  { key: 'sales', label: '游客销售额', kind: 'money' },
  { key: 'grossProfit', label: '佣金前毛利', kind: 'money' },
  { key: 'commissionPool', label: '佣金池', kind: 'money' },
  { key: 'retained', label: '佣金后公司留存', kind: 'money' },
  { key: 'adSpend', label: '广告投入', kind: 'money' },
  { key: 'salary', label: '人工成本', kind: 'money' },
  { key: 'serviceFeeCost', label: 'CTS 服务费成本', kind: 'money' },
  { key: 'annualCosts', label: '项目总成本', kind: 'money' },
  { key: 'passengers', label: '按假设算出的出行游客', kind: 'people' },
  { key: 'orders', label: '按假设算出的付款订单', kind: 'count' },
  { key: 'leads', label: '按假设算出的线索', kind: 'count' },
  { key: 'averageParty', label: '加权平均每单人数', kind: 'people' },
  { key: 'revenuePerPassenger', label: '每位游客销售额', kind: 'money' },
  { key: 'retainedPerPassenger', label: '每位游客公司留存', kind: 'money' },
  { key: 'adCostPerPassenger', label: '每位游客广告成本', kind: 'money' },
  { key: 'contributionPerPassenger', label: '每位游客净贡献', kind: 'money' },
  { key: 'breakEvenPassengers', label: '打平游客数', kind: 'people' },
  { key: 'breakEvenLeads', label: '打平线索数', kind: 'count' },
  { key: 'breakEvenAdvertising', label: '打平广告费', kind: 'money' },
  { key: 'salesRequired', label: '按线索量折算的 Sales 人数', kind: 'people' },
]

const MONEY_FORMAT = new Intl.NumberFormat('en-NZ', {
  style: 'currency',
  currency: 'NZD',
  maximumFractionDigits: 0,
})

const COUNT_FORMAT = new Intl.NumberFormat('en-NZ', {
  maximumFractionDigits: 0,
})

const PEOPLE_FORMAT = new Intl.NumberFormat('en-NZ', {
  maximumFractionDigits: 2,
})

/** Format a metric value for display. */
export function formatMetric(value: number, kind: MetricKind): string {
  if (!Number.isFinite(value)) {
    return kind === 'money' ? '无法计算' : '—'
  }

  switch (kind) {
    case 'money':
      return MONEY_FORMAT.format(value)
    case 'count':
      return COUNT_FORMAT.format(value)
    case 'people':
      return PEOPLE_FORMAT.format(value)
    case 'percent':
      return `${(value * 100).toFixed(1)}%`
  }
}

/** A single row of a two-scenario comparison. */
export interface DiffRow {
  key: keyof CalculatorResult
  label: string
  kind: MetricKind
  a: number
  b: number
  diff: number | null
}

/** Round a value the same way `formatMetric` displays it. */
function roundForKind(value: number, kind: MetricKind): number {
  switch (kind) {
    case 'money':
    case 'count':
      return Math.round(value)
    case 'people':
      return Math.round(value * 100) / 100
    case 'percent':
      return Math.round(value * 1000) / 1000
  }
}

/** Compare two results, rounding each side before subtracting. */
export function diffMetrics(
  a: CalculatorResult,
  b: CalculatorResult,
): DiffRow[] {
  return RESULT_METRICS.map((row) => {
    const rawA = a[row.key]
    const rawB = b[row.key]
    const roundedA = roundForKind(rawA, row.kind)
    const roundedB = roundForKind(rawB, row.kind)
    const diff =
      Number.isFinite(rawA) && Number.isFinite(rawB)
        ? roundedB - roundedA
        : null

    return {
      key: row.key,
      label: row.label,
      kind: row.kind,
      a: roundedA,
      b: roundedB,
      diff,
    }
  })
}

/** 字段的中文名；找不到就原样返回键名（给错误提示和对比表用，别让英文字段名露给 PM）。 */
export function fieldLabel(key: string): string {
  return INPUT_FIELDS.find((field) => field.key === key)?.label ?? key
}
