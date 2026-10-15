/**
 * L2 industry layer: the SHAPE and arithmetic of the travel business calculator.
 *
 * This file is a pure, dependency-free port of the reference formula used by
 * the travel client configuration. It holds no client names and no I/O: given
 * a set of inputs it returns the same numbers as the reference implementation,
 * including the same clamping and the same Infinity branches.
 *
 * Percent fields (conversion, tourShare, grossMargin, commissionRate) are in
 * percent units, e.g. 5 means 5%, exactly as in the reference.
 */

/** Version of the formula implemented here, bumped when the maths changes. */
export const BUSINESS_CALCULATOR_FORMULA_VERSION = 1

/** Inputs to the travel business calculator. */
export interface CalculatorInputs {
  adSpend: number
  cpl: number
  conversion: number
  serviceFeeCost: number
  salary: number
  tourShare: number
  tourParty: number
  tourPrice: number
  tailorParty: number
  tailorPrice: number
  grossMargin: number
  commissionRate: number
  additionalSales: number
}

/** Default inputs, matching the reference DEFAULTS. */
export const DEFAULT_INPUTS: CalculatorInputs = {
  adSpend: 60000,
  cpl: 7,
  conversion: 5,
  serviceFeeCost: 60000,
  salary: 100000,
  tourShare: 80,
  tourParty: 1.6,
  tourPrice: 3500,
  tailorParty: 2,
  tailorPrice: 4000,
  grossMargin: 20,
  commissionRate: 10,
  additionalSales: 0,
}

/** Outputs of the travel business calculator. Infinity is allowed. */
export interface CalculatorResult {
  breakEvenPassengers: number
  breakEvenLeads: number
  breakEvenAdvertising: number
  breakEvenProfit: number
  breakEvenSalesRequired: number
  breakEvenSalesRequiredFte: number
  passengers: number
  averageParty: number
  averageOrder: number
  revenuePerPassenger: number
  orders: number
  leads: number
  adSpend: number
  cpl: number
  conversion: number
  sales: number
  grossProfit: number
  grossMarginRate: number
  commissionRate: number
  retainedRate: number
  commissionPool: number
  retained: number
  serviceFeeCost: number
  salary: number
  annualCosts: number
  fixedCostsBeforeAds: number
  profit: number
  contributionPerPassenger: number
  retainedPerPassenger: number
  adCostPerPassenger: number
  salesCount: number
  additionalSales: number
  leadsPerSales: number
  salesRequiredFte: number
  salesRequired: number
  leadsPerSalesperson: number
  ordersPerSalesperson: number
  passengersPerSalesperson: number
  salesPerSalesperson: number
  commissionPerSalesperson: number
  salesCapacityUtilization: number
}

/** Number of leads one salesperson can work in a year. */
const LEADS_PER_SALES = 6000

/** Clamp a value into an inclusive range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Run the travel business calculator.
 *
 * Ported line by line from the reference formula: the same clamping and the
 * same Infinity branches are preserved so the numbers match exactly.
 */
export function calculate(input: CalculatorInputs): CalculatorResult {
  const cpl = Math.max(0.01, input.cpl || 0.01)
  const adSpend = Math.max(0, input.adSpend)
  const conversion = clamp(input.conversion, 0, 100) / 100
  const tourShare = clamp(input.tourShare, 0, 100) / 100
  const tailorShare = 1 - tourShare
  const tourParty = Math.max(0.1, input.tourParty || 0.1)
  const tailorParty = Math.max(0.1, input.tailorParty || 0.1)
  const averageParty = tourShare * tourParty + tailorShare * tailorParty
  const averageOrder =
    tourShare * tourParty * input.tourPrice +
    tailorShare * tailorParty * input.tailorPrice
  const revenuePerPassenger = averageOrder / averageParty
  const leads = adSpend / cpl
  const orders = leads * conversion
  const passengers = orders * averageParty
  const sales = passengers * revenuePerPassenger
  const grossMarginRate = clamp(input.grossMargin, 0, 100) / 100
  const commissionRate = Math.min(
    grossMarginRate,
    Math.max(0, input.commissionRate) / 100,
  )
  const retainedRate = grossMarginRate - commissionRate
  const commissionPool = sales * commissionRate
  const retained = sales * retainedRate
  const serviceFeeCost = Math.max(0, input.serviceFeeCost)
  const salary = Math.max(0, input.salary)
  const fixedCostsBeforeAds = salary + serviceFeeCost
  const annualCosts = adSpend + fixedCostsBeforeAds
  const totalCosts = annualCosts
  const grossProfit = sales * grossMarginRate
  const profit = retained - totalCosts
  const retainedPerPassenger = revenuePerPassenger * retainedRate
  const adCostPerPassenger = conversion > 0 ? cpl / (conversion * averageParty) : Infinity
  const contributionPerPassenger = retainedPerPassenger - adCostPerPassenger
  const breakEvenPassengers =
    fixedCostsBeforeAds <= 0
      ? 0
      : contributionPerPassenger > 0
        ? Math.ceil(fixedCostsBeforeAds / contributionPerPassenger)
        : Infinity
  const breakEvenLeads =
    conversion > 0
      ? breakEvenPassengers / (averageParty * conversion)
      : breakEvenPassengers > 0
        ? Infinity
        : 0
  const breakEvenAdvertising = breakEvenLeads * cpl
  const breakEvenProfit = Number.isFinite(breakEvenPassengers)
    ? breakEvenPassengers * contributionPerPassenger - fixedCostsBeforeAds
    : Infinity
  const salesRequiredFte = leads / LEADS_PER_SALES
  const salesRequired = Math.ceil(salesRequiredFte)
  const breakEvenSalesRequiredFte = breakEvenLeads / LEADS_PER_SALES
  const breakEvenSalesRequired = Number.isFinite(breakEvenSalesRequiredFte)
    ? Math.ceil(breakEvenSalesRequiredFte)
    : Infinity
  const additionalSales = Math.max(0, Math.floor(input.additionalSales || 0))
  const salesCount = salesRequired + additionalSales
  const salespeople = Number.isFinite(salesCount) && salesCount > 0 ? salesCount : 1

  return {
    breakEvenPassengers,
    breakEvenLeads,
    breakEvenAdvertising,
    breakEvenProfit,
    breakEvenSalesRequired,
    breakEvenSalesRequiredFte,
    passengers,
    averageParty,
    averageOrder,
    revenuePerPassenger,
    orders,
    leads,
    adSpend,
    cpl,
    conversion,
    sales,
    grossProfit,
    grossMarginRate,
    commissionRate,
    retainedRate,
    commissionPool,
    retained,
    serviceFeeCost,
    salary,
    annualCosts,
    fixedCostsBeforeAds,
    profit,
    contributionPerPassenger,
    retainedPerPassenger,
    adCostPerPassenger,
    salesCount,
    additionalSales,
    leadsPerSales: LEADS_PER_SALES,
    salesRequiredFte,
    salesRequired,
    leadsPerSalesperson: leads / salespeople,
    ordersPerSalesperson: orders / salespeople,
    passengersPerSalesperson: passengers / salespeople,
    salesPerSalesperson: sales / salespeople,
    commissionPerSalesperson: commissionPool / salespeople,
    salesCapacityUtilization: salesCount > 0 ? leads / (LEADS_PER_SALES * salesCount) : 0,
  }
}

