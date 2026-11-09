/**
 * One currency for a prescription budget: the form, the prompt, and the case library.
 * The stored field is still named monthly_budget_aud. That name is historical.
 * A NZD amount must not be written into an AUD column or labeled AUD.
 */
import type { PrescriptionIntake } from '@/types/diagnostic'
import { formatAdMoney } from './spend-figures'

const ISO = /^[A-Z]{3}$/

export function normalizeBudgetCurrency(raw: string | null | undefined): string | null {
  if (raw == null) return null
  const code = raw.trim().toUpperCase()
  return ISO.test(code) ? code : null
}

export function budgetCurrencyOf(intake: { budget_currency?: string | null }): string | null {
  return normalizeBudgetCurrency(intake.budget_currency)
}

export function budgetAmountLabel(amount: number, currency: string | null): string {
  if (!currency) return `${amount}（币种未标明）`
  return `${formatAdMoney(amount, currency)}（${amount} ${currency}）`
}

/** Hard cap sentence. The numbers stay in the client's currency. */
export function budgetCapInstruction(amount: number, currency: string | null): string {
  const label = budgetAmountLabel(amount, currency)
  if (!currency) {
    return `预算数字是 ${label}。不要把它写成澳元，也不要拿它和表格里的澳元典型预算相除。`
  }
  return `预算分配各项 amount_aud 之和 ≤ ${label}。这些数字的单位是 ${currency}，字段名是旧的，不要换算成别的币种。`
}

/**
 * prescription_cases.monthly_budget_aud is an AUD column.
 * Another currency's number must not be stored or used as an AUD search band.
 */
export function audOnlyAmount(amount: number, currency: string | null | undefined): number | null {
  if (normalizeBudgetCurrency(currency) !== 'AUD') return null
  return Number.isFinite(amount) ? amount : null
}

export function prescriptionBudgetFields(
  amount: number,
  currency: string | null | undefined,
): { ok: true; monthly_budget_aud: number; budget_currency: string } | { ok: false; error: string } {
  const code = normalizeBudgetCurrency(currency)
  if (!code) return { ok: false, error: '还不知道这笔预算的币种，不能把它当成澳元生成处方。' }
  if (!Number.isFinite(amount) || amount < 0) return { ok: false, error: '月度预算不是一个有效数字。' }
  return { ok: true, monthly_budget_aud: amount, budget_currency: code }
}

/**
 * Omitted currency is the old API, which meant AUD.
 * An explicit empty currency is a refusal: the caller knows it does not know.
 */
export function prepareBudgetIntake(
  intake: PrescriptionIntake,
): { ok: true; intake: PrescriptionIntake } | { ok: false; error: string } {
  if (intake.budget_currency === undefined) {
    return { ok: true, intake: { ...intake, budget_currency: 'AUD' } }
  }
  const fields = prescriptionBudgetFields(intake.monthly_budget_aud, intake.budget_currency)
  if (!fields.ok) return fields
  return {
    ok: true,
    intake: { ...intake, monthly_budget_aud: fields.monthly_budget_aud, budget_currency: fields.budget_currency },
  }
}
