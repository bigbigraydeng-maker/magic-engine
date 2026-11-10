'use client'

import { clientWorkflowSteps } from '../prescription-entry'

export function WorkflowProgress({
  discoveryConfirmed,
  hasPrescription,
  prescriptionId,
  clientId,
}: {
  discoveryConfirmed: boolean
  hasPrescription: boolean
  prescriptionId: string | null
  clientId: string
}) {
  const steps = clientWorkflowSteps({ discoveryConfirmed, hasPrescription, prescriptionId, clientId })
  const firstPending = steps.findIndex(s => !s.done)
  return (
    <div className="overflow-x-auto rounded-xl border border-black/10 bg-white px-4 py-4 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max items-center gap-0">
        {steps.map((step, i) => (
          <ProgressStep key={step.label} step={step} index={i} active={i === firstPending} last={i === steps.length - 1} />
        ))}
      </div>
    </div>
  )
}

function ProgressStep({ step, index, active, last }: {
  step: ReturnType<typeof clientWorkflowSteps>[number]
  index: number
  active: boolean
  last: boolean
}) {
  const inner = (
    <div className={`flex items-center gap-2 rounded-lg px-3 py-2 ${active ? 'bg-me-ochre/10' : ''}`}>
      <div className={`flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-black ${step.done ? 'bg-[#5C8A4A] text-white' : active ? 'bg-me-charcoal text-white' : 'bg-me-ivory text-me-charcoal/45'}`}>
        {step.done ? '✓' : index + 1}
      </div>
      <div>
        <p className={`text-xs font-black leading-none ${step.done ? 'text-[#5C8A4A]' : active ? 'text-me-charcoal' : 'text-me-charcoal/45'}`}>{step.label}</p>
        <p className="mt-0.5 text-[10px] font-semibold text-me-charcoal/45">{step.sublabel}</p>
      </div>
    </div>
  )
  return (
    <div className="flex items-center">
      {(step.alwaysLink || (step.href && !step.done)) ? <a href={step.href}>{inner}</a> : inner}
      {!last && <div className={`mx-1 h-px w-8 ${step.done ? 'bg-[#5C8A4A]/70' : 'bg-me-stone'}`} />}
    </div>
  )
}
