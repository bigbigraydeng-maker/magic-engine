/** Client-page entry for the prescription dialog. Shared by the progress bar and the tool card. */

export function prescriptionEntryHref(clientId: string, prescriptionId: string | null): string {
  const base = `/dashboard/clients/${encodeURIComponent(clientId)}/prescription/new`
  if (!prescriptionId) return base
  return `${base}?prescription_id=${encodeURIComponent(prescriptionId)}`
}

export interface ClientWorkflowStep {
  label: string
  sublabel: string
  done: boolean
  href: string
  alwaysLink?: boolean
}

export function clientWorkflowSteps(input: {
  discoveryConfirmed: boolean
  hasPrescription: boolean
  prescriptionId: string | null
  clientId: string
}): ClientWorkflowStep[] {
  return [
    {
      label: '品牌扫描',
      sublabel: '张骞',
      done: input.discoveryConfirmed,
      href: `/dashboard/clients/${encodeURIComponent(input.clientId)}/zhangqian`,
    },
    {
      label: '处方',
      sublabel: '华佗',
      done: input.hasPrescription,
      href: prescriptionEntryHref(input.clientId, input.hasPrescription ? input.prescriptionId : null),
      alwaysLink: true,
    },
    {
      label: '执行追踪',
      sublabel: '鲁班',
      done: false,
      href: `/dashboard/clients/${encodeURIComponent(input.clientId)}/execution`,
    },
  ]
}
