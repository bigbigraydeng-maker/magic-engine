'use client'

import { useParams, useSearchParams } from 'next/navigation'
import { PrescriptionDialog } from './dialog/PrescriptionDialog'

export default function NewPrescriptionPage() {
  const params = useParams()
  const search = useSearchParams()
  const clientId = String(params.id ?? '')
  return (
    <PrescriptionDialog
      clientId={clientId}
      prescriptionId={search.get('prescription_id')}
      goalId={search.get('goal_id')}
      supplementOf={search.get('supplement_of')}
      reviseOf={search.get('revise')}
    />
  )
}
