/**
 * Phase X.S5 — Server-side wrapper that gates the page behind paid_client tier.
 * Implementation moved to ./_client.tsx (NewGoalClient).
 */
import { ServerFeatureLock } from '@/components/auth/ServerFeatureLock'
import { NewGoalClient } from './_client'

const SUBTITLE = 'Goals turn the diagnostic into a 90-day track with attribution. Setting one well takes context-gathering across data sources — your FDE configures it with you.'

export default function Page() {
  return (
    <ServerFeatureLock feature='Goals' subtitle={SUBTITLE}>
      <NewGoalClient />
    </ServerFeatureLock>
  )
}
