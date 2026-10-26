import { describe, expect, it } from 'vitest'
import { clientWorkflowSteps, prescriptionEntryHref } from '../prescription-entry'

describe('处方入口', () => {
  it('opens a new dialog when there is no prescription', () => {
    expect(prescriptionEntryHref('c1', null)).toBe('/dashboard/clients/c1/prescription/new')
  })

  it('opens the existing prescription dialog for review', () => {
    expect(prescriptionEntryHref('c1', 'p 1')).toBe('/dashboard/clients/c1/prescription/new?prescription_id=p%201')
  })

  it('merges diagnosis and prescription into one 处方 step', () => {
    const labels = clientWorkflowSteps({
      discoveryConfirmed: true,
      hasPrescription: false,
      prescriptionId: null,
      clientId: 'c1',
    }).map((step) => `${step.label}/${step.sublabel}`)
    expect(labels).toEqual(['品牌扫描/张骞', '处方/华佗', '执行追踪/鲁班'])
    expect(labels.join(' ')).not.toContain('深度诊断')
    expect(labels.join(' ')).not.toContain('诸葛亮')
  })
})
