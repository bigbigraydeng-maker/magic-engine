import { describe, expect, it } from 'vitest'
import {
  audOnlyAmount,
  budgetAmountLabel,
  budgetCapInstruction,
  prepareBudgetIntake,
  prescriptionBudgetFields,
} from '../budget-currency'
import type { PrescriptionIntake } from '@/types/diagnostic'

const intake = (over: Partial<PrescriptionIntake> = {}): PrescriptionIntake => ({
  business_goal: '多接到咨询',
  timeline_urgency: 'short_term',
  monthly_budget_aud: 3000,
  priority_dimensions: [],
  notes: null,
  ...over,
})

describe('prescription budget currency', () => {
  it('keeps NZ$3,000 as NZD and refuses to file it as AUD', () => {
    const fields = prescriptionBudgetFields(3000, 'NZD')
    expect(fields).toEqual({ ok: true, monthly_budget_aud: 3000, budget_currency: 'NZD' })
    expect(audOnlyAmount(3000, 'NZD')).toBeNull()
    expect(budgetAmountLabel(3000, 'NZD')).toContain('NZ$')
    expect(budgetAmountLabel(3000, 'NZD')).not.toContain('AUD')
    expect(budgetCapInstruction(3000, 'NZD')).toContain('NZD')
    expect(budgetCapInstruction(3000, 'NZD')).not.toContain('换成')
  })

  it('refuses to generate when the currency is still unknown', () => {
    expect(prescriptionBudgetFields(3000, null).ok).toBe(false)
    const prepared = prepareBudgetIntake(intake({ budget_currency: null }))
    expect(prepared.ok).toBe(false)
  })

  it('stores an AUD amount in the AUD case column, and treats an omitted currency as the old AUD API', () => {
    expect(audOnlyAmount(3000, 'AUD')).toBe(3000)
    const prepared = prepareBudgetIntake(intake())
    expect(prepared.ok && prepared.intake.budget_currency).toBe('AUD')
  })
})