/** A single place where `calculate` silently changes an input. */
export interface ClampNote {
  field: keyof CalculatorInputs
  entered: number
  used: number
}

/** Collect one note for each input that `calculate` silently changes. */
export function clampNotes(input: CalculatorInputs): ClampNote[] {
  const notes: ClampNote[] = []
  const add = (field: keyof CalculatorInputs, entered: number, used: number): void => {
    if (entered !== used) {
      notes.push({ field, entered, used })
    }
  }

  add('cpl', input.cpl, Math.max(0.01, input.cpl || 0.01))
  add('adSpend', input.adSpend, Math.max(0, input.adSpend))
  add('serviceFeeCost', input.serviceFeeCost, Math.max(0, input.serviceFeeCost))
  add('salary', input.salary, Math.max(0, input.salary))
  add('conversion', input.conversion, clamp(input.conversion, 0, 100))
  add('tourShare', input.tourShare, clamp(input.tourShare, 0, 100))
  add('grossMargin', input.grossMargin, clamp(input.grossMargin, 0, 100))
  add('tourParty', input.tourParty, Math.max(0.1, input.tourParty || 0.1))
  add('tailorParty', input.tailorParty, Math.max(0.1, input.tailorParty || 0.1))

  // 全程用百分数比较，不做 /100 再 *100（7 会变成 7.000000000000001，冒出假的夹逼提示）
  const marginPercent = clamp(input.grossMargin, 0, 100)
  add('commissionRate', input.commissionRate, Math.min(marginPercent, Math.max(0, input.commissionRate)))

  const additionalSalesUsed = Math.max(0, Math.floor(input.additionalSales || 0))
  add('additionalSales', input.additionalSales, additionalSalesUsed)

  return notes
}

/** Chinese-language warnings for inputs that look unrealistic. */
export function unrealisticWarnings(
  input: CalculatorInputs,
  result: CalculatorResult,
): string[] {
  const warnings: string[] = []
  if (input.cpl < 0.5) {
    warnings.push('每条线索成本低于 0.5，参数可能不现实')
  }
  if (result.leads > 100000) {
    warnings.push('线索数超过 10 万条，参数可能不现实')
  }
  return warnings
}

/** Result of validating raw input. */
export type ValidateResult =
  | { ok: true; value: CalculatorInputs }
  | { ok: false; error: string }

/** The 13 input keys, used to reject unknown fields. */
const INPUT_KEYS: readonly (keyof CalculatorInputs)[] = [
  'adSpend',
  'cpl',
  'conversion',
  'serviceFeeCost',
  'salary',
  'tourShare',
  'tourParty',
  'tourPrice',
  'tailorParty',
  'tailorPrice',
  'grossMargin',
  'commissionRate',
  'additionalSales',
]

/** Upper bound for any single input value. */
const MAX_INPUT_VALUE = 1_000_000_000

/**
 * Validate raw input without clamping.
 *
 * Missing keys fall back to DEFAULT_INPUTS; unknown keys and non-finite or
 * out-of-range values are rejected. Clamping is `calculate`'s job and is shown
 * to the user via `clampNotes`.
 */
export function validateInputs(raw: unknown): ValidateResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: '输入必须是对象' }
  }

  const record = raw as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!INPUT_KEYS.includes(key as keyof CalculatorInputs)) {
      return { ok: false, error: `未知字段：${key}` }
    }
  }

  const value: CalculatorInputs = { ...DEFAULT_INPUTS }
  for (const key of INPUT_KEYS) {
    if (!(key in record)) {
      continue
    }
    const provided = record[key]
    if (
      typeof provided !== 'number' ||
      !Number.isFinite(provided) ||
      provided < 0 ||
      provided > MAX_INPUT_VALUE
    ) {
      return { ok: false, error: `字段 ${key} 必须是 0 到 10 亿之间的数字` }
    }
    value[key] = provided
  }

  return { ok: true, value }
}
